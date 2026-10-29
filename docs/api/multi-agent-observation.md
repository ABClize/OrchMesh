# 多智能体观测接口（前端接入契约）

本接口只读，不改变调度、恢复或工具执行。前端可以自行设计树、节点连线、泳道和执行详情。无需 Affect UI，也不依赖其数据类型。

## 数据来源与边界

- 平台 `Task` 提供调用身份、归属、父子调用关系和最终状态；图由这些记录按 Agent 聚合。`TaskWait` 提供详情中的**当前**等待依赖。
- DSH 官方 `sessionPersistence.open(id, "read")` / `handle.read(offset, length)` 提供经过官方校验的真实日志，保留 `seq`、`time`、`type`。不直接解析 JSONL，不写第二套事件数据库，不抢占写句柄。
- 不使用冷读取器补出的虚拟中断事件作为游标。重启后同一 task 的真实事件序号不变；新读进程无需内存缓存即可回放。
- 实时快照复用运行器已经接收的官方流式事件及聊天投影。历史事件在官方持久化可见后出现；实时文本可能领先于日志。未持久化的流式片段不保证崩溃后可回放。
- `resuming_or_transitioning` 只表示活动任务当前没有本 API 进程的 worker 投影，不能据此断言刚刚发生重启或 worker 故障。
- 不提供虚构进度百分比、费用或精确恢复次数。Token 仅在官方 `assistant/message.usage` 存在时可用。`step/start` 是一步模型调用和工具执行的起点，不等于精确模型请求开始时间。

## 认证

所有请求使用 `Authorization: Bearer <access_token>`。普通用户只允许查看自己所属任务；管理员可通过管理后台跨用户只读查看任务、调用图、历史与实际提示词。此权限不授予停止任务、回答问题或访问其他用户文件的能力。管理员也可以查看已删除对话留下的任务链路。不存在和无权限均返回 404。SSE 在响应头发送前校验归属和游标，并在连接中持续校验令牌。

浏览器用支持自定义 headers 的 fetch SSE 客户端；不要把令牌放 URL。原生 EventSource 不能设置本项目需要的 Authorization header。

## 接口目录

| 方法与路径 | 用途 |
| --- | --- |
| GET `/api/conversations/{conversation_id}/graph?root_id=…` | 获取调用图；省略 root_id 返回该对话的全部运行 |
| GET `/api/conversations/{conversation_id}/graph/events?root_id=…` | 图的 SSE 更新，包含新子任务和状态变化 |
| GET `/api/tasks/{task_id}` | 根任务或任意子任务的详情和当前消息 |
| GET `/api/tasks/{task_id}/history?after=-1&limit=100` | 分页回放官方持久事件 |
| GET `/api/tasks/{task_id}/events?after=-1` | 任务快照与可续读历史的 SSE |

交互沿用现有 `/api/tasks/{task_id}/answers` 和 `/api/conversations/{id}/stop`。本次没有增加独立取消子任务、重试或修改计划接口；不要仅因为界面有按钮就假设后端支持。

## 图：Agent 节点与调用关系边

响应 `{ "nodes": [...], "edges": [...], "calls": [...] }`。同一 Agent 只显示一个节点，多次调用聚合；调用记录仍独立保留。

**聚合范围**：默认仅当前对话，root_id 指定后仅该轮根任务；不是账号全局统计。节点计数包括用户直接启动的根调用，边计数仅包括由父任务创建的子调用。

### nodes：Agent

| 字段 | 语义 |
| --- | --- |
| id | 稳定且带命名空间的图节点 ID，前端作为不透明标识使用 |
| agent_id | 普通 Agent 定义 ID；内置助手为 null |
| name | 所选范围中最新调用的冻结名称；各次历史名称仍在 calls 中 |
| version_ids | 此范围出现的版本 ID 去重列表 |
| task_ids | 该 Agent 的所有调用 ID，可逐个打开详情 |
| call_count / active_count | 总调用数 / queued、running、waiting 的调用数 |
| status_counts / activity_counts | 各状态的调用数，缺失键按0处理 |

