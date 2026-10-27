# DSH 重启恢复：发布包断进程实验

日期：2026-10-27。需求已明确：**首版必须在服务重启后自动接管并继续未完成任务**，不能仅提供人工重试。本文验证可复用的官方基础；不代表 OrchMesh 已实现该需求。

## 环境与方法

- Node.js `v24.21.0`；实际加载本机已有官方 npm `@deepseek-ai/* 0.2.1-rc.3` 发布包，未升级依赖。官方当前源码审查与版本差异见[能力核查](dsh-persistence-and-restart-recovery.md)。
- 所有脚本、日志、Session、模拟副作用均位于独立 `/tmp/orchmesh-dsh-recovery-20261027/`；依赖只读复用 `/tmp/orchmesh-dsh-runtime/node_modules`。没有读取模型凭据、使用账号、运行真实模型、操作 Docker 或现有服务及用户数据。
- 每案启动独立 Node 子进程，使用公开 `Context.plugin`、`ctx.agents.create/resume`、`Agent.followup/whenIdle`、Session persistence 和 Subagent API。确定性 `LlmAdapter` 代替远程模型；普通工具仅在本案目录追加一行作为可计数副作用。没有自写恢复引擎。
- Python 父进程等到受控故障点，发送真实 **SIGKILL**，确认退出码 **-9**，再启动全新 Node 进程恢复。不是同进程 dispose/resume，也不是仅阅读上游测试。
- 最终六案均加载官方 **`session-checkpoint-policy`**。现有 rc.3 `dsh-base/cordis.patch.yml:420` 已包含该插件，不需要平台重写模型请求/工具派发检查点。正常历史、待处理队列、手工创建的父级目录记录使用公开 `ctx.sessions.flush` 确认落盘边界；工具副作用实验专门**没有**手动 flush，由官方 policy 在派发前完成检查点。
- 早期探针记录保留在 `*-v2/v3/v4/v5`，以 `verified-run.log` 列出的时间戳目录为最终六案证据。最初日志序列化错误是实验脚本误序列化 Context 引用，已改为 inbox 数据快照。子任务早期探针未 flush 从未运行过的父级新 Session，导致父 Session 不存在；补明确持久化屏障后重测通过，不能将进程内 API 返回等同于落盘完成。

## 实测结果：6 / 6 通过

| 场景与故障点 | 新进程中的实际结果 | 能证明什么 / 不能证明什么 |
| --- | --- | --- |
| 正常问答完成并 flush 后 SIGKILL | 原问答与 `NORMAL_DONE` 保留；恢复 idle、模型调用 0；新 followup 正常完成 | 已完成历史可复用，无需重新生成 |
| 模型已输出 text-delta、尚未结束时 SIGKILL | 自动追加 `turn/end: interrupted`；输入保留；显式 followup 后正常继续 | 恢复闭合有效历史；**未完成的 `PARTIAL_STREAM` delta 没有持久保留**，不能承诺保存所有已显示 token |
| 同轮模型请求两个工具，首工具写一次 effect 后阻塞并 SIGKILL | 首工具补 `TOOL_OUTCOME_UNKNOWN`，第二工具补 `TOOL_NOT_STARTED`；副作用文件始终只有一行 | 官方区分已开始未知结果与未开始；不会自动重放副作用。确定性续轮也未主动再调用工具，不代表真实模型天然防重复 |
| 首轮模型阻塞，第二条 followup 已入队并 flush 后 SIGKILL | 第二条输入原 ID 和内容保留在 nextTurn；恢复后观察 300ms：idle、模型调用 0 | 队列持久化成立，但纯 resume 没有自动驱动。调用公开 followup 新增 `EXPLICIT_CONTINUE` 后，旧队列先处理，再处理新消息，共 2 次调用 |
| 子任务完成，caller 获得结果并 flush 父级记录后 SIGKILL | `listChildren` 找回同一 `child-session`；只读打开子 Session 即可取回 `NORMAL_DONE`，此时模型调用 0；`sendMessage` 冷恢复继续，模型上下文含旧结果 | 完成成果可冷读复用，子任务可继续。**未精准模拟完成后、父级通知前崩溃窗口**，不能据此声称通知恰好一次 |
| 子任务模型流进行中 SIGKILL | 父级目录找回原子任务；官方 `sendMessage` 冷恢复子级，追加 interrupted 封口，完成新一轮；父级收到随后产生的完成通知 | 活跃子级可基于已有 Session 重建继续；不恢复原 JS 栈或原模型连接 |

