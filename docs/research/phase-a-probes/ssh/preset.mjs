import {Context} from '@deepseek-ai/cordis';
import Llm,{LlmAdapter,createUserMessage} from '@deepseek-ai/dsh-llm';
import Sessions from '@deepseek-ai/dsh-session';
import Projection from '@deepseek-ai/dsh-session-projection';
import Prompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import Agents from '@deepseek-ai/dsh-agent';
import * as Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl';
import Loop from '@deepseek-ai/dsh-agent-loop';
import * as Checkpoint from '@deepseek-ai/dsh-session-checkpoint-policy';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import Group from '@deepseek-ai/cordis-plugin-group';
import Presets from '@deepseek-ai/dsh-agent-preset-registry';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const root=import.meta.dirname,phase=process.argv[2],ctx=new Context(),fibers=[];let calls=0;
async function plugin(p,c){const f=ctx.plugin(p,c);fibers.push(f);await f;}
const observed=[];
class Model extends LlmAdapter{
 async resolveModel(provider,id){return {provider,id,name:id};}
 async *stream(options){calls++;const systems=options.messages.filter(m=>m.role==='system');const raw=JSON.stringify(systems);const label=raw.includes('VERSION_V2')?'VERSION_V2':raw.includes('VERSION_V1')?'VERSION_V1':'MISSING';observed.push({label,systems});yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:label};yield {type:'block-end',index:0,block:{type:'text',text:label}};yield {type:'finish',reason:{kind:'stop'}};}
}
await plugin(Loader);ctx.loader.builtins.group=Group;
ctx.loader.builtins.marker={name:'marker',inject:['systemPrompt'],apply(ctx,config){ctx.effect(()=>ctx.systemPrompt.section({name:'version-marker',order:10,text:config.label}));}};
for(const p of [Llm,Sessions,Projection,Prompt,Tools,Agents])await plugin(p);
await plugin(Jsonl,{root:root+'/preset-state',compression:'none'});await plugin(Loop,{agents:[]});await plugin(Checkpoint);await plugin(Presets,{default:phase==='seed'?'report-v1':'report-v2'});ctx.llm.registerAdapter(['mock'],new Model());
await ctx.agentPresets.register({id:'report-v1',plugins:[{name:'cordis:marker',config:{label:'VERSION_V1'}}]});
if(phase!=='seed')await ctx.agentPresets.register({id:'report-v2',plugins:[{name:'cordis:marker',config:{label:'VERSION_V2'}}]});
const options={provider:'mock',model:'mock'};
const setup=async ctxAgent=>{await ctx.agentPresets.mount(ctxAgent,'report-v1');};
const {agent}=phase==='seed'?await ctx.agents.create({sessionId:'version-task',agentOptions:options,setup}):await ctx.agents.resume({resumeSessionId:'version-task',agentOptions:options,setup});
if(phase==='seed')await ctx.agentPresets.select(agent,'report-v1');
const msg=()=>createUserMessage({content:[{type:'text',text:'Report your configured version'}],source:{kind:'user'}});
agent.followup(msg());await agent.whenIdle();await ctx.sessions.flush(agent.session);assert.equal(observed[0].label,'VERSION_V1');
if(phase==='seed'){writeFileSync(root+'/preset-ready','ready');setInterval(()=>{},1000);}
else{
const fresh=await ctx.agents.create({sessionId:'new-version-task',agentOptions:options,setup:async c=>{await ctx.agentPresets.mount(c);}});
fresh.agent.followup(msg());await fresh.agent.whenIdle();await ctx.sessions.flush(fresh.agent.session);assert.equal(observed[1].label,'VERSION_V2');
writeFileSync(root+'/preset-result.json',JSON.stringify({observed,oldPreset:ctx.agentPresets.composedPreset(agent.ctx),newPreset:ctx.agentPresets.composedPreset(fresh.agent.ctx)},null,2));console.log(JSON.stringify({old:observed[0].label,new:observed[1].label}));for(const f of fibers.reverse())await f.dispose();
}
