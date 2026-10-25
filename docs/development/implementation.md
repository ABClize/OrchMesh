# 首版实施与验收记录

日期：2026-10-26。本文记录实际工程；早期蓝图中的未来目录不构成强制要求。

## 官方工具与实际调整

- 使用 create-vite 9.3.1 的 react-ts 模板，保留其 Vite / TypeScript 结构，合入既有兼容版本锁。
- 使用 shadcn CLI 的 Vite / Radix / nova 初始化，再添加登录表单组件。
- 使用 assistant-ui CLI 添加 Thread 及其 Markdown、ToolFallback、Reasoning 等依赖组件。保留生成目录，不额外实现聊天气泡、滚动或 Markdown。
- Thread 生成源码对 TypeScript 5 的分组类型推断需显式泛型；为未实现的附件、编辑、重新生成增加能力判断；调整输入提示为中文。工具组件的 effect 清理捕获 receipt ref，移除不适用的 eslint-disable。
- 使用 Alembic 官方 async 模板生成初始迁移，补入第三方 GUID 类型导入。认证沿用 FastAPI Users 官方 SQLAlchemy 适配器。
- FastAPI 原生 frontend 托管仓库内构建产物，SSE 使用原生 EventSourceResponse；不另写静态路由回退。页面验收现改用 Codex 内置浏览器，步骤见 [浏览器验收](browser-acceptance.md)。
- Pi 固定 1.4.0，Node 24 容器。执行容器按需启动并回收，用户文件和会话由独立挂载持久保存；不需要常驻 Compose 容器。
- `orchmesh pi-login` 直接打开用户专用 Pi 官方 TUI，复用 /login、/model，不另建模型凭据管理界面。此操作需要 API 停止，共用实例锁。
- 本机 Docker 可用但不是 rootless；未调整宿主 Docker 配置。

## 状态与边界

每用户一个运行槽位，历史读取也占用该用户槽位；全局默认四个。RPC 以 LF 分帧，按 command ID 匹配响应，stderr 持续排空且不记录潜在凭据。单条 RPC 记录上限 8 MiB。活动消息投影仅在内存，历史通过 Pi get_messages 恢复，不解析或复制为第二份数据库聊天历史。

SSE 使用 256 条有界事件队列，首次连接或重连发送当前快照，缓冲落后时重同步；不承诺持久事件重放。订阅每轮检查数据库会话，空闲时最多约一秒检查一次。浏览器断开不取消任务。退出登录清空浏览器缓存，服务端会话立即撤销。

完成等待 agent_settled，不把 agent_end 或 prompt 响应视为完成。停止先 clear_queue、再 abort；超时取消执行任务并回收整个容器。清理失败时保留运行槽位，重启前需修复 Docker。API 单实例文件锁防止重复管理；重启清理已知用户的遗留容器，running 元数据转 interrupted。

容器为宿主用户 UID，根文件系统只读，cap-drop=ALL、no-new-privileges、内存/CPU/PID 限制，不挂载 Docker socket、平台数据库或其他用户路径。网络仍使用 Docker 默认桥接，不能把它宣称为敌对租户网络沙箱。容器内用户可以读取自己的模型凭据。

## 已验证

最终检查：后端 11 项（含真实 Pi 容器）、前端状态 2 项、浏览器整链路 1 项通过；Alembic schema check 无漂移。

- pytest：登录、CSRF、账号隔离、SSE 归属、会话撤销、限流、流式输出、停止、超时升级、进程崩溃、handled disposition、缓冲重同步、历史恢复、重启中断、静态/API 路由。
- 真实 Docker + Pi 1.4.0：连接本地确定性模型端点，执行 write/read/bash，接收流式增量，clear_queue + abort，重启 Pi 后恢复原生历史，检查宿主/其他用户目录不可达。
- 历史验收（移除 Playwright 前）：真实浏览器与 FastAPI、独立临时数据库、RPC 替身完成登录 → 流式 → 刷新恢复 → 停止 → 再发送 → 退出。测试凭据仅存在测试模块。按用户决定移除自动化浏览器依赖与脚本；保留截图作为历史证据，不等同于已经用 Codex 内置浏览器重新验收。
- Vitest：快照恢复后的增量及最终消息替换、工具结果关联。
- TypeScript 构建、Python 类型检查、Ruff、ESLint。

## 尚未验收

外部真实模型调用、订阅 OAuth 实际登录、MCP 服务器、生产 HTTPS、公网部署、敌对租户隔离和长时间压力测试。测试使用本地模拟模型，未复用个人 Pi 登录。

界面截图：[聊天链路](chat-preview.png)。截图内容为测试替身输出。

构建提示：聊天组件按需加载，当前聊天 chunk 约 675 kB（gzip 约 199 kB），仍有 Vite 大 chunk 提示；登录主包约 366 kB。尚未为首版引入额外拆包规则。