`child` 与 `childstream` 恢复阶段总计 2 次模拟模型调用：子级处理新消息一次、父级处理完成通知一次。不是同一子任务被执行两次。

**唤醒限定：** 本轮使用新增 followup 唤醒，未重复发送原队列消息；尚未验证是否有更合适的官方 Controller 启动路径可以无新增消息接管。不能把“等待 300ms 未运行”扩大为所有官方 Host/profile 永远不会自行唤醒；本轮验证的是所列公开插件组合。

## 原始证据与复现

总日志：`/tmp/orchmesh-dsh-recovery-20261027/verified-run.log`。各案 `result.json` 包含恢复前事件、inbox、消息和后续消息；`calls-*.jsonl` 保存模拟模型请求；`seed.log` / `resume.log` 保存进程日志；工具案 `effect-count` 是副作用计数。

| 案例 | 本次最终证据目录（位于上述根目录） |
| --- | --- |
| normal | `normal-1793051245971632231/` |
| stream | `stream-1793051246829005927/` |
| tool | `tool-1793051247685018620/` |
| inbox | `inbox-1793051248558078875/` |
| child | `child-1793051249406971478/` |
| childstream | `childstream-1793051250288617224/` |

本机复现：

```sh
python /tmp/orchmesh-dsh-recovery-20261027/run.py
```

每次生成新时间戳目录，不覆盖既有证据。脚本只杀自己创建的子进程。执行后检查确认无本次 worker/run.py 残留。`/tmp` 不是永久存储；下面附完整脚本，便于之后在新临时目录重建，`node_modules` 应指向相同 rc.3 依赖集。复现不需要管理员或真实模型凭据。

## 首版最小平台差距

1. **复用官方持久化与检查点。** 沿用 Session JSONL、checkpoint policy、Agent resume、inbox、子级 catalog 和 sendMessage；不要复制消息日志或 Agent Loop。
2. **平台持久保存任务身份和接管依据。** 包括目标、固定发布版本、Session/子级关联、已知成果和恢复状态；服务启动后选出未完成任务并经公开接口接管，避免两执行者领取同一任务。具体机制仍待设计。
3. **恢复是核对后继续。** `TOOL_NOT_STARTED` 可按任务需要重新执行；`TOOL_OUTCOME_UNKNOWN` 要先查产物/操作状态，不能一律重放。已完成子级成果可读取，无须再派相同工作。
4. **自动接管不能只调用 resume。** 本实验纯 resume 保持 idle。还要明确官方驱动入口、队列去重与版本装配；不能将新增恢复提示变成无界重复消息。
5. **保存独立于临时沙盒的恢复材料。** 任务事件、输入文件、成果与必要中间产物需有稳定存储；此次没有验证沙盒重建，更未恢复 Shell 进程。

## 未实测与仍需验收

- 官方 SDK/完整 Host profile、HTTP/SSE、真实模型、OrchMesh 自动重启接管端到端链路；本轮是官方发布包插件组合实验。
- 定时任务重投、timed/continued 问题恢复及 blocking 问题差异、审批等待、固定旧 preset 版本。
- 精确父子完成通知丢失窗口、并发接管、恢复中再次崩溃、磁盘故障/断电、未确认入队持久化就退出。
- `jobs-local`/Shell 重启后进程恢复（官方不提供）；临时沙盒重建及输出下载引用。
- 真实模型是否正确识别未知副作用并核对：本实验只确认官方错误语义和没有运行时自动重放。

