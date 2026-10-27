// Isolated phase-A probe. No application configuration or user files are loaded.
import {Context} from '@deepseek-ai/cordis';
import * as PiAI from '@deepseek-ai/dsh-llm-pi-ai';
import Llm,{LlmAdapter,createUserMessage} from '@deepseek-ai/dsh-llm';
import Sessions from '@deepseek-ai/dsh-session';
import Projections from '@deepseek-ai/dsh-session-projection';
import Prompt from '@deepseek-ai/dsh-system-prompt';
import Tools,{defineTool} from '@deepseek-ai/dsh-tools';
import Agents from '@deepseek-ai/dsh-agent';
import * as Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl';
import Loop from '@deepseek-ai/dsh-agent-loop';
import * as Checkpoint from '@deepseek-ai/dsh-session-checkpoint-policy';
import {mkdirSync,existsSync,writeFileSync,appendFileSync,readFileSync} from 'node:fs';
const [root,task,scenario]=process.argv.slice(2);
mkdirSync(root,{recursive:true});
let agent; const keepAlive=setInterval(()=>{},1000);
const isDone=(messages)=>messages.some(m=>m.role==='assistant' && m.content?.some(b=>b.type==='text'&&b.text.trim()==='TASK_DONE:'+task));
const audit=(event,data={})=>appendFileSync(root+'/audit.jsonl',JSON.stringify({event,pid:process.pid,...data})+'\n');
const chunks=function*(text){yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text};yield {type:'block-end',index:0,block:{type:'text',text}};yield {type:'finish',reason:{kind:'stop'}};};
class Mock extends LlmAdapter {
 async resolveModel(provider,id){return {provider,id,name:id};}
 async *stream(o){
  audit('model',{messages:o.messages});
  if(!existsSync(root+'/effect')){
   yield {type:'block-start',index:0,blockType:'tool-call'};
   yield {type:'block-end',index:0,block:{type:'tool-call',id:'count-once',name:'record_effect',arguments:'{}'}};
   yield {type:'finish',reason:{kind:'tool-calls'}};return;
  }
  if(scenario==='stream'&&!existsSync(root+'/release')){
   yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:'INCOMPLETE'};
   await ctx.sessions.flush(agent.session);writeFileSync(root+'/ready',String(process.pid));
   await new Promise(()=>{});
  }
  for(const c of chunks('TASK_DONE:'+task))yield c;
 }
}
const ctx=new Context();
for(const plugin of [Llm,Sessions,Projections,Prompt,Tools,Agents])await ctx.plugin(plugin);
await ctx.plugin(Jsonl,{root:root+'/sessions',compression:'none'});
await ctx.plugin(Loop,{agents:[]});await ctx.plugin(Checkpoint);
if(scenario==='real'){
 await ctx.plugin(PiAI,{providers:{project:{baseURL:process.env.ORCHMESH_MODEL_BASE_URL,api:process.env.ORCHMESH_MODEL_API||'openai-completions',apiKeyEnv:'ORCHMESH_MODEL_API_KEY',models:[{id:process.env.ORCHMESH_MODEL_ID,...(process.env.ORCHMESH_MODEL_THINKING_FORMAT?{compat:{thinkingFormat:process.env.ORCHMESH_MODEL_THINKING_FORMAT}}:{})}]}}});
}else ctx.llm.registerAdapter(['probe'],new Mock());
ctx.tools.register(defineTool({name:'inspect_effect',description:'Read whether the requested operation already completed. Always inspect before repeating an uncertain operation.',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},async execute(){audit('inspect-effect');return existsSync(root+'/effect')?'Already completed successfully; do not repeat.':'Not completed yet.';}}));
ctx.tools.register(defineTool({name:'record_effect',description:'Count an observable effect',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},async execute(){appendFileSync(root+'/effect','once\n');audit('effect');if(scenario==='real'&&!existsSync(root+'/release')){writeFileSync(root+'/ready',String(process.pid));await new Promise(()=>{});}return 'RECORDED';}}));
try {
 const resumed=existsSync(root+'/created');
 const opts=scenario==='real'?{provider:'project',model:process.env.ORCHMESH_MODEL_ID}:{provider:'probe',model:'deterministic'};
 agent=(resumed?await ctx.agents.resume({resumeSessionId:task,agentOptions:opts}):await ctx.agents.create({sessionId:task,agentOptions:opts})).agent;
 await ctx.sessions.flush(agent.session);writeFileSync(root+'/created','yes');
 const before=agent.session.deriveMessages();
 if(!isDone(before)){
  audit(resumed?'resume':'start');
  const queued=agent.inbox.nextTurn[0];
  if(queued){
   // Public inbox mutation + public delivery, in one synchronous JS turn.
   agent.inbox.splice('next-turn',0,1,[]);agent.followup(queued);
   audit('wake-existing',{id:queued.id});
  }else{
   agent.followup(createUserMessage({content:[{type:'text',text:resumed?'Continue saved work. A tool outcome may be unknown: call inspect_effect to verify it before claiming success. Do not repeat a completed effect. Then reply exactly TASK_DONE:'+task:'Call record_effect exactly once. If interrupted or outcome is unknown, use inspect_effect to check whether it completed before considering another call. When done, reply exactly TASK_DONE:'+task}],source:{kind:'user'}}));
  }
  await agent.whenIdle();await ctx.sessions.flush(agent.session);
 }else audit('reuse-completed');
 const messages=agent.session.deriveMessages();
 if(!isDone(messages))throw Error('missing durable final result');
 writeFileSync(root+'/result.json',JSON.stringify({task,resumed,messages,effectCount:readFileSync(root+'/effect','utf8').trim().split('\n').length}));
 clearInterval(keepAlive);await ctx.fiber.dispose();
}catch(e){console.error(e);process.exitCode=1;clearInterval(keepAlive);await ctx.fiber.dispose();}