按 Agent 定义 ID 聚合，不按名称或版本聚合；草稿 `draft:<id>` 与发布版本属于同一 Agent。内置助手固定为 `builtin:assistant`，创建助手为 `builtin:builder`；无法识别身份的历史记录用 `unknown:<task_id>`，避免误合并。普通节点 ID 为 `agent:<definition_id>`。

一个 Agent 可以同时有完成、失败和运行中的调用，因此不提供含糊的单一节点 status；前端使用计数决定展示。

### edges：Agent → Agent 调用关系

```json
{
  "id": "call:[\"builtin:assistant\",\"agent:translator\"]",
  "source": "builtin:assistant",
  "target": "agent:translator",
  "kind": "call",
  "task_ids": ["child-task-1", "child-task-2"],
  "call_count": 2,
  "active_count": 1,
  "status_counts": {"completed": 1, "running": 1}
}
```

相同 source、target 聚合为一条有向边，反向调用单独成边，Agent 调用自身保留自环。source/target 始终引用 nodes.id。边的 task_ids 是被调用任务 ID；在 calls 中按 ID 找到 parent_id，即可识别每次调用的父任务。点击边可列出每次调用，再打开 `/api/tasks/{task_id}`，其历史和实时流接口不变。

计数代表实际创建的任务调用，不把同一任务的恢复或重复工具请求计为新调用。调用完成后边仍保留。等待依赖**不再画成另一类边**，它仍通过任务详情 waiting_for 和 calls.activity 表达。

### calls：独立调用摘要

按 created_at、task ID 排序，节点及边的 task_ids 引用这里的 id。无需额外请求就能列出每次调用的目标、状态、版本和父任务；完整消息、文件和日志按需读取详情。

每次调用（calls 元素）的字段：

| 字段 | 语义 |
| --- | --- |
| id / root_id / parent_id | 本次调用 / 根调用 / 创建它的父调用；根调用 parent_id 为 null |
| conversation_id | 对话归属 |
| agent_id / version_id | 智能体与冻结版本；内置助手可为 null |
| name / prompt | 冻结的智能体名称 / 本次任务目标 |
| status | queued、running、waiting、completed、failed、stopped |
| activity | 下述面向观测的状态，不替代 status |
| worker_attached | 当前 API 进程是否持有实时消息投影，不是进程健康保证 |
| created_at | ISO 时间字符串；不是实际执行开始时间 |
| error | 平台的失败摘要，可为 null |
| sandbox_requested | 是否请求过执行环境，不表示容器当前仍在运行 |
| revision | 已有任务检查点版本；不是完整变化计数或缓存依据 |

activity：存在待答问题为 `waiting_user`，存在等待依赖为 `waiting_dependency`，有实时投影为 `executing`，其他活动且非 queued 为 `resuming_or_transitioning`，否则等于 status。

图 SSE 的 `graph` 事件每次发送完整替换快照（包含 nodes、edges、calls），约每秒检查，只有内容变化才发送。第一次必发；任务结束后连接继续保留以观察下一轮。断线重新连接即可获得最新图，不需要图游标。`unauthorized` 后重新登录。

## 任务详情

返回 calls 中调用摘要的全部字段，另含：

- `messages`：当前聊天投影；活跃任务含实时流式内容。消息格式沿用现有聊天接口，刷新时整体替换，勿与历史事件重复追加。
- `questions`：现有 DSH 提问批次，使用原 answers 接口作答。
- `waiting_for`：当前依赖任务 ID。
- `artifacts`：`{id,name,size,path}`；path 为已有文件接口支持的 `@artifacts/<id>/<name>`，不是宿主机文件路径。

点击 Agent 节点或调用边后，先通过 task_ids 和 calls 列出调用，再选择一次调用 GET 详情并订阅该 task 的 events。无需对所有调用同时建立日志流，调用图流已提供聚合状态和调用摘要。

## 历史分页与事件格式

