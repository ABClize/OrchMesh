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

## Makefile 与 Codex 内置浏览器复验

2026-10-26：新增根目录 Makefile，统一安装、镜像构建、演示、真实应用、前后端开发、代码检查和测试命令。暂不增加开发容器或进程管理依赖；Web 在宿主运行，Pi 单独使用执行容器。

- `make run`：构建及迁移成功，页面 `/` 和 `/api/health` 返回 200。
- `make dev-api` + `make dev-web`：服务启动成功，Vite 5173 页面及 `/api/health` 代理返回 200。
- `make check`：Ruff、Pyright、ESLint、TypeScript 通过。
- `make test`：10 项后端测试通过、1 项 Docker 测试按默认设置跳过；2 项前端测试通过。
- `make test-pi`：单独执行真实 Pi/Docker + 本地模拟模型测试，1 项通过。
- `make demo`：使用 Codex 内置浏览器完成登录、流式输出、刷新并重开活动对话、停止、再次发送、退出及刷新后仍未登录。演示为临时数据库和 RPC 替身，未使用外部真实模型。

截图保存在本机忽略目录 `.data/acceptance/codex-browser-preview.png`。实际模型登录与公网部署仍未验收。


## 统一环境配置与精简命令（2026-10-26）

当前命令以 README 为准：`setup/dev/run/check/test` 加 `help`，替代前述多入口 Makefile。`dev` 前台启动官方 FastAPI CLI 和 Vite，一侧退出或收到停止信号时清理双方进程组；`run` 单服务启动。自动执行迁移。端口由根目录 `.env` 读取，Vite 只用服务器配置，不向客户端注入秘密。

管理员在 API 单实例锁内初始化；已有账号不重置、不自动提升权限。模型仅初始化管理员缺失的 Pi 原生配置文件，原子创建、权限 600。已有文件不覆盖；换 Key 继续编辑 Pi 原生文件。pytest 和浏览器替身隔离本地初始化凭据。

本次验证：`make check` 通过；`make test` 后端 14 passed / 1 skipped，前端 2 passed；单独启用 Docker 的 Pi 测试 1 passed。临时数据库与测试管理员下验证了非默认 API/Vite 端口、Vite 代理、页面和管理员登录、重复启动、Ctrl+C 释放端口，以及前端端口被占用时自动停止后端。本地 `.env` 权限 600 且被 Git 忽略。没有使用真实外部模型凭据。

### 模型配置生命周期修正（2026-10-26）

取代上一节“模型仅初始化”的约定：`ORCHMESH_MODEL_BASE_URL/API/API_KEY/ID` 是运行配置，每次启动在清理遗留 Pi 容器后同步管理员的 `project-api` provider 和默认模型。保留其他 provider、无关设置及其他用户文件；全部清空时移除受管理 provider 及旧 Key。管理员密码仍只初始化一次；清空管理员初始化项不影响既有管理员的模型同步。根目录 `.env` 的旧模型变量已更名，秘密值未输出。

验证：静态检查通过；后端 17 passed、前端 2 passed。临时数据下连续启停开发/单服务进程，修改模型地址、Key、ID 后生成配置更新，而原管理员密码仍能登录。覆盖清空、已有配置保留、其他用户不受影响及损坏配置不覆盖的测试。真实 Pi 容器测试改为复用运行配置生成模块，避免测试手写一套不同的模型配置。

### 登录旧 CSRF Cookie 恢复（2026-10-26）

内置浏览器登录返回 403 `CSRF token verification failed`，而两个全新客户端均登录成功并保持独立会话。原 CSRF 中间件只补发缺失 Cookie，不更新失效签名，导致旧实例 Cookie 无法自行恢复；前端还将此错误误报为密码错误。

扩展 upstream 响应钩子：安全读取时更新签名失效的 CSRF Cookie，保留有效令牌、原有 Cookie 属性和写请求校验。登录提示区分 403、429、服务端错误和凭据错误。新增失效签名恢复及同账号多会话/单会话退出测试；先见回归失败再修复。静态检查通过，后端 19 passed / 1 skipped、前端 2 passed。确认无运行任务后重启本机服务，原浏览器未清 Cookie、未改密码即登录成功（204），用户及会话列表接口均为 200。

## 当前认证：官方模板 Bearer JWT（2026-10-26）