官方依据：[检查点策略](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/session/session-checkpoint-policy/README.zh.md)、[Agent resume](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/core/agent-loop/src/index.ts#L753-L826)、[中断工具修复](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/core/session/src/repair.ts#L14-L51)、[子智能体](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/subagent/subagent/README.zh.md)。固定 commit 与 rc.3 不是逐文件等同；上述“通过”来自 rc.3 实际运行结果。

<details>
<summary>复现脚本：worker.mjs</summary>

```javascript
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, {LlmAdapter,createUserMessage} from '@deepseek-ai/dsh-llm';
import SessionStore from '@deepseek-ai/dsh-session';
import Projections from '@deepseek-ai/dsh-session-projection';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Tools,{defineTool} from '@deepseek-ai/dsh-tools';
import Agents from '@deepseek-ai/dsh-agent';
import * as Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl';
import Loop from '@deepseek-ai/dsh-agent-loop';
import * as Checkpoint from '@deepseek-ai/dsh-session-checkpoint-policy';
import Subagents from '@deepseek-ai/dsh-subagent';
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process';
import FS from '@deepseek-ai/dsh-fs-local';
import WorkingDirectory from '@deepseek-ai/dsh-working-directory';
import Query from '@deepseek-ai/dsh-session-query';
import {writeFileSync,appendFileSync} from 'node:fs';
const [root,scenario,phase]=process.argv.slice(2); let calls=0; let agent;
const text=(s)=>[{type:'block-start',index:0,blockType:'text'},{type:'text-delta',index:0,text:s},{type:'block-end',index:0,block:{type:'text',text:s}},{type:'finish',reason:{kind:'stop'}}];
class Adapter extends LlmAdapter {
 async resolveModel(provider,model){return {provider,id:model,name:model};}
 async *stream(options){calls++; appendFileSync(root+'/calls-'+phase+'.jsonl',JSON.stringify({messages:options.messages})+'\n');
 if(phase==='seed' && ['stream','inbox','childstream'].includes(scenario)){yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:'PARTIAL_STREAM'};setTimeout(async()=>{if(scenario==='inbox')agent.followup(msg('QUEUED_SECOND'));if(scenario!=='childstream')await ctx.sessions.flush(agent.session);ready();},30);await new Promise(()=>{});}
 else if(phase==='seed'&&scenario==='tool'){yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'block-end',index:0,block:{type:'tool-call',id:'call1',name:'probe',arguments:'{}'}};yield {type:'block-start',index:1,blockType:'tool-call'};yield {type:'block-end',index:1,block:{type:'tool-call',id:'call2',name:'probe',arguments:'{}'}};yield {type:'finish',reason:{kind:'tool-calls'}};}
 else {for(const c of text(phase==='seed'?'NORMAL_DONE':'CONTINUED_DONE'))yield c;}}
}
const ctx=new Context();for(const p of [LlmRuntime,SessionStore,Projections,SystemPrompt,Tools,Agents])await ctx.plugin(p);
await ctx.plugin(Jsonl,{root:root+'/sessions',compression:'none'});await ctx.plugin(Loop,{agents:[]});await ctx.plugin(Checkpoint);if(['child','childstream'].includes(scenario)){await ctx.plugin(FS,{cwd:root});await ctx.plugin(WorkingDirectory,{defaultDirectory:root});await ctx.plugin(Query);await ctx.plugin(Subagents);await ctx.plugin(Spawn,{providerName:'spawn'});}ctx.llm.registerAdapter(['mock'],new Adapter());
ctx.tools.register(defineTool({name:'probe',description:'deterministic effect probe',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},async execute(){appendFileSync(root+'/effect-count','effect\n');ready();await new Promise(()=>{});}}));
const msg=(text)=>createUserMessage({content:[{type:'text',text}],source:{kind:'user'}});
const ready=()=>{writeFileSync(root+'/ready',String(process.pid));console.log('READY',process.pid);};
const options={provider:'mock',model:'mock'};
try{
agent=(phase==='seed'?await ctx.agents.create({sessionId:'test-session',agentOptions:options}):await ctx.agents.resume({resumeSessionId:'test-session',agentOptions:options})).agent;
if(phase==='seed'){
 if(['child','childstream'].includes(scenario)){const activation=await ctx.subagents.startActivation({provider:'spawn',childId:'child-session',label:'durable child',request:{parent:agent,prompt:[{type:'text',text:'CHILD_TASK'}]},signal:new AbortController().signal,delivery:'caller'});await ctx.sessions.flush(agent.session);if(scenario==='child'){const result=await activation.result;writeFileSync(root+'/child-result.json',JSON.stringify(result));await ctx.sessions.flush(agent.session);ready();}}else if(scenario==='normal'){agent.followup(msg('NORMAL_QUESTION'));await agent.whenIdle();await ctx.sessions.flush(agent.session);ready();}else agent.followup(msg('START_TASK'));
 setInterval(()=>{},1000);
}else{
 await new Promise(r=>setTimeout(r,300));
 const h=await ctx.sessionPersistence.open('test-session','read');const stored=await h.read();await h.close();
 const before={calls,status:agent.status,inbox:JSON.parse(JSON.stringify({nextTurn:agent.inbox.nextTurn,nextStep:agent.inbox.nextStep})),events:stored.events,messages:agent.session.deriveMessages()};
 if(['child','childstream'].includes(scenario)){before.children=await ctx.subagents.listChildren(agent.session.id);const childHandle=await ctx.sessionPersistence.open('child-session','read');before.childStored=await childHandle.read();await childHandle.close();await ctx.subagents.sendMessage(agent,'child-session',[{type:'text',text:'CHILD_FOLLOWUP'}],{signal:new AbortController().signal});await ctx.subagents.waitForChildren(agent);}else agent.followup(msg('EXPLICIT_CONTINUE'));await agent.whenIdle();await ctx.sessions.flush(agent.session);
 let childAfter;if(['child','childstream'].includes(scenario)){const ch=await ctx.sessionPersistence.open('child-session','read');childAfter=await ch.read();await ch.close();}
 writeFileSync(root+'/result.json',JSON.stringify({before,childAfter,after:{calls,status:agent.status,inbox:JSON.parse(JSON.stringify({nextTurn:agent.inbox.nextTurn,nextStep:agent.inbox.nextStep})),messages:agent.session.deriveMessages()}},null,2));await ctx.fiber.dispose();
}
}catch(e){console.error(e);process.exit(1);}
```

</details>

<details>
<summary>复现脚本：run.py</summary>

```python
import subprocess,pathlib,time,json,os,signal
base=pathlib.Path(__file__).parent
for scenario in ['normal','stream','tool','inbox','child','childstream']:
 root=base/(scenario+"-"+str(time.time_ns()));root.mkdir(exist_ok=True)
 with open(root/'seed.log','w') as log:
  p=subprocess.Popen(['node',str(base/'worker.mjs'),str(root),scenario,'seed'],stdout=log,stderr=log)
  for _ in range(100):
   if (root/'ready').exists() or p.poll() is not None:break
   time.sleep(.1)
  if not (root/'ready').exists():
   if p.poll() is None:p.kill()
   raise RuntimeError(scenario+' SEED FAILED '+open(root/'seed.log').read())
  p.kill();p.wait();print(scenario,'killed',p.pid,'exit',p.returncode)
 result=subprocess.run(['node',str(base/'worker.mjs'),str(root),scenario,'resume'],capture_output=True,text=True,timeout=15)
 (root/'resume.log').write_text(result.stdout+result.stderr)
 if result.returncode:raise RuntimeError(scenario+' RESUME FAILED '+result.stderr)
 assert result.returncode==0
 data=json.loads((root/'result.json').read_text());b=data['before'];a=data['after'];print(scenario,json.dumps({'calls_before':b['calls'],'status':b['status'],'inbox':b['inbox'],'ends':[e for e in b['events'] if e['type'] in ['turn/end','tool/result']],'calls_after':a['calls'],'after_contains_done':'CONTINUED_DONE' in str(a)},ensure_ascii=False))

 assert b['calls']==0 and b['status']=='idle'
 assert 'CONTINUED_DONE' in str(a)
 if scenario=='normal': assert 'NORMAL_DONE' in str(b['messages'])
 if scenario in ['stream','inbox']:
  assert 'PARTIAL_STREAM' not in str(b['messages'])
  assert any(e['type']=='turn/end' and e['data']['reason']['kind']=='interrupted' for e in b['events'])
 if scenario=='tool':
  codes=[e['data'].get('error',{}).get('code') for e in b['events'] if e['type']=='tool/result']
  assert codes==['TOOL_OUTCOME_UNKNOWN','TOOL_NOT_STARTED'],codes
  assert (root/'effect-count').read_text().splitlines()==['effect']
 if scenario=='inbox':
  assert len(b['inbox']['nextTurn'])==1 and 'QUEUED_SECOND' in str(b['inbox']) and a['calls']==2
 if scenario in ['child','childstream']:
  assert b['children'][0]['id']=='child-session'
  assert 'CONTINUED_DONE' in str(data['childAfter'])
  if scenario=='child':assert 'NORMAL_DONE' in str(b['childStored'])
  else:assert any(e['type']=='turn/end' and e['data']['reason']['kind']=='interrupted' for e in data['childAfter']['events'])
 print('PASS',scenario,str(root))
```

</details>
