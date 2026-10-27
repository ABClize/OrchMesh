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
import {UserQuestionService} from '@deepseek-ai/dsh-user-questions';
import * as Ask from '@deepseek-ai/dsh-tool-ask-user';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const root=import.meta.dirname,phase=process.argv[2],ctx=new Context(),fibers=[];let calls=0;
async function plugin(p,c){const f=ctx.plugin(p,c);fibers.push(f);await f;}
class Model extends LlmAdapter{
 async resolveModel(provider,id){return {provider,id,name:id};}
 async *stream(options){calls++;
 if(phase==='seed'&&calls===1){yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'block-end',index:0,block:{type:'tool-call',id:'question-call',name:'ask_user_question',arguments:JSON.stringify({questions:[{id:'format',question:'Which format?',options:[{label:'Markdown'},{label:'HTML'}]}],timeout:1})}};yield {type:'finish',reason:{kind:'tool-calls'}};}
 else {const text=phase==='seed'?'WAITING_FOR_ANSWER':'ANSWER_RECEIVED';yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text};yield {type:'block-end',index:0,block:{type:'text',text}};yield {type:'finish',reason:{kind:'stop'}};}}
}
for(const p of [Llm,Sessions,Projection,Prompt,Tools,Agents])await plugin(p);
await plugin(Jsonl,{root:root+'/question-state',compression:'none'});await plugin(Loop,{agents:[]});await plugin(Checkpoint);await plugin(UserQuestionService);await plugin(Ask,{mode:'timed',timeout:1});ctx.llm.registerAdapter(['mock'],new Model());
const options={provider:'mock',model:'mock'};const {agent}=phase==='seed'?await ctx.agents.create({sessionId:'question-session',agentOptions:options}):await ctx.agents.resume({resumeSessionId:'question-session',agentOptions:options});
if(phase==='seed'){
agent.followup(createUserMessage({content:[{type:'text',text:'Prepare report but ask format'}],source:{kind:'user'}}));await agent.whenIdle();await ctx.sessions.flush(agent.session);writeFileSync(root+'/question-ready','ready');setInterval(()=>{},1000);
}else{
const answer={answers:[{id:'format',selected:['Markdown']}]};
assert.equal(ctx.userQuestions.answer(agent,'question-call',answer),true);
let duplicate;try{ctx.userQuestions.answer(agent,'question-call',answer);}catch(e){duplicate=e.code;}assert.equal(duplicate,'REPLY_QUEUED');
await agent.whenIdle();await ctx.sessions.flush(agent.session);
const messages=agent.session.deriveMessages();const replies=messages.filter(x=>x.source?.kind==='user-question-reply');assert.equal(replies.length,1);assert.equal(ctx.userQuestions.answer(agent,'question-call',answer),false);
writeFileSync(root+'/question-result.json',JSON.stringify({calls,duplicate,replies,messages},null,2));console.log(JSON.stringify({calls,duplicate,replies:replies.length,answered:true}));for(const f of fibers.reverse())await f.dispose();
}