本节替代前述 Cookie/CSRF 选型与修复记录。依据用户决定，采用 FastAPI 官方全栈模板的 OAuth2PasswordBearer、PyJWT HS256、pwdlib Argon2/Bcrypt 和 localStorage access_token。官方参考：[安全函数](https://github.com/fastapi/full-stack-fastapi-template/blob/master/backend/app/core/security.py)、[登录路由](https://github.com/fastapi/full-stack-fastapi-template/blob/master/backend/app/api/routes/login.py)、[前端登录/退出](https://github.com/fastapi/full-stack-fastapi-template/blob/master/frontend/src/hooks/useAuth.ts)。保留现有 async SQLAlchemy/SQLite 和 Pi 结构，不复制整个模板。

- 删除 FastAPI Users、starlette-csrf、旧 CookieTransport/DatabaseStrategy、CSRF 子类、前端 Cookie 读取和旧登录/退出端点。
- `POST /api/login/access-token` 返回 JWT，API/SSE 只接受 Authorization Bearer；签名算法固定，要求 sub/exp，检查过期、用户存在和 active 状态。默认 60 分钟，JWT secret 持久保存在私有 `.data/jwt-secret`，不复用旧 CSRF secret。
- SSE 复用微软 `@microsoft/fetch-event-source`。统一凭据来源，omit cookies；意外 EOF 重连读取快照，终态主动关闭，401/过期停止重试，退出/卸载 abort。本地登录变更跨标签页同步，迟到的旧请求/流错误不能清除新登录。
- 模板退出语义：清除本地 JWT，不在服务器即时吊销 JWT，不终止后台任务。流中继续检查 JWT 到期与账号禁用。没有伪装成撤销机制的空 logout API，也没有同时保留两套认证。

### 数据迁移与备份

迁移 `20261026_jwt` 删除废弃 accesstoken 表，将 user.id / conversation.user_id 的 SQLite UUID 字符串规范化；UUID 值、目录名及会话 ID 不变。用户表保留 email、hashed_password、active/superuser/verified 字段。历史首个 migration 的外部类型改写成等价冻结 SQL 类型，因此删除旧认证包后仍可从空库安装、升级旧库。

实际升级前检查无运行任务，创建权限受限备份 `.data/backups/pre-jwt-20261025T212418Z/`（UTC 名称）；含 SQLite 一致快照、原有 users 目录及原 CSRF secret。没有打印秘密。迁移前后比较全部旧账号字段与密码哈希、原有用户文件 SHA256，并检查外键；均一致。原账号可用原密码登录。旧会话自然失效，页面需重新登录。

### 验证结果

- `make check`：Ruff、Pyright、ESLint、TypeScript 通过。
- `ORCHMESH_TEST_DOCKER=1 make test`：后端 27 passed、前端 8 passed；包含真实 Pi 容器 + 本地模拟模型。
- 后端覆盖旧库/密码/UUID/归属迁移、无 Cookie 鉴权、旧端点撤除、多客户端、错误签名/算法/缺失字段/过期、流中到期/禁用、SSE 重连快照、停止、运行故障清理。
- 前端覆盖真实 SSE 解析器分片处理、Bearer 请求头、终态退出、401 不重试、EOF 重连、abort、同源退出事件、迟到旧令牌失败不覆盖新登录。
- 实际模型：使用项目现有凭据和原管理员账号，新建验收对话；Bearer SSE 收到 19 条事件并完成 `AUTH_STREAM_OK` 回复，重新读取历史正常；后续真实 Pi 任务停止并进入 stopped。未输出 Key/JWT，没有使用个人 Pi 登录。
- Codex 内置浏览器：临时测试服务登录、slow 流式增量、刷新保持登录、重开运行中会话恢复输出、停止、hello 完成、第二标签页共享登录、退出同步清空两个标签页均通过。临时服务与测试账号独立，不替换真实账号。
- 原有 Vite 大 chunk 提示仍存在，未以修改告警阈值掩盖；不是认证故障。

用户随后明确将真实管理员账号与项目模型作为默认端到端验收环境；该偏好已写入 AGENTS.md 和浏览器验收文档，模拟模型只用于边界回归。追加实际浏览器验收：原管理员登录、打开真实历史、发送三句说明并得到 BROWSER_REAL_OK、实际生成过程中刷新并重新打开对话继续接收、点击停止并确认 stopped、退出后刷新仍未登录、重新登录恢复工作区均通过。截图保存在忽略提交的 `.data/acceptance/jwt-real-browser-acceptance.png`，避免把真实账号标识放入仓库；Key/JWT 未输出。临时模拟服务已关闭，正式 8000 服务保留。

## 2026-10-26: framework reuse and daily diagnostics

- Kept database foreign-key enforcement disabled by explicit user decision;
  application ownership checks remain required.
- Added `@assistant-ui/react-pi` 0.0.32 and use its public
  `projectPiThreadMessages` for message/tool/reasoning rendering. Retained the RPC
  delta adapter: Pi 1.4.0 `modes/json-event.js` deliberately removes the complete
  `message` from `message_update`, whereas the upstream React reducer expects it.
  Copy only the changing message instead of cloning the entire transcript.
- Use TanStack Query mutations for login and conversation creation. Only 401
  resolves the current user to null; HTTP and network failures show a retry UI.
  Pass query abort signals through the generated API client.
- Added standard-library daily application logs; see `logging.md` for retention,
  privacy and timing semantics. No logging service or custom rotation scheduler.
- Added GitHub Actions for deterministic checks/tests. `make check` now includes
  Python/TypeScript formatting and a read-only OpenAPI drift check in a temporary
  directory. Existing Make target count is unchanged.
- Backend suite including Docker: 29 passed; frontend suite: 10 passed. Logging
  tests cover rollover, retention, restart and excluded sensitive data. CI itself
  has not run on GitHub; its underlying checks were executed locally.
- Real administrator/browser acceptance: login, real model response, `printf`
  Shell output rendered through the upstream projector, stop, API outage error
  display and recovery retry all passed. The API was restarted with the final
  code. Runtime logs contain lifecycle states without the test prompt, tool
  output or configured credentials. Screenshot stays in ignored local data:
  `.data/acceptance/framework-reuse.png`.
