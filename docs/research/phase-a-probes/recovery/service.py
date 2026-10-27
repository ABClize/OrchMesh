"""Disposable integration probe; never imports OrchMesh or opens its configuration."""
import asyncio, ctypes, json, os, signal, subprocess, sys
from pathlib import Path
from contextlib import asynccontextmanager
import httpx
from fastapi import FastAPI
from sqlalchemy import create_engine, text
from sqlalchemy.ext.asyncio import create_async_engine
from dbos import DBOS, DBOSClient, Queue
from a2a.auth.user import User
from a2a.server.context import ServerCallContext
from a2a.server.cluster.database_task_store import VersionedDatabaseTaskStore
from a2a.server.cluster.database_event_stream import DatabaseTaskEventStream
from a2a.server.cluster.version import TaskVersion
from a2a.utils.errors import TaskNotFoundError
from a2a.server.agent_execution import AgentExecutor
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.routes import create_jsonrpc_routes, add_a2a_routes_to_fastapi
from a2a.server.routes.common import DefaultServerCallContextBuilder
from a2a.client import ClientFactory, ClientConfig
from a2a.types import (AgentCard,AgentInterface,AgentCapabilities,AgentSkill,Message,Part,Role,
 Task,TaskStatus,TaskState,TaskStatusUpdateEvent,Artifact,GetTaskRequest,SendMessageRequest,SendMessageConfiguration)
ROOT=Path(os.environ['PROBE_ROOT']); ROOT.mkdir(parents=True,exist_ok=True)
DBURL=os.environ['PROBE_DB_URL']; PORT=int(os.environ['PROBE_PORT'])
engine=create_engine(DBURL)
async_engine=create_async_engine(DBURL)
store=VersionedDatabaseTaskStore(async_engine)
events=DatabaseTaskEventStream(async_engine,poll_interval_s=.1)
DBOS(config={'name':'orchmesh-phase-a','system_database_url':DBURL,'application_version':'phase-a-fixed-v1','enable_otlp':False})

client=None
class ProbeUser(User):
 @property
 def is_authenticated(self):return True
 @property
 def user_name(self):return 'isolated-owner'
CONTEXT=ServerCallContext(user=ProbeUser())
class ContextBuilder(DefaultServerCallContextBuilder):
 def build_user(self,request):return ProbeUser()
card=AgentCard(name='isolated-research-agent',description='Disposable A2A recovery probe',version='1',
 supported_interfaces=[AgentInterface(url=f'http://127.0.0.1:{PORT}/a2a',protocol_binding='JSONRPC',protocol_version='1.0')],
 capabilities=AgentCapabilities(streaming=True),default_input_modes=['text/plain'],default_output_modes=['text/plain'],
 skills=[AgentSkill(id='probe',name='probe',description='deterministic recovery',tags=['probe'])])

def audit(event,**fields):
 with (ROOT/'audit.jsonl').open('a') as f:f.write(json.dumps({'event':event,'pid':os.getpid(),**fields})+'\n')
def row(task):
 with engine.connect() as c:return c.execute(text('select * from probe_tasks where id=:id'),{'id':task}).mappings().first()
def admit(task,scenario,a2a_id=None,context_id=None,rollback=False):
 with engine.begin() as c:
  existing=c.execute(text('select * from probe_tasks where id=:id'),{'id':task}).mappings().first()
  if existing:
   if existing['scenario']!=scenario:raise ValueError('request identity conflict')
   return dict(existing)
  c.execute(text('insert into probe_tasks(id,scenario,a2a_id,context_id,version) values(:id,:s,:a,:c,:v)'),{'id':task,'s':scenario,'a':a2a_id,'c':context_id,'v':'agent-v1'})
  client.enqueue_in_transaction(c,{'workflow_name':'run_task','queue_name':'probe-queue','workflow_id':task},task,scenario)
  if rollback:raise ValueError('intentional rollback')
 return dict(row(task))