`after` 为排他的官方事件序号，初始 -1。`limit` 为扫描的原始事件数（1–500，默认100）。

```json
{
  "events": [{
    "id": "task-id:12",
    "task_id": "task-id",
    "seq": 12,
    "time": 1793050000000,
    "type": "tool/call",
    "data": {"turn": 1, "step": 2, "callId": "call-1", "name": "start_agent_task", "arguments": "{}"}
  }],
  "next_after": 15,
  "has_more": true,
  "log_available": true
}
```

`time` 为 Unix 毫秒。游标属于单个任务，不可跨任务使用。**必须使用 next_after，而非最后一个可见事件的 seq**：内部事件被过滤后，空 events 也可能推进游标。has_more=true 时继续读取；false 仅表示这次读取已追上，并不表示任务结束。log_available=false 通常表示尚未生成日志，不代表任务失败。

公开事件及用途：

- `turn/start`、`turn/end`：轮次及结束原因；reason 只公开 kind。
- `step/start`、`step/end`：步骤区间，按 `(task_id,turn,step)` 关联。
- `tool/call`、`tool/result`：参数及输出；用 callId 与 result.message.source.callId 关联，检查 message.isError。中断后没有结果不能当作成功。
- `assistant/message`：最终消息、可选 usage、可选 interrupted；不重复返回原始逐 token stream。
- `assistant/attempt`：记录未形成最终消息的尝试边界，不暴露 provider 原始诊断。
- `llm/retry`、`llm/retry-started`：retryId、次数和可选延迟，用于呈现模型请求重试，不等于整个任务恢复次数。
- `user/message`：仅用户来源的消息，排除平台内部继续执行上下文。

屏蔽 system/developer prompt、request/header、工具内部 meta、provider failure 原始诊断及未知事件。工具参数和结果仍属于用户内容，可能包含用户主动交给模型的信息；前端不要将其未经转义作为 HTML 渲染。

## 任务 SSE 与断线恢复

发送 `Last-Event-ID: <task_id>:<seq>` 可覆盖 query after；错误格式或其他任务的 ID 返回422。

```text
event: snapshot
data: { ...TaskDetail }

event: history
id: task-id:15
data: { ...EventPage }

event: done
data: {"after":15}
```

- snapshot 无持久事件 ID，只表示最新可替换详情。首次必发，之后变化才发。
- history 是一页真实日志；记录其 id/next_after，按 task_id+seq 去重，重连时续读。
- done 表示任务已结束、当前 worker 投影已释放且本次日志已读完；客户端关闭连接。
- unavailable 表示读取失败，保留游标并退避重连；unauthorized 表示重新登录。不要清空已展示历史。
- 服务重启导致网络断开时，重连会先返回最新快照，再从已有日志游标继续；不要把断线本身渲染为任务失败。
- 仅历史事件可持久续读，过去每秒的状态快照并未另行存档。

## 性能与接入建议

首版状态推送为约1秒轮询；选中任务的日志通过只读 Node 进程调用官方 SDK，最多4个并发读取、单次15秒超时。无额外数据库或服务。日志分页限制返回事件数量，但官方 JSONL 校验仍可能扫描较大日志；大量同时订阅或超长日志尚未做负载验收。优先只订阅当前可见节点，页面退出时取消 fetch。

建议先做调用图＋节点详情，再用 turn/step/tool 事件做执行时间线。需要更多精确模型耗时、费用、历史等待跨度时再扩展契约，不应从 UI 组件样例数据推断后端事实。

## 验证与代码位置

- `apps/server/tests/test_observation.py`：跨用户保护、图边、游标校验、真实官方日志分页、全新读取实例回放、SSE 续读。
- `apps/runtime/observe-session.mjs`：官方只读持久化适配。
- `apps/server/src/orchmesh/platform/observation.py`：授权、公开字段、图和 SSE。
- `/openapi.json`：类型化的节点、边、详情、事件分页；SSE 事件名和语义以本文为准。

