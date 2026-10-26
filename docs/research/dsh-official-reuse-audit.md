# DSH 官方能力复用审查与调整方案

日期：2026-10-26。范围：当前 OrchMesh 已实现功能及其相邻能力，不宣称逐行审计上游全部包；只审查与制定方案，不迁移业务代码。

## 结论

### 用户确认的选型原则

2026-10-26：用户明确“一切优先用官方”。后续实施默认采用官方公开接口、插件、协议与数据模型；不因现有自定义代码已经写好就优先保留。不局限于 Python SDK，需同时检查 Node 公开服务与官方控制层。

- 官方已覆盖且行为适配的功能，替换自有实现；只保留鉴权、协议转换和产品展示所需的薄适配。
- 官方未覆盖的能力，先检查现成框架，再考虑最小自定义实现，并记录缺口和保留理由。
- 为复用官方能力可调整内部架构；不能据此破坏已有数据、文件引用或扩大目录访问权限。
- 已确认的产品行为与官方行为冲突时，明确列出差异后再决定取舍；“当前保留”表示迁移前的过渡状态，不是永久排除官方方案。
- 优先基于当前发布产物验证，不调用未公开内部接口，不用 master 文档冒充已安装版本能力。

本轮仍为调整方案，尚未开始业务迁移。

DSH 已经提供会话控制、项目登记、标题、置顶归档、文件交付、文件读取、历史查询与实时订阅。当前并非全部需要自行实现。最明确的重复是 `present_files`：官方 `present` 已提供持久化文件交付事件。历史查询、模型选择和部分事件投影也值得收敛到官方模块。

但 Python/stdin SDK、Node 插件服务、完整 Web Gateway 是三层不同接口。不能把后两层存在的功能宣称成 Python SDK 的现成功能，也不能为了减少几行代码就引入整个官方 Web 主机、扩大文件挂载或改掉已确认的产品语义。

## 证据与版本边界

- 实际镜像摘要：`sha256:c6eed133808ae739ef397929b13e161a2da6c9393d45b270fa516993f7bdbbd5`。
- 项目锁定 npm `0.2.1-rc.3`；检查实际 `orchmesh-dsh:0.2.1-rc.3` 镜像中的 `node_modules/@deepseek-ai/*/lib/types/*.d.ts` 与随包 README，而非只看仓库版本字段。
- 上游本地源码快照：`22ddee3792402c3e70ec5f86a63c3e3e895a2f60`，路径 `/tmp/orchmesh-dsh-audit`。下面的官方文档链接指向对应模块，线上 master 可能继续变化。
- **实际发布 SDK** 的 `HarnessSdkRequestMap` 只有 `initialize`、`session/prompt`、`session/resume`、`session/wait`、工作目录 get/set、`shutdown`；通知为 session event/status 和 subagent started/finished。
- **发布版与 master 有差异**：master 协议文档已有 `approvalRequests` / `approval/request`，实际镜像协议类型没有；不能承诺在当前 Python SDK 中直接复用这个审批回调。此前 `agent.model.select` 与公开 `installModelSelection` 的差异也说明同版本名不足以证明接口一致。
- 本次为源码、类型和组成审查；没有运行替代方案、迁移数据或调用真实模型，不能视为替代实现验收。

