# DSH Controller 与项目导航迁移核验

日期：2026-10-26。范围：实际发布的 `orchmesh-dsh:0.2.1-rc.3`，不是仅依据 master。本文补充此前能力审查，并取代其中“Controller 仍仅待评估”的结论；不是迁移完成报告。

## 结论

**可以直接加载官方 SessionController、WorkspaceController 和 WorkspaceRegistry，继续使用 SDK 的创建/恢复、通知与完成等待。无需引入官方 Web Server、Cookie 登录或另写 Agent 生命周期。** FastAPI 保留账号、所有权校验、HTTP/SSE 和容器生命周期；业务桥接层调用公开 Controller。

用户已明确项目尚未发布，不要求维持旧接口或双运行时。迁移应一次性收敛来源，保留现有账号、数据与文件。会话“移入项目仅改变分组”是当前产品语义，不能通过修改 cwd 代替。

## 实际组成与验证

以官方 `--profile sdk` 为基础，添加以下五个官方插件：

- `@deepseek-ai/dsh-workspace`
- `@deepseek-ai/dsh-client-connection`
- `@deepseek-ai/dsh-client-file-upload`
- `@deepseek-ai/dsh-api-session-controller`
- `@deepseek-ai/dsh-api-workspace-controller`

默认 SDK profile 已提供 typert、remote-access、agent-default-model、session-query-sqlite、session projections、attachments、agents、LLM 和持久化。`client-connection` 在无 webServer 时仍注册载体无关的 RPC/Fetch 服务；只有存在 webServer 时才挂载 Web 路由。这里不需要增加第二套认证。

SessionController 必需依赖为 `agentDefaultModel, agents, attachments, fileUploads, fs, llm, remoteAccess, sessions, sessionProjections, sessionQuery, typert, workspaceRegistry`。FileUploads 需要 `agents, attachments, commands, connection`；WorkspaceController 需要 `remoteAccess, typert, workspaceRegistry`。桥接插件还必须在自身 `inject` 中声明要读取的服务，不能绕过 Cordis 注入检查。

2026-10-26 使用实际镜像、临时 DSH_HOME、无真实凭据进行了组成测试：

1. 全部服务 ready；WorkspaceController.create、SessionController.create、置顶、inspect/page 成功。
2. 官方 SDK 创建 `sdk-owned-1` 后，Controller.resolveAgent 返回同一个 Agent 对象。
3. 临时本机假 OpenAI SSE 服务提供 `PROBE_OK`；Controller.selectModel → Controller.prompt → SDK server.wait 全链路成功，收到原生 assistant/message、turn/end completed 和 SDK idle。
4. Controller.rename 后，Controller.projections 返回 `title: Controller title` 及官方统计、inbox 等投影。

上述验证证明组成与 Agent 共用可行，不是项目真实模型或浏览器验收。测试文件仅位于 `/tmp/orchmesh-controller-probe.*`，未写入真实状态。

来源：[SDK server](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sdk/server/src/server.ts)、[SessionController](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/api/session-controller/src/index.ts)、[WorkspaceController](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/api/workspace-controller/src/index.ts)。签名同时核对镜像内 `lib/types/index.d.ts` 与实际 JS。

## 公开接口与接入约束

