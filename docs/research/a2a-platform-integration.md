# A2A 与 OrchMesh 平台接入审查

审查日期：2026-10-27。范围：官方文档、Python SDK 源码、DSH 官方源码与本机 rc.3 类型声明；没有安装依赖、改动应用、启动服务或调用真实模型。本文的“可复用”表示源码确认存在公开接口，不表示已完成本项目集成验收。

## 结论

A2A 官方 Python SDK 已覆盖 Agent Card、协议路由、客户端、任务状态、SQLAlchemy 持久存储和共享任务事件流。OrchMesh 不需要重新实现 JSON-RPC、A2A SSE 编码、TaskStore 或 Agent Card 解析。平台仍须实现发布版本、发现策略、用户授权，以及 A2A 任务与 DSH 执行之间的适配。

默认调用路径建议明确为：**DSH 的发现/委派薄工具 → 平台协作服务 → 官方 Python A2A Client → 目标智能体的官方 A2A Handler → 执行适配器 → DSH**。平台内已发布智能体之间也走此路径；不要同时用本地 spawn 绕过 A2A 再声称进行了 A2A 协作。首版仅支持模型自主发现，不提供预编排。DBOS 拟承担持久控制流程，A2A 事件存储承担协议可观察状态；两者职责不同。本次未验证 DBOS 接口。

## 版本与证据范围

| 项目 | 核查版本 | 注意事项 |
| --- | --- | --- |
| A2A Python SDK | 最新发布 `v1.2.3`，源码 `44b2f761a99123370237afe6c828f4cd2a50c402` | SDK 版本不是协议版本；官方 README 声明支持协议 1.0，并兼容 0.3 |
| A2A 协议 | 最新发布 `v1.0.1` | 官网 latest 规范页面标题仍出现 1.0.0；SDK wire 常量为 `1.0`，不能据此判定不支持补丁版 |
| DSH 官方仓库 | HEAD `22ddee3792402c3e70ec5f86a63c3e3e895a2f60` | 已与远端 HEAD 核对；检查了本机 `0.2.1-rc.3` 已安装包的公开声明 |

