# DSH 执行层

2026-10-26：使用 npm 发布的 `0.2.1-rc.3`，依赖锁在 `apps/runtime/package-lock.json`。核验与组成试验见 [Controller 研究](../research/dsh-controller-migration.md)。

## 官方接口与职责

容器启动官方 `sdk` profile，增加 `workspace`、`client-connection`、`client-file-upload`、`api-session-controller`、`api-workspace-controller` 及 `tool-present` 插件。无需额外 Web Server 或 Cookie 登录。

- `HarnessSdkJsonRpcServer` 创建/恢复 Agent，`session/wait` 等待根任务及受管理子任务完成。
- `SessionController.prompt` 提交输入，`selectModel` 设置本轮模型及思考等级，`inspect` 读取历史，`projections` 获取准确标题。`list` 返回的缓存提示不能当作准确标题。
- `WorkspaceController` 登记/重命名/移除项目，置顶、归档和恢复会话。归档清除置顶；恢复不自动置顶。
- 停止使用公开 `Agent.cancel`，同时清理活动轮次和待处理输入；`SessionController.cancel` 会保留队列，不符合整项任务停止语义。超时回收容器。
- `agent/assistant-stream` 转发实时增量；`present` 和 `deliverables/presented` 提供官方文件交付。

桥接只负责 stdio JSON-RPC 与这些公开接口之间的适配。Python 管理账号鉴权、所有权、运行槽位、SSE 和容器回收。服务重启将运行标记 interrupted，暂不自动续跑。

## 项目、会话与目录

SQL 项目 UUID 是稳定的平台身份，通过 `native_id` 关联 DSH Workspace。新建项目在 `.data/users/<user>/projects/<id>/work/`，对应容器 `/workspaces/<id>`；默认目录为用户 `work/`，对应 `/workspaces/default`。执行容器只挂载所选工作目录，并将同一目录挂载到 `/workspace`，保留现有绝对文件引用。

项目名称、会话标题、成员关系、置顶和归档直接读取 DSH，不再复制到 SQL。SQL Project 仅保存用户、稳定目录 ID、native_id 和创建时间；移除官方登记后仍保留这条物理目录映射，确保原会话和文件继续可访问。Conversation 保存官方字符串 ID、用户、directory_id、思考偏好和创建时间；SessionId 是不透明字符串，不能假定为 UUID。

新会话通过 `SessionController.create({workspaceId})` 创建，采用官方返回 ID；未分组使用默认 cwd。重命名和分支使用官方 Controller。短生命周期进程退出前通过公开 `SessionStore.flush(session)` 等待持久化，不能用延时猜测写入完成。

官方 Workspace 根据真实 cwd 绑定成员。移除项目仅删除登记，原会话进入未分组；取消平台自定义项目归档和跨目录显示分组移动。既有会话只在原生 cwd 匹配时登记成员，不改写历史或文件路径。迁移前备份，删除重复 SQL 列；没有运行时兼容层。旧 Pi 文件继续保留在磁盘。

导航操作使用短生命周期的控制容器，只读挂载用户工作目录，拒绝执行任务。会话登记仅挂载该会话目录。执行时导航查询/变更复用活动 RPC；同一用户不同时启动两个 DSH 状态写入者。不同账号有独立的 config/dsh 存储。

## 模型与文件

管理员模型配置每次从 `.env` 同步；其他用户使用 `configure-model`。容器读取 models.json/settings.json 转为官方 provider 配置，Key 仅进入子进程环境，不写入 argv 或 profile。模型选择与思考等级使用 Controller；default 清除上一轮的显式等级。

DSH 原生日志是消息权威来源。`dsh/events.py` 转换展示事件，React 复用 assistant-ui 消息 projector。原有文件交付记录仍可展示；新记录仅使用官方 `present`。网页根据当前执行工作区核对文件路径，不能通过交付声明扩大权限。

FastAPI 文件端点使用鉴权、逐级目录描述符和 O_NOFOLLOW，拒绝越界、符号链接、硬链接和特殊文件。Starlette FileResponse 提供下载和 Range，最大 20 MiB。浏览器复用 Markdown、图片/PDF 和 sandbox+CSP HTML 预览。

## 隔离与验证

容器非 root、根目录只读、cap-drop、no-new-privileges，限制 CPU/内存/PID；不挂载宿主 HOME 或 Docker socket。内部工具使用自由执行模式，外层容器负责隔离。仍允许出站，不宣称支持敌对租户。

`ORCHMESH_TEST_DOCKER=1 uv run --directory apps/server pytest tests/test_dsh_docker.py` 验证实际发布包的工具、流式、停止、恢复、导航持久化和目录映射。普通 pytest 验证平台故障和所有权；真实管理员/模型及浏览器验收另行记录。升级必须重新验证公开接口，不能以仓库主分支代替已发布包。
