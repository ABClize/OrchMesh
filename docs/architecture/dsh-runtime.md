# DSH 执行层

2026-10-26：使用 npm 发布的 `0.2.1-rc.3`，依赖锁在 `apps/runtime/package-lock.json`。核验与组成试验见 [Controller 研究](../research/dsh-controller-migration.md)。

## 官方接口与职责

容器启动官方 `sdk` profile，增加 `workspace`、`client-connection`、`client-file-upload`、`api-session-controller`、`api-workspace-controller` 及 `tool-present` 插件。无需额外 Web Server 或 Cookie 登录。

- `SessionController.resolveAgent` 唯一负责激活/恢复 Agent。SDK JSON-RPC server 保留初始化与通知能力。SDK `session/wait` 只识别自己的内部会话表，不能等待 Controller 创建的 Agent；桥接 `orchmesh/wait` 使用公开 `Agent.whenIdle()`、`subagents.waitForChildren()` 和稳定事件序号判断完成，再调用 `SessionStore.flush`。不访问 SDK 私有表、不重复创建 Agent。
- `SessionController.prompt` 提交输入，`selectModel` 设置本轮模型及思考等级，`inspect` 读取历史，`projections` 获取准确标题。`list` 返回的缓存提示不能当作准确标题。
- `WorkspaceController` 登记/重命名/移除项目，置顶、归档和恢复会话。归档清除置顶；恢复不自动置顶。
- 停止使用公开 `Agent.cancel`，同时清理活动轮次和待处理输入；`SessionController.cancel` 会保留队列，不符合整项任务停止语义。停止后通过公开 `subagents.drainChildren` 释放受管理子任务，通过 `jobs.kill` 终止其后台作业；超时回收容器。
- `agent/assistant-stream` 转发实时增量；`present` 和 `deliverables/presented` 提供官方文件交付。

桥接只负责 stdio JSON-RPC 与这些公开接口之间的适配。Python 管理账号鉴权、所有权、运行槽位、SSE 和容器回收。服务重启将运行标记 interrupted，暂不自动续跑。

## 项目、会话与目录

SQL 项目 UUID 是稳定的平台身份，通过 `native_id` 关联 DSH Workspace。新建项目在 `.data/users/<user>/projects/<id>/work/`，对应容器 `/workspaces/<id>`；默认目录为用户 `work/`，对应 `/workspaces/default`。每用户容器固定挂载默认目录到 `/workspace`、项目树到 `/project-workspaces`，只读挂载平台维护的 `/workspaces` 别名表。`/workspaces/default` 指向 `/workspace`，`/workspaces/<id>` 指向 `/project-workspaces/<id>/work`。新建项目只增加目录和别名，无需重启；Controller 可能返回解析后的真实路径。已有文件留在原位，历史中的 `/workspaces/...` 路径继续有效；文件交付通过原 `directory_id` 和相对路径访问。

项目名称、会话标题、成员关系、置顶和归档直接读取 DSH，不再复制到 SQL。SQL Project 仅保存用户、稳定目录 ID、native_id 和创建时间；移除官方登记后仍保留这条物理目录映射，确保原会话和文件继续可访问。Conversation 保存官方字符串 ID、用户、directory_id、思考偏好和创建时间；SessionId 是不透明字符串，不能假定为 UUID。

新会话通过 `SessionController.create({workspaceId})` 创建，采用官方返回 ID；未分组使用默认 cwd。重命名和分支使用官方 Controller。会话创建/更名/分支和执行完成通过公开 `SessionStore.flush(session)` 等待持久化，不能用延时猜测写入完成。

官方 Workspace 根据真实 cwd 绑定成员。移除项目仅删除登记，原会话进入未分组；取消平台自定义项目归档和跨目录显示分组移动。既有会话只在原生 cwd 匹配时登记成员，不改写历史或文件路径。迁移前备份，删除重复 SQL 列；没有运行时兼容层。旧 Pi 文件继续保留在磁盘。

导航、历史与执行共用每用户一个 Docker 容器、一个 DSH Host 和一个 RPC。登录成功及恢复登录触发后台预热，不阻塞登录响应；随后请求等待同一次启动。不同账号有独立挂载和 config/dsh 存储，同一账号的项目之间不构成安全边界。