SDK 1.2.3 包含协议 1.0 interface 选择时忽略 patch 版本等修复。接入应锁定可复现版本，不照搬旧版 Pydantic 类型、Application 封装或旧 handler 教程。当前 Python 3.12 满足 SDK 的 Python ≥3.10 要求；依赖组合尚未安装验证。[SDK release](https://github.com/a2aproject/a2a-python/releases/tag/v1.2.3)、[协议 release](https://github.com/a2aproject/A2A/releases/tag/v1.0.1)、[SDK README](https://github.com/a2aproject/a2a-python/blob/v1.2.3/README.md)

## 可以直接复用的公开接口

| 能力 | 官方接口 | 项目还需适配 |
| --- | --- | --- |
| 智能体描述 | `AgentCard`、`AgentSkill` 与官方 protobuf JSON 转换 | 从发布版本生成 Card；职责、技能、接口、认证声明，不暴露私有提示词、密钥和知识库内容 |
| Card HTTP 服务 | `create_agent_card_routes` | 动态智能体的 URL、版本选择和可见性；工厂提供 ETag，`card_modifier` 没有 Request 参数，不能直接当多用户授权目录 |
| FastAPI / Starlette | `create_jsonrpc_routes`、`create_rest_routes`、`add_a2a_routes_to_fastapi` | 接入现有认证与路径；协议路由和序列化交给 SDK |
| 标准任务处理 | `DefaultRequestHandler`，现为 `DefaultRequestHandlerV2` 别名 | 提供 `AgentExecutor.execute/cancel`，把标准消息、状态、产物连接到 DSH |
| 客户端 | `A2ACardResolver`、`ClientFactory` | 候选目录、调用凭据、目标授权与失败策略 |
| 普通 SQL 任务存储 | `DatabaseTaskStore` | 注入 SQLAlchemy AsyncEngine，选择表名、owner resolver 与迁移方式 |
| 并发任务和事件存储 | `VersionedDatabaseTaskStore` | 乐观版本与任务/事件同事务；不是执行队列 |
| 跨实例订阅 | `DatabaseTaskEventStream` | 与 versioned store 共享表；默认轮询间隔 0.5 秒，需测吞吐与延迟 |
| 更新事件 | `TaskUpdater`、`EventQueue` | DSH 事件映射，控制公开信息粒度 |

官方有 `fastapi`、`http-server`、`sqlite`、`postgresql`、`mysql`、`sql` extras。已有 SQL 实现时不再自写数据库 TaskStore；也不因存在共享订阅就提前另建 Redis 事件总线。应用使用 Alembic 时应统一 schema 生命周期，不能同时让多个组件盲目建表。SDK 支持 `create_table=False`，但具体迁移尚未验收。

源码：[routes](https://github.com/a2aproject/a2a-python/tree/v1.2.3/src/a2a/server/routes)、[handlers](https://github.com/a2aproject/a2a-python/tree/v1.2.3/src/a2a/server/request_handlers)、[普通 SQL store](https://github.com/a2aproject/a2a-python/blob/v1.2.3/src/a2a/server/tasks/database_task_store.py)、[versioned store](https://github.com/a2aproject/a2a-python/blob/v1.2.3/src/a2a/server/cluster/database_task_store.py)、[SQL event stream](https://github.com/a2aproject/a2a-python/blob/v1.2.3/src/a2a/server/cluster/database_event_stream.py)。

## 授权、发现与发布不由协议包办

Agent Card 可以通过 well-known URL、目录或预配置被发现；**目录查询 API、语义搜索、排名、自动选择协作者、广场、评论、审核和发布版本管理不属于 A2A 标准**。平台需要先限定授权可调用候选，再让模型按技能选择。Card 声明认证要求不等于授予访问权。[官方发现说明](https://a2a-protocol.org/latest/topics/agent-discovery/)

官方 `DefaultServerCallContextBuilder` 从 ASGI request scope 中读取用户和认证信息。默认 owner resolver 使用 `context.user.user_name`；Starlette 用户包装把它映射到 `display_name`。OrchMesh 应传入稳定用户 ID 或自定义 owner resolver，不能依赖可修改的展示名。

官方 FastAPI route 包装会直接使用 Starlette request-response endpoint；不要假定别的 API 上的 `Depends(current_user)` 自动保护新 A2A 路由。必须明确在认证 middleware / context builder 中验证 Bearer JWT，再分别检查目标智能体调用权限和任务 owner。公开 Card、认证后的扩展 Card、任务读写是不同权限面。不能把作者权限或模型凭据透传给调用者。

源码：[context builder](https://github.com/a2aproject/a2a-python/blob/v1.2.3/src/a2a/server/routes/common.py)、[FastAPI route helper](https://github.com/a2aproject/a2a-python/blob/v1.2.3/src/a2a/server/routes/fastapi_routes.py)、[owner resolver](https://github.com/a2aproject/a2a-python/blob/v1.2.3/src/a2a/server/owner_resolver.py)。

## ID、状态与恢复边界

| 标识 | 所有者 / 含义 | 不应混同 |
| --- | --- | --- |
| 发布智能体 ID + 版本 | 平台定义的可复用配置 | 某次执行、DSH Session |
| A2A `contextId` | 服务端对一组相关消息与任务的分组 | 完整用户记忆、平台全局聊天 ID；跨不同服务不能默认同一命名空间 |
| A2A `taskId` | 某个 A2A 服务上的具体任务 | DBOS workflow ID 或 DSH sessionId |
| 平台 run / workflow ID | 持久控制与父子委派关系 | 协议 Task 自动具备恢复程序计数器 |
| DSH `sessionId` | 执行器消息日志与会话实例 | 智能体定义；不能按公开 agentId 共用所有用户的 Session |
| DSH `parentSessionId` / childId | 本地子代理谱系，或 external 条目身份 | 跨平台全局父子关系、A2A 自动可恢复引用 |

应持久记录有权限作用域的映射：调用 run → 目标 endpoint/发布版本 → A2A context/task → 执行 run → DSH Session。跨智能体父子关系由协作服务记录；不要假定 DSH 本地 catalog 就是完整平台执行图。A2A `referenceTaskIds` 可表达关联，但不替代平台授权、编排依赖或恢复日志。

`completed/canceled/rejected/failed` 是终态，不能重启同一 Task；后续工作创建新任务，可以沿用 context。`input-required/auth-required` 可以等待进一步交互。A2A 不因此自动保存用户习惯记忆。[任务生命周期](https://a2a-protocol.org/latest/topics/life-of-a-task/)

### 订阅重连不是执行恢复

V2 handler 支持读取持久 Task 快照后订阅未来更新；配置 versioned SQL store 与 SQL event stream 后，可在另一 API 实例订阅。同一任务已终态时订阅接口会拒绝，应读取最终 Task。不要承诺精确重放所有原始 token 或浏览器 `Last-Event-ID` 游标语义。

ActiveTask registry 和执行协程仍在内存。重启后能查 Task、接续事件消费，不代表重建了之前的执行请求、DSH 进程、工具副作用或代码沙箱。DBOS 控制流程恢复、DSH 会话续接、工具幂等与产物持久化必须分别设计。A2A store 不替代工作流执行器。

### 取消需要停止真实执行

`AgentExecutor.cancel` 是应用实现职责。V2 handler 能取消本地 active task；跨实例取消可写入带版本的 canceled 状态，执行实例在后续保存时发现冲突。**这不等于立即向 DSH 或子进程发送停止信号**。协作服务要把取消传递到实际 run、DSH 子任务和临时沙箱，等待停止确认；不能仅把页面状态改成 canceled。

源码：[V2 handler](https://github.com/a2aproject/a2a-python/blob/v1.2.3/src/a2a/server/request_handlers/default_request_handler_v2.py)、[AgentExecutor](https://github.com/a2aproject/a2a-python/blob/v1.2.3/src/a2a/server/agent_execution/agent_executor.py)、[cluster 实现与测试](https://github.com/a2aproject/a2a-python/tree/v1.2.3/tests/server/cluster)。

## DSH 是否已有 A2A 接入

在上述官方 HEAD 的文件名、源码、文档、包清单以及已安装 rc.3 中，没有发现官方 A2A / Agent2Agent plugin、adapter 或 skill。这个结论仅覆盖本次检查的版本。官方 `dsh-subagent-acp` 是 ACP 子进程接入，**ACP 不是 A2A**，不能直接替代。

DSH 可以复用两类能力：

1. `agent-preset-registry` 和 `ctx.agentPresets.register(definition)` 组装职责、提示词、工具与 skills；`SessionController.create({ agentPreset, ... })` 创建相应会话。远程 preset 接口有读取和选择，没有通用 YAML 写入 API。需薄适配把平台允许的结构化定义转为可信组装。
2. 官方 subagent service 的本地执行/取消/结果/目录能力，适合执行器内部受控分工；它不是公开智能体目录，也不自动成为 A2A 调用路径。

Preset 是 Host 代码组装，不是安全沙箱。不要把用户生成的任意插件 YAML 或 `!!js` 作为可直接执行配置。会话保存 preset ID；重启后解析当前注册定义，不保留旧插件代际。发布版本必须有不可变定义绑定，否则编辑智能体会悄悄改变旧任务恢复后的行为。

源码：[preset registry](https://github.com/deepseek-ai/deepseek-harness/tree/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/preset/agent-preset-registry)、[Session Controller types](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/api/session-controller/src/types.ts)、[ACP](https://github.com/deepseek-ai/deepseek-harness/tree/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/subagent/subagent-acp)。

### external subagent provider 是否适合作 A2A Adapter

官方 `SubagentProvider.start(request)` 返回 `SubagentRun { id, result, dispose }`；`request.signal` 传递取消，`result` 提供 `SubagentResult`，`dispose()` 要停止并释放该次执行。当前公开类型没有名为 `serviceResult` 的额外持久恢复接口，不应依赖内部字段。

这个 seam 可以包装一次远程 A2A 执行并复用 DSH 子任务展示，但限制明确：external 不接受后续消息；其 childId 虽使用 SessionId 类型，却不表示存在本地可恢复 Session；`delivery: parent` 才记录外部 catalog，caller delivery 由调用方保存关系。只有 `prepareContinuable` 本地路径由 continuation manager 接管 cold resume。不能据此宣称 A2A 的 input-required、auth-required、父进程崩溃后的续接均已支持。

**默认不新增 external provider 作为第二条执行通道。** 用专用 discover/delegate 薄工具调用统一 Python 协作服务，复用官方 A2A Client；后续输入、查询与取消仍通过同一服务操作原 task。若未来需要官方子任务面板，可让 external provider 仅包装该服务返回的同一个委派记录，不再创建第二次执行。是否需要此 UI 包装应单独验证。

源码：[公开 provider/run 类型](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/subagent/subagent/src/types.ts)、[subagent 生命周期与恢复说明](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/subagent/subagent/README.zh.md)。

## 接入前必须通过的验收

- 发布版本生成 Card，官方 Client 能解析、协商 transport 并调用；未发布或无权限的目标不可调用。
- 两个用户不能互读 Task、产物或 context；扩展 Card 不泄露凭据；稳定 owner ID 不随用户名变化。
- SQL 存储跨 API 重启仍可查询结果；跨实例订阅和取消分别测试，不将状态更新误报为执行停止。
- 断开浏览器后任务继续；重连可见快照和新更新；已终态直接读取结果。
- `input-required/auth-required` 恢复到原 task；终态后创建新 task；审批和提问不会重复产生副作用。
- DSH / API / workflow 分别重启，核对任务与 Session 映射；发布新版本不改变已有执行绑定。
- 父任务取消能终止跨智能体委派与临时沙箱；重试不会重复创建子任务。跨服务的去重不能只假设 messageId 自动幂等。

以上均为待实施验收项，本次只完成官方能力和源码边界审查。