来源：[SDK 协议](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sdk/protocol/README.md)、[Python SDK](https://github.com/deepseek-ai/deepseek-harness/blob/master/python/sdk/README.md)。

## 功能对照与处置

| 范围 | 官方已有能力 | OrchMesh 当前实现 | 建议 |
|---|---|---|---|
| 执行、恢复、完成等待 | SDK prompt/resume/wait；原生 Agent Loop 与 JSONL | bridge 委托官方 Server；Manager 管理运行 | 保留薄适配，已经复用；不要重写循环或恢复算法 |
| 停止 | `Agent.cancel`；Session Controller.cancel | `orchmesh/stop` 调官方 cancel | 当前是合理适配；Controller.cancel 保留 pending inbox，而当前取消默认清空队列，不能直接替换 |
| 项目创建/重命名/排序 | WorkspaceRegistry.create、Workspace.setTitle、登记顺序 | SQL Project 与 REST | 功能重叠，但先解决稳定路径、进程生命周期和分组语义，短期保持 SQL 单一权威 |
| 会话置顶、归档/恢复 | WorkspaceRegistry.pinSession/archiveSession/unarchiveSession | Conversation 布尔字段、Run 检查 | 条件复用；官方归档会检查 turn/subagent/job/schedule，并清除置顶；迁移须确认 UX 和状态归属 |
| 项目归档 | 官方提供移除登记，保留文件/会话；重新添加是新项目 | Project.archived，可恢复原分组 | 语义不同，保留平台层，不用 remove 冒充 archive |
| 会话移动分组 | 官方项目成员以记录的目录为依据 | project_id 与稳定 workspace_project_id 分离 | 保留已确认语义；不可调用 cwd/set 去模拟“仅分组移动” |
| 标题 | session-title 持久化标题、手动改名、可选异步生成 | SQL title 与平台命名 | 可复用官方标题服务；迁移后 SQL 最多做投影缓存，不能两套来源同时写 |
| 模型与思考 | LLM 能力目录；Session Controller 模型选择及 `model/selection` 持久化投影 | DB reasoning、bridge WeakMap + installModelSelection | 当前调用公开接口合理；评估官方 Controller 的完整选择接口，避免自行维护 pending/lastUsed；Controller.selectModel 还有后台保存默认值的语义，需保留当前 .env 与每会话设置边界 |
| 冷历史读取 | sessionQuery.readSession/readTitleSnapshots；Controller.page | history 启运行时并 orchmesh/open/resume 后 snapshotEvents | 优先试验官方冷读，避免为浏览历史恢复 Agent；保留事件到 assistant-ui 的格式适配 |
| 流式输出/重连 | SDK durable events；Controller.follow/page、官方客户端连续性处理 | 自定义 stream 通知、events.py、Messages、SSE | 有功能重叠，但 stdio SDK 无完整 Web follow；先测试适配官方 Controller，再决定是否替换传输，避免混用两套游标 |
| 文件交付 | `present` 和 `deliverables/presented` 原生日志事件 | 自定义 present_files + orchmesh.files.v1 | **优先替换新交付路径**；旧卡片保留只读兼容，前端识别原生事件 |
| 文件列表/预览读取 | workspaceFiles.stat/read/readBytes/list/changes | workspace.py 严格根目录访问 + FileResponse | 条件复用分页/监听；安全语义不同，不能直接替换现有授权与路径校验 |
| 下载、HTML 隔离 | 官方字节读取与资源系统，Web UI 另有预览 | Bearer 授权、HTTP Range、CSP/sandbox、体积限制 | 保留平台安全交付层；官方 API 不是现成安全下载 URL |
| 上传/图片附件 | SDK 图片块；Web file-upload、attachment、fileReferences | 尚未全面实现 | 新增此功能时优先复用，避免自定义附件存储协议 |
| 审批与干预 | user-approval 服务、Agent hooks、Web Controller 队列操作 | danger-full-access、停止按钮 | 有需求再接官方公开服务；当前发布 SDK 无完整审批回调面，不加假开关 |
| 可观测性 | session events、stats、telemetry、job/subagent 服务 | 事件转译、按日应用日志 | 复用原始事件/统计；应用审计日志仍属平台；不要把 telemetry 当可靠恢复队列 |
| 用户、授权、容器 | 上游有 RemoteAccess/Peer 策略与沙箱插件 | JWT、user_id 所有权、Docker 挂载与进程管理 | 不直接替换为桌面默认 owner 模式；这是平台边界，需独立威胁模型和接入设计 |
| 前端 UI | 官方 ui-session/ui-workspace/ui-deliverables 与资源系统 | React + assistant-ui + shadcn | 参考交互与数据协议；官方组件依赖其上下文/注册机制，不当作独立 shadcn 组件直接复制 |

## 关键模块证据

### 1. 项目与会话控制

已安装 `dsh-workspace` 类型明确包含 create、pinSession、unpinSession、archiveSession、unarchiveSession；归档会调用 activity/stop 事件能力。官方 Workspace Controller 负责项目导航投影；Session Controller 提供 create、rename、fork、prompt、cancel、page、follow、队列修改及模型相关控制。

但目前每个项目容器内都把不同宿主目录映射成 `/workspace`，同一用户共享持久化状态。直接加载按 canonical cwd 登记项目的 registry 会把不同项目混为同一目录。每次调用又启动/退出运行时，状态读写与并发注册也必须验证。

调整必须先定义稳定的“用户、会话、真实工作目录、导航分组”映射。不能为了官方 registry 看到所有目录，就默认把其他项目挂进当前容器。也不预设必须运行永久 DSH 主机；应比较短生命周期只读/写进程、按用户驻留和按工作区驻留的资源与隔离成本。

来源：[Workspace](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/workspace/workspace/README.md)、[Workspace Controller](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/api/workspace-controller/README.md)、[Session Controller](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/api/session-controller/README.md)。

### 2. 文件交付是明确可收敛项

实际镜像有 `dsh-tool-present@0.2.1-rc.3`，公开类型定义 `deliverables/presented: { turn, callId, files: [{path, description?}] }`。它保留源文件引用、不复制内容，与当前交付卡片的基本语义一致。官方 Web UI 也已有完成后展示卡片和预览入口的参考。

差异：官方允许可读的工作区外绝对路径，当前平台仅允许授权工作目录。采用原生声明不等于放开文件访问；平台展示/下载时仍需根据原会话工作区校验路径。旧 `orchmesh.files.v1` 数据继续解析，无需改写旧日志。

来源：[Present](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/deliverables/tool-present/README.md)、[交付指导](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/deliverables/deliverable-file-references/README.md)、[官方交付 UI](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-deliverables/README.md)。

### 3. 官方文件服务不能直接替代平台安全边界

`workspaceFiles` 支持按行文本分页、二进制窗口、元信息、目录列表、变更监听。官方明确：文件读取与文件监听可以在工作区外；目录列表与目录监听才要求工作区包含。它拒绝最终 symlink，但文档不承诺当前平台的逐级文件描述符无链接访问与硬链接规则。

因此可复用读取协议和观察能力，但必须保留用户权限、根目录边界、稳定 workspace_project_id、下载限制、HTML 隔离。当前 FastAPI FileResponse 已复用成熟 HTTP 文件响应，不应仅因它不是 DSH 代码就替换。

来源：[Workspace Files](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/api/workspace-files/README.md)。

### 4. 冷历史读取与投影

`sessionQuery.readSession(id)` 可以读取并验证持久化日志，而不激活 Agent；`readTitleSnapshots` 可批量读标题。Controller.page 提供冷安全分页，follow 有实时流与断线连续性逻辑。这是当前“打开历史先恢复运行时 Agent”的替换候选。

当前发布版根导出 `readColdSessionLog(persistence, sessionId, signal)` 是最小试验入口：只读打开/读取/关闭，崩溃补全仅在内存中，不回写日志。优先用此公开入口替代 `Manager.history → orchmesh/open → server.resume`；真正继续执行时仍使用官方 resume。

冷读仍需要 Node 服务组成、存储后端和跨进程传输；它能省 Agent 激活，不代表一定不启动容器。可先用只读短生命周期 bridge 实验；不得绕过日志迁移/校验直接在 Python 重写 JSONL 解析器。前端 assistant-ui 消息模型仍需适配，不能承诺删掉整个 events.py。

来源：[Session Query](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session-query/session-query/README.md)、[Session Projection](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session/session-projection/README.md)、[Session Title](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session/session-title/README.md)。

### 5. 观测和审批

公开事件与统计适合直接转发，平台无需维护第二套执行日志事实。官方 telemetry 是报告通道，可能丢失，不能做恢复依据；实际 OTel 插件配置目前是反馈触发或禁用，不是通用 FULL 实时导出。平台按日服务日志与官方会话事件用途不同。

审批应复用 user-approval 的作用域、取消和审计逻辑；接入点必须依据实际发布 API 验证。不要依据 master 的新增 SDK 回调就宣布当前已支持。当前全访问容器模式也不等于已有审批 UI。

来源：[User Approval](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/interaction/user-approval/README.md)、[Telemetry](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session/session-telemetry/README.md)、[OTel](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session/session-telemetry-otel/README.md)。

## 建议调整顺序

建议继续采用“FastAPI 产品 API + 容器内官方 DSH 服务 + 薄 bridge + 现有 React 页面”。优先复用公开插件和服务，不把接入全部 Web Gateway 当作前提。FastAPI 保留账号、所有权、资源限额、导航分组、HTTP 下载及 SSE 授权；DSH 保留执行、日志、工具交付与历史解释。前端只维护展示投影，不成为执行状态的另一权威来源。

1. **先收敛确定重复项**：用官方 present 发起新交付，兼容旧卡片；梳理当前实际加载的工具，避免两个交付工具同时暴露。
2. **单独试验冷历史与模型选择**：用公开 session-query / Controller 接口验证；记录能删掉的代码、依赖增量和启动成本，再实施替换。
3. **决定状态归属与路径模型**：当前 SQL 项目导航保持唯一事实源；完成目录稳定映射、容器授权、进程并发评估后，再决定 WorkspaceRegistry 是否适合接管部分数据。不要做 SQL 与 DSH 双向同步。
4. **再评估实时控制层**：以官方 follow/projections/catalog/queue 做小型对照原型，目标是减少 DSH → 旧 Pi 事件 → assistant-ui 的二次转译，而不是照旧保留所有自有代码。比较薄 stdio bridge 与官方 Gateway/Controller；只有在分页、重连、队列等需求收益明确时切换。保留前端和 JWT 边界，不整体照搬桌面主机。
5. **新增功能优先查现成插件**：附件、队列、fork、审批、文件监听、统计按需接入，不为“接口齐全”一次启用全部组件。

## 预计删改范围

| 自有文件 | 计划 |
|---|---|
| `apps/runtime/files.mjs`（67 行） | 替换交付工具注册；不再生成新 orchmesh.files.v1，但保留前端旧格式解析 |
| `bridge.mjs` 的 history/open 分支 | 分离只读历史与执行恢复；保留运行时公开 API 薄桥接 |
| `dsh/manager.py` 的 history 路径 | 使用冷读，保留身份检查、运行互斥、容器生命周期及执行恢复 |
| `dsh/events.py`、`messages.py` | Controller 原型验收后再删冗余投影；保留 assistant-ui 映射 |
| `projects.py`、SQL Project/Conversation 导航字段 | 当前保留单一权威；不与官方 registry 双写 |
| `workspace.py` | 保留安全交付；只在同等边界验证后替换内部读取能力 |
| `launch.mjs`、RPC、鉴权、Docker、日志 | 保留集成所需部分，不能按名称相似当作可删除逻辑 |

上述相关自有模块约 1137 行是审查范围，不是可节省代码量。最确定能被替换的工具模块是 67 行，但还会新增原生事件投影与兼容逻辑；暂不提供未经原型验证的净减行数。原生 schedules/提醒依赖运行主机生命周期，当前每轮销毁不适合直接启用；experimental hooks 不列为默认成熟依赖。

## 实施验收与回滚要求

- 保留现有账号、会话 ID、日志和文件；旧 Pi 历史、旧交付卡片仍可读。
- 测试两用户同名项目、跨用户拒绝、两个项目同路径映射、移动后原文件引用、归档/恢复、运行中归档和重复请求。
- 文件验证覆盖越界、逐级链接、硬链接、HTML、删除后的交付、Range 下载；不降低现有约束。
- 事件验证覆盖中断、工具失败、子 Agent、重连、重复帧和历史分页；真实模型验收另行执行。
- 每项迁移只设一个权威来源；先备份，先读验证，再切写入，保留可回滚路径。本轮仅形成调整方案，尚未实施或运行验收。


## 实施决策（2026-10-26，官方优先）

本次先完成有明确兼容路径的收敛：官方 present、官方冷历史读取、SDK 初始化思考参数，删除自定义文件工具及重复选择状态。rc3 测试证明省略初始化 effort 仍可能继承历史值，因此保留官方 installModelSelection 的一次性调用，明确清除继承值；不是补改上游。

其余模块本次的决策如下，不能记为已完成官方迁移：

- **项目与置顶归档暂留平台**：既有历史的 cwd 是 /workspace，实际目录由 workspace_project_id 决定。官方 registry 以 canonical cwd 建立成员关系；直接切换会误分组。用户明确要求移动只改分组且保留文件引用、项目可恢复归档，与官方目录成员/移除登记不同。暂不改写历史头、不双写导航数据、不扩大挂载范围。
- **不接完整 SessionController/Gateway**：它依赖 WorkspaceRegistry、默认模型服务、文件上传、RemoteAccess、Typert 等组成，并非 stdio 的替换类。当前只有单用户单轮执行、停止与断线快照，公开 SDK 加薄桥接已负责执行；为接控制层必须先解决上述身份与路径问题。官方取消保留队列、selectModel 保存默认值也不等价于当前产品约定。官方分页/队列界面尚未迁移。
- **保留 assistant-ui 展示适配**：没有现成 DSH adapter 可以直接替换现有运行时；当前复用现成消息 projector 同时保障旧 Pi 历史。官方 SessionProjection 主要提供领域状态，不是独立可插入 assistant-ui 的整套消息组件。此轮不复制其内部 Web 客户端代码。
- **文件服务、鉴权和容器保持平台职责**：下载已经复用标准 FileResponse；官方读取服务的文件访问范围不同，不能靠更换 API 取消目录权限边界。

后续若采用常驻 Host 或修改项目工作区语义，应单独迁移路径与状态归属，再接官方 Controller；不是增加一层 SQL/DSH 同步补丁。本轮不会声称这部分已经接入。
