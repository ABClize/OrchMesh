import {Context} from '@deepseek-ai/cordis';
import Llm,{LlmAdapter,createUserMessage} from '@deepseek-ai/dsh-llm';
import Sessions from '@deepseek-ai/dsh-session';
import Projection from '@deepseek-ai/dsh-session-projection';
import Prompt from '@deepseek-ai/dsh-system-prompt';
import Tools,{defineTool} from '@deepseek-ai/dsh-tools';
import Agents from '@deepseek-ai/dsh-agent';
import * as Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl';
import Loop from '@deepseek-ai/dsh-agent-loop';
import * as Checkpoint from '@deepseek-ai/dsh-session-checkpoint-policy';
import {SandboxPolicyService} from '@deepseek-ai/dsh-sandbox-policy';
import {SshConnection} from '@deepseek-ai/dsh-ssh';
import {SshFileSystem} from '@deepseek-ai/dsh-fs-ssh';
import {SshSubprocessRuntime} from '@deepseek-ai/dsh-subprocess-ssh';
import {SshSandboxProvider} from '@deepseek-ai/dsh-sandbox-ssh';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=import.meta.dirname, phase=process.argv[2];const ctx=new Context(),fibers=[];let n=0;
async function plugin(p,c){const f=ctx.plugin(p,c);fibers.push(f);await f;}
class Model extends LlmAdapter{
 async resolveModel(provider,id){return {provider,id,name:id};}
 async *stream(opts){n++;if(phase!=='plain'&&n===1){assert.match(JSON.stringify(opts.messages),/NEED_CODE/);yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'block-end',index:0,block:{type:'tool-call',id:`remote-${phase}`,name:'probe_remote',arguments:'{}'}};yield {type:'finish',reason:{kind:'tool-calls'}};}else{const text=phase==='plain'?'NEED_CODE':'REMOTE_COMPLETE';yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text};yield {type:'block-end',index:0,block:{type:'text',text}};yield {type:'finish',reason:{kind:'stop'}};}}
}
try{
for(const p of [Llm,Sessions,Projection,Prompt,Tools,Agents])await plugin(p);
await plugin(Jsonl,{root:root+'/session-state',compression:'none'});await plugin(Loop,{agents:[]});await plugin(Checkpoint);ctx.llm.registerAdapter(['mock'],new Model());
if(phase!=='plain'){
await plugin(SandboxPolicyService,{mode:'workspace-write',workspaceRoot:'/workspace'});
await plugin(SshConnection,{host:'phase-a',launch:{kind:'node-script',node:'/usr/local/bin/node'},helper:'/opt/probe/node_modules/@deepseek-ai/dsh-ssh/lib/helper.js',helperHash:createHash('sha256').update(readFileSync(root+'/node_modules/@deepseek-ai/dsh-ssh/lib/helper.js')).digest('hex'),workspace:'/workspace',leaseMs:5000});
for(const p of [SshFileSystem,SshSubprocessRuntime,SshSandboxProvider])await plugin(p);
ctx.tools.register(defineTool({name:'probe_remote',description:'test-only remote provider integration',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},async execute(){
 const file=await ctx.fs.resolve('/workspace/task.txt');await ctx.fs.writeText(file,'RESTORED_INPUT\n');
 const policy=await ctx.sandbox.confine(['/bin/bash','-c','cat task.txt; printf "ARTIFACT\n" >> task.txt'],{mode:'workspace-write',workspaceRoot:'/workspace'});
 const h=ctx.subprocess.spawn({argv:policy.argv,cwd:'/workspace',stdio:{stdin:'ignore',stdout:{maxBytes:4096},stderr:{maxBytes:4096}},graceMs:500});assert.equal((await h.done).exitCode,0);assert.equal(await h.waitForExit(),true);
 const result=await ctx.fs.readText(file);writeFileSync(root+`/artifacts/task-${phase}.txt`,result);return result;
}}));
}
const options={provider:'mock',model:'mock'};
const {agent}=phase==='plain'?await ctx.agents.create({sessionId:'same-task-session',agentOptions:options}):await ctx.agents.resume({resumeSessionId:'same-task-session',agentOptions:options});
agent.followup(createUserMessage({content:[{type:'text',text:phase==='plain'?'Plan report and request code':'Continue with authorized temporary execution environment'}],source:{kind:'user'}}));await agent.whenIdle();await ctx.sessions.flush(agent.session);
const messages=agent.session.deriveMessages();if(phase!=='plain')assert.match(JSON.stringify(messages),/REMOTE_COMPLETE/);
writeFileSync(root+`/session-${phase}.json`,JSON.stringify({phase,calls:n,messages},null,2));console.log(JSON.stringify({phase,calls:n,sessionId:agent.session.id,remote:phase!=='plain'}));
}finally{for(const f of fibers.reverse())await f.dispose();}