@DBOS.step(retries_allowed=True, max_attempts=3, interval_seconds=.2, should_retry=lambda e: isinstance(e, ChildProcessError), preemptible=True)
async def run_dsh(task,scenario):
 directory=ROOT/task;directory.mkdir(exist_ok=True)
 # Python parent-death signal set in a tiny executable launcher, not unsafe preexec_fn.
 cmd=[sys.executable,str(Path(__file__).with_name('launch_child.py')),str(Path(__file__).with_name('dsh-worker.mjs')),str(directory),task,scenario]
 with (directory/'node.log').open('a') as log:
  proc=await asyncio.create_subprocess_exec(*cmd,stdout=log,stderr=log)
  audit('node-start',task=task,child_pid=proc.pid)
  try:
   code=await proc.wait()
   if code == -9:raise ChildProcessError('Isolated child killed; resume saved Session')
   if code:raise RuntimeError(f'DSH child exited {code}; see isolated log')
  finally:
   if proc.returncode is None:proc.kill();await proc.wait()
 result=json.loads((directory/'result.json').read_text())
 if scenario=='after-dsh' and not (directory/'release').exists():
  (directory/'ready').write_text('result flushed, DBOS step not committed')
  await asyncio.Event().wait()
 return result

@DBOS.step()
async def publish_result(task,result):
 data=row(task)
 if data['a2a_id']:
  old=await store.get(data['a2a_id'],CONTEXT)
  if old is None:
   recovered=Task(id=data['a2a_id'],context_id=data['context_id'],status=TaskStatus(state=TaskState.TASK_STATE_COMPLETED),artifacts=[Artifact(artifact_id=task+'-result',name='result',parts=[Part(text='TASK_DONE:'+task)])])
   await store.save(recovered,event=recovered,prev=None,prev_version=TaskVersion.MISSING,context=CONTEXT)
  elif old.task.status.state!=TaskState.TASK_STATE_COMPLETED:
   updated=Task();updated.CopyFrom(old.task)
   updated.status.state=TaskState.TASK_STATE_COMPLETED
   updated.artifacts.append(Artifact(artifact_id=task+'-result',name='result',parts=[Part(text='TASK_DONE:'+task)]))
   event=TaskStatusUpdateEvent(task_id=updated.id,context_id=updated.context_id,status=updated.status)
   await store.save(updated,event=event,prev=old.task,prev_version=old.version,context=CONTEXT)
 with engine.begin() as c:c.execute(text('update probe_tasks set result=:r where id=:id'),{'id':task,'r':json.dumps(result)})
 audit('published',task=task)
 return result

@DBOS.step()
async def call_collaborator(task):
 child=task+'-child';existing=row(child)
 async with httpx.AsyncClient(timeout=10) as http:
  remote=ClientFactory(ClientConfig(streaming=False,httpx_client=http)).create(card)
  if existing is None:
   request=SendMessageRequest(message=Message(message_id=child,role=Role.ROLE_USER,parts=[Part(text=child)]),configuration=SendMessageConfiguration(return_immediately=True))
   async for response in remote.send_message(request):
    audit('a2a-response',task=task,payload=response.WhichOneof('payload'))
  for _ in range(600):
   existing=row(child)
   if existing:
    try:result=await remote.get_task(GetTaskRequest(id=existing['a2a_id']))
    except TaskNotFoundError:
     await asyncio.sleep(.1);continue
    if result.status.state==TaskState.TASK_STATE_COMPLETED:
     directory=ROOT/task;directory.mkdir(exist_ok=True)
     if not (directory/'release').exists():
      (directory/'ready').write_text('child completed durably; parent result not checkpointed')
      await asyncio.Event().wait()
     audit('child-reused',task=task,child=child,a2a_id=result.id)
     return result.id
   await asyncio.sleep(.1)
  raise TimeoutError('child completion')

