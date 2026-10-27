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
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import WorkingDirectory from '@deepseek-ai/dsh-working-directory';
import Bash from '@deepseek-ai/dsh-bash-sandbox';
import {ShellEnvRegistry as ShellEnv} from '@deepseek-ai/dsh-shell-env';
import * as ToolBash from '@deepseek-ai/dsh-tool-bash';
import * as ToolFs from '@deepseek-ai/dsh-tool-fs';
import * as Search from '@deepseek-ai/dsh-tool-fs-search';
const root=import.meta.dirname, phase=process.argv[2];const ctx=new Context(),fibers=[];let n=0;
async function plugin(p,c){const f=ctx.plugin(p,c);fibers.push(f);await f;}
class Model extends LlmAdapter{
 async resolveModel(provider,id){return {provider,id,name:id};}
 async *stream(opts){n++;
const calls=[['write',{file_path:'/workspace/native.txt',content:'NATIVE_WRITE\n'}],['bash',{command:'cat native.txt; printf "NATIVE_BASH\\n" >> native.txt',description:'verify official bash in SSH',workdir:'/workspace'}],['read',{file_path:'/workspace/native.txt'}],['grep',{pattern:'NATIVE',path:'/workspace/native.txt'}]];
if(n<=calls.length){const [name,args]=calls[n-1];yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'block-end',index:0,block:{type:'tool-call',id:`native-${n}`,name,arguments:JSON.stringify(args)}};yield {type:'finish',reason:{kind:'tool-calls'}};}else{const text='REMOTE_COMPLETE';yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text};yield {type:'block-end',index:0,block:{type:'text',text}};yield {type:'finish',reason:{kind:'stop'}};}}

}
try{
for(const p of [Llm,Sessions,Projection,Prompt,Tools,Agents])await plugin(p);
await plugin(Jsonl,{root:process.env.PROBE_SESSION_ROOT??root+'/session-state',compression:'none'});await plugin(Loop,{agents:[]});await plugin(Checkpoint);ctx.llm.registerAdapter(['mock'],new Model());
if(phase!=='plain'){
await plugin(SandboxPolicyService,{mode:'workspace-write',workspaceRoot:'/workspace'});
await plugin(SshConnection,{host:'phase-a',launch:{kind:'node-script',node:'/usr/local/bin/node'},helper:'/opt/probe/node_modules/@deepseek-ai/dsh-ssh/lib/helper.js',helperHash:createHash('sha256').update(readFileSync(root+'/node_modules/@deepseek-ai/dsh-ssh/lib/helper.js')).digest('hex'),workspace:'/workspace',leaseMs:5000});
for(const p of [SshFileSystem,SshSubprocessRuntime,SshSandboxProvider])await plugin(p);
await plugin(WorkingDirectory,{defaultDirectory:'/workspace'});await plugin(Bash,{cwd:'/workspace'});await plugin(ShellEnv);await plugin(ToolBash);await plugin(ToolFs);await plugin(Search,{sampleOverCapGlobResults:false});
}
const options={provider:'mock',model:'mock'};
const {agent}=phase==='plain'?await ctx.agents.create({sessionId:process.env.PROBE_SESSION_ID??'same-task-session',agentOptions:options}):await ctx.agents.resume({resumeSessionId:process.env.PROBE_SESSION_ID??'same-task-session',agentOptions:options});
agent.followup(createUserMessage({content:[{type:'text',text:phase==='plain'?'Plan report and request code':'Continue with authorized temporary execution environment'}],source:{kind:'user'}}));await agent.whenIdle();await ctx.sessions.flush(agent.session);
const messages=agent.session.deriveMessages();if(phase!=='plain')assert.match(JSON.stringify(messages),/REMOTE_COMPLETE/);
const nativeResults=messages.filter(m=>m.role==='tool').slice(-4);assert.equal(nativeResults.length,4);assert.ok(nativeResults.every(m=>!m.isError));
if(process.env.PROBE_ARTIFACT_OUTPUT){mkdirSync(process.env.PROBE_ARTIFACT_OUTPUT,{recursive:true});writeFileSync(process.env.PROBE_ARTIFACT_OUTPUT+'/report.txt',await ctx.fs.readText(await ctx.fs.resolve('/workspace/native.txt')));}
writeFileSync(root+`/session-${phase}.json`,JSON.stringify({phase,calls:n,messages},null,2));console.log(JSON.stringify({phase,calls:n,sessionId:agent.session.id,remote:phase!=='plain'}));
}finally{for(const f of fibers.reverse())await f.dispose();}