### 本次验收（2026-10-27）

后端确定性测试覆盖5个新增观测场景，包含真实 DSH persistence 写入及独立 Node 读取进程。未闭合 turn 的读取不会虚构中断事件，读取前后日志字节不变。

另使用已配置管理员账号，通过新应用的 ASGI HTTP 接口读取此前真实模型重启验收任务：当时任务图2节点、1条委派边（此后已改为本文的 Agent 聚合语义）；根任务读取到13条公开事件，扫描至官方 seq=23，子任务历史同样可读。没有执行新模型任务，没有终止或重启现有服务。因此本次证据是官方持久日志跨读进程回放及接口验收，不是又一次模型执行/整机故障注入。已启动的非热重载服务需重启后才会加载新路由。

### Agent 聚合契约更新

调用图现按 Agent 聚合，根/子任务详情及日志接口不变。测试覆盖同一 Agent 多次调用、跨版本与草稿聚合、正反向调用、自调用、计数与逐次详情访问、root_id 范围过滤。前端不应再将 graph.nodes.id 传给 `/tasks/`；应传 task_ids 或 calls.id。

### 异步委派观测（2026-10-27）

start_agent_task 返回即产生真实调用树节点和聚合关系；父级继续工作时不显示等待协作者。wait_for_tasks 建立显式依赖后，活动依赖才进入 waiting_dependency 观测；历史终态等待边不影响当前状态。节点和事件 API 不变。

瀑布图分别保留 start_agent_task 的短受理跨度、父级独立工具跨度及 wait_for_tasks 的收集跨度。两种工具的结果详情可按 task_id 跳转各协作调用；批量结果展示每个目标入口，复用现有详情、树祖先展开和订阅生命周期。当前瀑布图仍是所选调用的真实日志，不将子任务事件混入父级工具时间轴。

### 状态与结果分离（2026-10-27）

wait_for_tasks 支持 mode=any/all（默认all），仅返回 `{mode,tasks:[{task_id,agent_id,name,status}]}`。any返回时可同时包含终态和运行中任务；它不是“下一个未读事件”，传入已终态任务会立即满足条件。list_agent_tasks返回同样的状态条目，不附带任务正文、历史、摘要或成果。

get_task_result 是唯一的新显式成果读取工具：未完成返回身份状态，终态返回最终输出；不阻塞，不回传完整历史。不提供阻塞式委派工具。没有自动消息注入或主Agent主动通知唤醒功能，状态通过查询/等待工具获知。

瀑布图详情标识“等待任意一个完成”“等待全部完成”“按需读取最终结果”，各状态和结果工具的任务引用均可跳转原调用详情。等待结束清理活动依赖，不让any中未完成的其他任务继续把主Agent标为等待；完整审计仍由官方tool/call、tool/result日志保留。

### 全链路瀑布图生命周期（2026-10-27）

TaskNode/TaskDetail新增可空finished_at。新任务完成、失败、停止时在同一状态事务写入UTC结束时间，重复终态发布保留原时间。起点使用created_at，故生命周期包含排队、执行和等待。旧记录不回填推测值；缺失结束时间明确标为“结束时间未记录”。迁移ab04e1f29117仅新增可空列。

桌面协作默认全链路瀑布图。默认只展示所有Agent生命周期，按父子顺序缩进；Agent行展开只展示其工具与重试事件，不隐藏后代Agent。工具与等待来自原DSH日志，经原Trace事件适配器配对，所有条目统一绝对时间轴。未持久记录的等待细分不推算为新的span；生命周期与工具之间的间隙保留。

复用原graph SSE、授权history分页、TraceWaterfall、AnimatedDisclosure和调用详情。仅展开调用读取日志，浏览器最多3个并发请求，每页200条；积压分页读完后活动任务约1.5秒补读，终态读完停止。折叠/范围切换/离页取消请求，恢复展开保留游标和已读记录。图连接中断停止时间外推与执行动画。概览工具计数仅为当前显示记录，不冒充整个协作的工具总数。