`ORCHMESH_RUNTIME_IDLE_SECONDS` 默认 600 秒；官方 Agent、输入队列、子任务、后台作业或计划工作仍活动时不回收。`ORCHMESH_MAX_ACTIVE_RUNS` 同时限制常驻用户 Host 数量，包含预热/空闲 Host；满额优先释放空闲 Host，其余请求返回忙碌。跨用户分配串行化，用户内生命周期使用同一把锁。普通完成和协作停止保留 Host；传输错误、超时、服务退出则释放。失败的变更请求不自动重放；容器删除失败保留占位，避免两个进程写同一状态。

## 模型与文件

管理员模型配置每次从 `.env` 同步；其他用户使用 `configure-model`。容器读取 models.json/settings.json 转为官方 provider 配置，Key 仅进入子进程环境，不写入 argv 或 profile。模型选择与思考等级使用 Controller；default 清除上一轮的显式等级。

DSH 原生日志是消息权威来源。`dsh/events.py` 转换展示事件，React 复用 assistant-ui 消息 projector。原有文件交付记录仍可展示；新记录仅使用官方 `present`。网页根据当前执行工作区核对文件路径，不能通过交付声明扩大权限。

FastAPI 文件端点使用鉴权、逐级目录描述符和 O_NOFOLLOW，拒绝越界、符号链接、硬链接和特殊文件。Starlette FileResponse 提供下载和 Range，最大 20 MiB。浏览器复用 Markdown、图片/PDF 和 sandbox+CSP HTML 预览。

## 隔离与验证

容器非 root、根目录只读、cap-drop、no-new-privileges，限制 CPU/内存/PID；不挂载宿主 HOME 或 Docker socket。内部工具使用自由执行模式，外层容器负责隔离。仍允许出站，不宣称支持敌对租户。

`ORCHMESH_TEST_DOCKER=1 uv run --directory apps/server pytest tests/test_dsh_docker.py` 验证实际发布包的工具、流式、停止、恢复、导航持久化和目录映射。普通 pytest 验证平台故障和所有权；真实管理员/模型及浏览器验收另行记录。升级必须重新验证公开接口，不能以仓库主分支代替已发布包。

## 人机交互与运行面板

保留现有 React 外观；`ActivityPanel` 使用现有 shadcn Button/Input，审批和问题卡片在 `ActivityCards`，不引入官方 Web Shell 的 ModuleLoader/Cordis 客户端运行环境。

- `interactions.mjs` 接入官方 `approval/request` 和 `user-questions/request` 回答者 waterfall。平台只保存进程内待答关联及取消监听；DSH 负责权限结果、审计、问题校验和工具等待。显式加入官方 `tool-ask-user`（SDK 基础组合只有服务，不自动注册此工具），使用阻塞模式。
- 网页默认勾选“本轮工具审批”。本轮开启时，通过官方 `tools/pre-execute` 的 `ask` 决策审查除提问工具外的每个调用，使用官方 ApprovalPolicy 与一次性允许/拒绝。对子任务的工具门禁同样生效。关闭时沿用原容器内自由执行；这是部署级门禁，不是命令分类器或新的 Shell 沙箱。API 客户端使用 `review_tools` 显式开启。
- 队列使用 `SessionController.prompt(mode=queue|steer)`、`updateQueue(edit|remove|steer)` 和官方 `inbox` 投影；没有 SQL 队列表、重试调度器或前端影子队列。运行结束边界与输入接纳串行化，已接受的新输入必须进入下一次桥接 `orchmesh/wait`。
- 子任务目录使用 `subagents.listDescendants`，过程使用官方 Session 投影/历史，停止使用 `subagents.interrupt`。按原生父子目录验证访问范围，不能凭一个任意 SessionId 查看其他会话。外部任务或目录诊断项不提供本地历史按钮。
- 活动状态经已有 Bearer 鉴权的 HTTP 接口读取，运行时约每 1.2 秒刷新，消息仍用 SSE；闲置历史附带同一次 Host 读取的活动快照，避免额外启动容器。Host 读取和新任务接纳共用用户锁，任务执行本身不持锁。

rc3 官方禁止被父 Agent 管理的子任务直接向人提问；子任务必须把未决问题交回父任务，本项目不绕过此约束。

关闭页面不会自动批准或取消待答项；重新打开可继续回答。停止、超时或进程退出撤销等待，迟到或重复回答被拒绝。服务重启仍标记 interrupted，不承诺恢复尚未回答的进程内请求。尚未实现官方定时提问的“稍后回答”、独立继续子任务或调度面板。