| 官方入口 | 用途与约束 |
| --- | --- |
| `workspaceController.create({path})` | 注册或复用已存在目录，返回 `{workspace, created}`；创建目录仍由平台负责。 |
| `workspaceController.rename({workspaceId,title})` | 官方标题唯一来源；非空且唯一，不应再向 SQL 同时写一份名称。 |
| `workspaceController.insertBefore(...)` / `insertSessionBefore(...)` | 复用项目与项目内会话排序。 |
| `workspaceController.pinSession({sessionId})` / `unpinSession(...)` | 复用官方置顶集合；会话须已被官方持久化或当前 Agent 识别。 |
| `workspaceController.archiveSession({sessionId})` / `unarchiveSession(...)` | 复用归档与活动检查；归档会清除置顶。 |
| `workspaceController.follow(signal)` | 完整初始导航状态与后续增量；控制桥可取初始状态后结束订阅。 |
| `sessionController.create({workspaceId?,cwd?,sessionId?,agentPreset?})` | workspaceId 与 cwd 不能同时指定。适合创建空会话；不能当 resume。 |
| `sessionController.resolveAgent(sessionId)` | 返回普通主会话 Agent 或错误；已验证支持 SDK 持有的 Agent。 |
| `sessionController.selectModel({sessionId,provider,model,reasoningEffort?})` | 官方模型选择、校验与持久化；同时涉及默认模型保存，应明确定义 `.env` 默认与会话选择的边界。 |
| `sessionController.prompt({requestId,sessionId,mode,content},signal)` | mode 为 queue/steer；使用官方入队与请求来源记录。 |
| `sessionController.cancel({sessionId})` | 保留 pending inbox；与清空排队消息的停止语义不同，需要明确 UI 语义。 |
| `sessionController.page(request,signal)` | 官方冷历史读取。`throughSeq` 是最后一条事件 seq，不能填事件数量。 |
| `sessionController.follow(request,signal)` | 官方历史/实时事件订阅。保留 SSE 与 assistant-ui 展示适配即可。 |
| `sessionController.projections({sessionId},signal)` | 官方标题、inbox、token 等投影；signal 是必传参数。 |

SDK.wait 依赖 SDK 自己持有的会话记录。因此执行路径应先 SDK 创建/恢复，再交给同一 context 的 Controller 提交/改设置，再 SDK.wait；不要 Controller.create 后直接假定 SDK 已登记。临时控制进程创建的新空会话，下次执行由 SDK.resume 接管。Controller.create 遇到已存在非空或忙碌会话可能生成另一个 ID，不能用它恢复历史对话。

来源：[SessionController command 实现](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/api/session-controller/src/commands.ts)、[SDK server](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sdk/server/src/server.ts)。

## 导航与目录设计

官方 Workspace 是“规范化真实目录”的登记，不是任意聊天文件夹。`Workspace.attachSession` 会读取持久化 header.cwd，规范化并验证目录存在，要求与 workspace.path 相同。因此不能用它实现跨 cwd 的纯导航移动，也不能继续把所有不同项目都登记成同一个 `/workspace`。

建议采用稳定、不可随项目重命名变化的容器路径，项目名只调用官方 rename。SQL 保留账号/owner 与官方 workspace ID 的关联，以及官方没有的项目归档、会话分组覆盖；删除重复的标题、置顶和会话归档写入逻辑。官方登记负责真实目录成员关系，平台分组覆盖负责用户确认的“仅移动分组”。

官方没有可恢复的项目归档；`delete` 仅删除登记，保留文件和会话，不等价于保留原 ID 的 archive。不能为了“全官方”改变已确认的归档行为。其余目录创建、用户路径授权、挂载规划仍是平台责任。

同用户持久化根和 registry 不能有多个进程并发修改。采用用户级互斥：正在执行时导航操作走当前 runtime 的官方服务；空闲时使用短生命周期控制容器。控制操作可临时挂载经授权的项目目录，执行容器只挂当前工作区，不需要常驻一个能访问全部项目的 Agent 主机。

历史 header 与文件引用不可通过随意改 JSONL 修复。一次性迁移须先盘点每个会话实际工作目录，确定稳定路径和原路径引用的解析策略，再执行备份与数据迁移；项目显示分组不作为文件访问根。旧 `/workspace` 记录、绝对文件引用、共享目录会话必须在同一映射规则下验收。Registry 的历史发现也会依据 cwd 登记项目，不能只改新建路径而忽略历史发现。

来源：[WorkspaceRegistry 实现](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/workspace/workspace/src/index.ts)。

## 必须覆盖的验收

- 重启后项目 ID、标题、排序、会话置顶/归档保持；归档后恢复不丢文件。
- SQL 空会话正确物化，官方不会因未知 ID 拒绝置顶/归档。
- 移动分组后 cwd、原文件卡片、预览下载保持；项目重命名不搬目录。
- 正在执行时导航修改不会启动第二个 writer；跨用户状态不能串用。
- 官方 Controller 提交后 SDK.wait 能完成；停止、排队、失败、重连行为明确。
- 使用管理员账号与真实模型验证新旧会话、项目内 Shell、文件交付、流式输出与停止。