@DBOS.step()
async def sandbox_continuation(task):
 directory=ROOT/task
 process=await asyncio.create_subprocess_exec(sys.executable,str(Path(__file__).with_name('sandbox_step.py')),str(directory),task,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
 out,err=await process.communicate()
 if process.returncode:raise RuntimeError('Sandbox probe failed: '+err.decode()[-2000:])
 result=json.loads(out.decode().splitlines()[-1]);audit('sandbox-result',task=task,reused=result['reused'],container=result['container'])
 if not (directory/'sandbox-release').exists():
  (directory/'sandbox-ready').write_text('artifact durable and container removed; step result not checkpointed')
  await asyncio.Event().wait()
 return result

@DBOS.workflow()
async def run_task(task,scenario):
 if scenario in ['collaboration','sandbox-collaboration']:await call_collaborator(task)
 if scenario=='question':
  audit('waiting-question',task=task)
  answer=await DBOS.recv_async(topic='answer',timeout_seconds=3600)
  audit('answer-received',task=task,answer=answer)
 result=await run_dsh(task,'normal' if scenario in ['collaboration','sandbox-collaboration','sandbox','question'] else scenario)
 if scenario=='sandbox':result['sandbox']=await sandbox_continuation(task)
 return await publish_result(task,result)

class Executor(AgentExecutor):
 async def execute(self,context,event_queue):
  business_id=context.get_user_input()
  initial=Task(id=context.task_id,context_id=context.context_id,status=TaskStatus(state=TaskState.TASK_STATE_WORKING),history=[context.message])
  # Persist execution BEFORE publishing an accepted protocol response.
  await asyncio.to_thread(admit,business_id,'stream' if business_id.startswith(('sse-','admission-')) else 'sandbox' if business_id.startswith('sandbox-') else 'normal',context.task_id,context.context_id)
  if business_id.startswith('admission-'):
   directory=ROOT/business_id;directory.mkdir(exist_ok=True)
   (directory/'admission-ready').write_text('durable execution admitted; A2A projection not written')
   await asyncio.Event().wait()
  await event_queue.enqueue_event(initial)
 async def cancel(self,context,event_queue):
  raise NotImplementedError('Cancellation probe not yet implemented')
handler=DefaultRequestHandler(Executor(),store,card,event_stream=events)
@asynccontextmanager
async def lifespan(app):
 global client
 with engine.begin() as c:c.execute(text('create table if not exists probe_tasks(id text primary key,scenario text not null,a2a_id text,context_id text,version text not null,result text)'))
 await store.initialize();await events.initialize()
 DBOS.launch();await DBOS.register_queue_async('probe-queue',polling_interval_sec=.1);client=DBOSClient(system_database_url=DBURL,application_name="orchmesh-phase-a")
 audit('started')
 yield
 client.destroy();DBOS.destroy(workflow_completion_timeout_sec=0);await async_engine.dispose()
app=FastAPI(lifespan=lifespan)
add_a2a_routes_to_fastapi(app,jsonrpc_routes=create_jsonrpc_routes(handler,'/a2a',context_builder=ContextBuilder()))
@app.get('/health')
def health():return {'ok':True}
@app.post('/tasks/{task}')
def submit(task:str,scenario:str='stream',rollback:bool=False):
 try:return admit(task,scenario,rollback=rollback)
 except ValueError as e:return {'error':str(e)}
@app.get('/tasks/{task}')
def get_task(task:str):
 data=row(task);status=DBOS.get_workflow_status(task)
 return {'record':dict(data) if data else None,'workflow':status.status if status else None}
@app.post('/tasks/{task}/answer')
async def answer(task:str):
 await DBOS.send_async(task,'approved-probe-answer',topic='answer',idempotency_key=task+'-answer-v1')
 return {'ok':True}

@app.post('/tasks/{task}/cancel')
async def cancel(task:str):
 await DBOS.cancel_workflow_async(task)
 return {'ok':True}
