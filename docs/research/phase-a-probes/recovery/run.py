"""Run only disposable resources. Requires uv, npm, Node 24 and Docker.

Usage: python run.py [--real-env /absolute/path/to/.env]
Never reads the application DB or creates an application account.
"""
import argparse
import asyncio
import json
import os
from pathlib import Path
import shutil
import shlex
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid

HERE = Path(__file__).resolve().parent


def bootstrap():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--real-env', type=Path)
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix='orchmesh-phase-a-recovery-'))
    for name in ['run.py', 'service.py', 'dsh-worker.mjs', 'launch_child.py',
                 'requirements.lock', 'package.json', 'package-lock.json', 'sandbox_step.py']:
        shutil.copy2(HERE / name, root / name)
    subprocess.run(['uv', 'venv', str(root / 'venv'), '--python', '3.12'], check=True)
    python = root / 'venv/bin/python'
    subprocess.run(['uv', 'pip', 'install', '--python', str(python), '-r', str(root / 'requirements.lock')], check=True)
    subprocess.run(['npm', '--prefix', str(root), 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], check=True)
    name = 'orchmesh-phase-a-pg-' + uuid.uuid4().hex[:10]
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        port = s.getsockname()[1]
    cid = None
    fixture=root/'ssh'
    shutil.copytree(HERE.parent/'ssh',fixture,ignore=shutil.ignore_patterns('__pycache__','verified-results.json'))
    for d in ['bin','keys','artifacts']:(fixture/d).mkdir(exist_ok=True)
    (fixture/'bin/ssh').write_text('#!/bin/sh\nexec /usr/bin/ssh -F '+shlex.quote(str(fixture/'ssh_config'))+' "$@"\n')
    (fixture/'bin/ssh').chmod(0o755)
    ssh_image='orchmesh-phase-a-ssh:'+uuid.uuid4().hex[:10]
    try:
        subprocess.run(['npm','--prefix',str(fixture),'ci','--ignore-scripts','--no-audit','--no-fund'],check=True)
        subprocess.run(['docker','build','-t',ssh_image,str(fixture/'image')],check=True)
        subprocess.run(['ssh-keygen','-q','-t','ed25519','-N','','-f',str(fixture/'keys/id_ed25519')],check=True)
        (fixture/'keys/id_ed25519.pub').chmod(0o644)
        cid = subprocess.check_output([
            'docker', 'run', '-d', '--name', name, '--label', 'orchmesh.experiment=phase-a',
            '--memory', '384m', '--cpus', '1', '-e', 'POSTGRES_PASSWORD=disposable-probe',
            '-e', 'POSTGRES_DB=phase_a', '-p', '127.0.0.1::5432', 'postgres:16.10'
        ], text=True).strip()
        dbport = subprocess.check_output(['docker', 'port', cid, '5432'], text=True).strip().rsplit(':', 1)[1]
        for _ in range(100):
            if subprocess.run(['docker', 'exec', cid, 'pg_isready', '-U', 'postgres'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                break
            time.sleep(.1)
        env = {**os.environ, 'PROBE_ROOT': str(root / 'state'),
               'PROBE_DB_URL': f'postgresql+psycopg://postgres:disposable-probe@127.0.0.1:{dbport}/phase_a',
               'PROBE_PORT': str(port), 'PROBE_BOOTSTRAPPED': '1', 'PROBE_SSH_FIXTURE':str(fixture), 'PROBE_IMAGE':ssh_image}
        if args.real_env:
            env['PROBE_REAL_ENV'] = str(args.real_env.resolve())
        subprocess.run([str(python), str(root / 'run.py')], env=env, check=True)
    finally:
        if cid:
            subprocess.run(['docker', 'rm', '-f', '-v', cid], check=True)
        subprocess.run(['docker','image','rm',ssh_image],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        (fixture/'keys/id_ed25519').unlink(missing_ok=True)
        print(f'Evidence retained at {root}', flush=True)


if os.environ.get('PROBE_BOOTSTRAPPED') != '1':
    if __name__ == '__main__':
        bootstrap()
    sys.exit(0)

# The remainder runs exclusively inside the scratch venv.
import httpx
from a2a.client import ClientFactory, ClientConfig
from a2a.types import (AgentCard, AgentInterface, AgentCapabilities, SendMessageRequest,
                      SendMessageConfiguration, Message, Part, Role, GetTaskRequest,
                      SubscribeToTaskRequest, TaskState)
ROOT = Path(os.environ['PROBE_ROOT'])
ROOT.mkdir(parents=True, exist_ok=True)
URL = 'http://127.0.0.1:' + os.environ['PROBE_PORT']
ENV = dict(os.environ)
if ENV.get('PROBE_REAL_ENV'):
    from dotenv import dotenv_values
    model = dotenv_values(ENV['PROBE_REAL_ENV'])
    for key in ['ORCHMESH_MODEL_BASE_URL', 'ORCHMESH_MODEL_API', 'ORCHMESH_MODEL_API_KEY',
                'ORCHMESH_MODEL_ID', 'ORCHMESH_MODEL_THINKING_FORMAT']:
        if model.get(key):
            ENV[key] = model[key]
proc = None
log = (HERE / 'service.log').open('a')
results = []


def req(path, post=False):
    with urllib.request.urlopen(urllib.request.Request(URL + path, data=b'' if post else None), timeout=5) as response:
        return json.load(response)


def wait(fn, seconds=40):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            value = fn()
            if value:
                return value
        except (OSError, ValueError):
            pass
        time.sleep(.1)
    raise TimeoutError(str(fn))


def start():
    global proc
    proc = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'service:app', '--app-dir', str(HERE),
                             '--host', '127.0.0.1', '--port', ENV['PROBE_PORT']], env=ENV, stdout=log, stderr=log)
    wait(lambda: req('/health')['ok'])


def kill():
    proc.kill()
    proc.wait(timeout=10)
    assert proc.returncode == -9
    time.sleep(.2)


def done(task):
    def status():
        value = req('/tasks/' + task)
        if value['workflow'] == 'ERROR':
            raise RuntimeError(value)
        return value if value['workflow'] == 'SUCCESS' else None
    return wait(status, 120)


def record(name, **fields):
    entry = {'name': name, 'passed': True, **fields}
    results.append(entry)
    print(json.dumps(entry), flush=True)
    (HERE / 'results.json').write_text(json.dumps(results, indent=2))


def new_task(prefix):
    return prefix + '-' + uuid.uuid4().hex[:8]


async def cold_subscription():
    task = new_task('sse')
    card = AgentCard(name='probe', version='1', supported_interfaces=[AgentInterface(
        url=URL + '/a2a', protocol_binding='JSONRPC', protocol_version='1.0')], capabilities=AgentCapabilities(streaming=True))
    async with httpx.AsyncClient(timeout=30) as http:
        client = ClientFactory(ClientConfig(streaming=False, httpx_client=http)).create(card)
        async for _ in client.send_message(SendMessageRequest(message=Message(
            message_id=task, role=Role.ROLE_USER, parts=[Part(text=task)]),
                configuration=SendMessageConfiguration(return_immediately=True))):
            pass
        wait(lambda: (ROOT / task / 'ready').exists())
        a2a_id = req('/tasks/' + task)['record']['a2a_id']
        previous_child = int((ROOT / task / 'ready').read_text())
        kill()
        start()
        async def release():
            for _ in range(200):
                child = int((ROOT / task / 'ready').read_text())
                if child != previous_child:
                    break
                await asyncio.sleep(.05)
            assert child != previous_child
            await asyncio.sleep(.3)
            (ROOT / task / 'release').write_text('resume')
            os.kill(child, signal.SIGKILL)
        release_task = asyncio.create_task(release())
        try:
            client = ClientFactory(ClientConfig(streaming=True, httpx_client=http)).create(card)
            states = []
            async for event in client.subscribe(SubscribeToTaskRequest(id=a2a_id)):
                payload = event.WhichOneof('payload')
                state = event.task.status.state if payload == 'task' else event.status_update.status.state if payload == 'status_update' else None
                states.append(state)
                if state == TaskState.TASK_STATE_COMPLETED:
                    break
            await release_task
            final = await client.get_task(GetTaskRequest(id=a2a_id))
            assert final.status.state == TaskState.TASK_STATE_COMPLETED and len(final.artifacts) == 1
            record('Official A2A cold subscription', task=task, states=states)
        finally:
            if not release_task.done():
                release_task.cancel()


async def admission_gap():
    task=new_task('admission')
    card=AgentCard(name='probe',version='1',supported_interfaces=[AgentInterface(url=URL+'/a2a',protocol_binding='JSONRPC',protocol_version='1.0')],capabilities=AgentCapabilities(streaming=True))
    async with httpx.AsyncClient(timeout=30) as http:
        client=ClientFactory(ClientConfig(streaming=False,httpx_client=http)).create(card)
        async def send():
            async for _ in client.send_message(SendMessageRequest(message=Message(message_id=task,role=Role.ROLE_USER,parts=[Part(text=task)]),configuration=SendMessageConfiguration(return_immediately=True))):
                pass
        pending=asyncio.create_task(send())
        for _ in range(400):
            if (ROOT/task/'admission-ready').exists() and (ROOT/task/'ready').exists():break
            await asyncio.sleep(.05)
        assert (ROOT/task/'admission-ready').exists() and (ROOT/task/'ready').exists()
        a2a_id=req('/tasks/'+task)['record']['a2a_id']
        try:
            await client.get_task(GetTaskRequest(id=a2a_id))
            raise AssertionError('A2A projection unexpectedly already exists')
        except Exception as error:
            from a2a.utils.errors import TaskNotFoundError
            assert isinstance(error,TaskNotFoundError),str(error)
        kill()
        pending.cancel()
        try:await pending
        except (asyncio.CancelledError,Exception):pass
        (ROOT/task/'release').write_text('resume')
        start();done(task)
        final=await client.get_task(GetTaskRequest(id=a2a_id))
        assert final.status.state==TaskState.TASK_STATE_COMPLETED
        record('Durable admission before missing A2A projection',task=task)


try:
    start()
    task = new_task('rollback')
    assert 'error' in req('/tasks/' + task + '?rollback=true', True)
    assert req('/tasks/' + task) == {'record': None, 'workflow': None}
    record('Atomic Task and official enqueue rollback')
    for scenario in ['stream', 'after-dsh', 'collaboration', 'question', 'node-only', 'cancel'] + (['real'] if ENV.get('PROBE_REAL_ENV') else []):
        task = new_task(scenario)
        actual = 'stream' if scenario in ['node-only', 'cancel'] else scenario
        req('/tasks/' + task + '?scenario=' + actual, True)
        # A retry of the HTTP admission must return the same stable identity.
        assert req('/tasks/' + task + '?scenario=' + actual, True)['id'] == task
        if scenario == 'question':
            wait(lambda: any(x.get('event') == 'waiting-question' and x.get('task') == task
                            for x in map(json.loads, (ROOT / 'audit.jsonl').read_text().splitlines())))
            kill(); start()
            req('/tasks/' + task + '/answer', True)
            req('/tasks/' + task + '/answer', True)
        else:
            wait(lambda: (ROOT / task / 'ready').exists(), 120)
            child = int((ROOT / task / 'ready').read_text()) if scenario in ['stream', 'node-only', 'cancel', 'real'] else None
            if scenario == 'node-only':
                (ROOT / task / 'release').write_text('resume')
                os.kill(child, signal.SIGKILL)
            elif scenario == 'cancel':
                req('/tasks/' + task + '/cancel', True)
                wait(lambda: req('/tasks/' + task)['workflow'] == 'CANCELLED')
                wait(lambda: not Path('/proc/' + str(child)).exists())
                kill(); start()
                assert req('/tasks/' + task)['workflow'] == 'CANCELLED'
                record('Durable cancellation', task=task)
                continue
            else:
                kill()
                if child:
                    # A zombie is terminated too; it cannot write the Session.
                    def child_stopped():
                        path = Path('/proc/' + str(child) + '/stat')
                        return not path.exists() or path.read_text().split()[2] == 'Z'
                    wait(child_stopped)
                if scenario == 'stream':
                    start()
                    wait(lambda: int((ROOT / task / 'ready').read_text()) != child)
                    kill()
                (ROOT / task / 'release').write_text('resume')
                start()
        done(task)
        result = json.loads((ROOT / task / 'result.json').read_text())
        assert result['effectCount'] == 1
        if scenario == 'after-dsh':
            assert any(json.loads(x)['event']=='reuse-completed' for x in (ROOT/task/'audit.jsonl').read_text().splitlines())
            assert sum(json.loads(x)['event']=='model' for x in (ROOT/task/'audit.jsonl').read_text().splitlines())==2
        if scenario == 'collaboration':
            child_result = json.loads((ROOT / (task + '-child') / 'result.json').read_text())
            assert child_result['effectCount'] == 1
            child_calls = sum(json.loads(x)['event'] == 'model' for x in (ROOT / (task + '-child') / 'audit.jsonl').read_text().splitlines())
            assert child_calls == 2  # tool request + final, no replay
        if scenario == 'question':
            assert sum(x.get('event') == 'answer-received' and x.get('task') == task
                       for x in map(json.loads, (ROOT / 'audit.jsonl').read_text().splitlines())) == 1
        if scenario == 'real':
            assert any(json.loads(x)['event'] == 'inspect-effect' for x in (ROOT / task / 'audit.jsonl').read_text().splitlines())
        record(scenario + ' recovery', task=task, effectCount=1)
    task=new_task('sandbox')
    req('/tasks/'+task+'?scenario=sandbox-collaboration',True)
    child=task+'-child'
    wait(lambda:(ROOT/child/'sandbox-ready').exists(),120)
    manifest=json.loads((ROOT/child/'sandbox-result.json').read_text())
    containers=subprocess.check_output(['docker','ps','-a','--filter','id='+manifest['container'],'--format','{{.ID}}'],text=True).strip()
    assert not containers
    kill()
    (ROOT/child/'sandbox-release').write_text('resume')
    (ROOT/task).mkdir(exist_ok=True)
    (ROOT/task/'release').write_text('resume')
    start();done(task)
    assert Path(manifest['path']).read_text()=='NATIVE_WRITE\nNATIVE_BASH\n'
    events=[x for x in map(json.loads,(ROOT/'audit.jsonl').read_text().splitlines()) if x.get('event')=='sandbox-result' and x.get('task')==child]
    assert [x['reused'] for x in events]==[False,True]
    assert len({x['container'] for x in events})==1
    record('DBOS A2A DSH SSH full chain artifact checkpoint recovery',task=task,containerRecreated=False)
    asyncio.run(asyncio.wait_for(cold_subscription(), 60))
    asyncio.run(asyncio.wait_for(admission_gap(), 60))
    print('ALL PROBES PASSED', flush=True)
finally:
    if proc and proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill(); proc.wait(timeout=10)
    log.close()
