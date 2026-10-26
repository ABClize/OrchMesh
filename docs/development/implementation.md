# 首版实施与验收记录

日期：2026-10-26。本文是按阶段追加的历史实施记录，早期内容可能已被后续段落取代。当前结构以 [项目结构](../architecture/project-blueprint.md) 为准，执行语义以 [当前架构](../architecture/v0.1-simplified.md) 为准。

截至本次更新：Bearer JWT、官方 Pi 消息转换、每日日志和 CI 配置已落地；后端 29 项、前端 10 项及真实模型浏览器验收通过。下面从最初骨架开始保留演进过程，Cookie/数据库会话及早期未验收描述仅代表当时状态。

## 初始骨架：官方工具与实际调整

- 使用 create-vite 9.3.1 的 react-ts 模板，保留其 Vite / TypeScript 结构，合入既有兼容版本锁。
- 使用 shadcn CLI 的 Vite / Radix / nova 初始化，再添加登录表单组件。
- 使用 assistant-ui CLI 添加 Thread 及其 Markdown、ToolFallback、Reasoning 等依赖组件。保留生成目录，不额外实现聊天气泡、滚动或 Markdown。
- Thread 生成源码对 TypeScript 5 的分组类型推断需显式泛型；为未实现的附件、编辑、重新生成增加能力判断；调整输入提示为中文。工具组件的 effect 清理捕获 receipt ref，移除不适用的 eslint-disable。
- 使用 Alembic 官方 async 模板生成初始迁移，补入第三方 GUID 类型导入。认证沿用 FastAPI Users 官方 SQLAlchemy 适配器。
- FastAPI 原生 frontend 托管仓库内构建产物，SSE 使用原生 EventSourceResponse；不另写静态路由回退。页面验收现改用 Codex 内置浏览器，步骤见 [浏览器验收](browser-acceptance.md)。
- Pi 固定 1.4.0，Node 24 容器。执行容器按需启动并回收，用户文件和会话由独立挂载持久保存；不需要常驻 Compose 容器。
- `orchmesh pi-login` 直接打开用户专用 Pi 官方 TUI，复用 /login、/model，不另建模型凭据管理界面。此操作需要 API 停止，共用实例锁。
- 本机 Docker 可用但不是 rootless；未调整宿主 Docker 配置。

## 初始骨架：状态与边界（认证已由后文 JWT 迁移取代）

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

## 2026-10-26：修复主动停止附带模型失败错误

- 根因在 `Manager._execute` 的终态归并：状态优先检查 `run.stopping`，但
  `run.error` 独立根据 Pi 最后一条消息的 `stopReason == "error"` 写入。
  真实 provider 在中断时可能返回该标记，导致 SSE 同时发布
  `status=stopped` 与模型失败错误；前端按既有规则优先显示 error。
- 最小回归测试在修复前稳定失败（0.47s）：终态为 stopped，但 error 非空。
  现在状态和错误在同一优先级分支内判定：主动停止清除运行级模型错误，
  真正的模型错误仍失败，清理失败仍覆盖终态并锁定运行容量。
  没有修改前端提示或 Pi 原始历史，也不靠匹配英文报错字符串判断停止。
- 回归覆盖两种 Pi 中断表示（aborted/error）、SSE 终态、刷新读取、继续发送、
  未主动停止的真实错误、abort 超时回收、清理失败不释放容量。
- `make check` 通过；后端 32 项通过、默认跳过的 Docker 集成测试单独开启后
  1 项通过；前端 14 项通过。
- 重启本机服务前确认无运行任务。真实管理员/模型浏览器复测：Shell 执行中
  点击停止，最终显示“已停止”；刷新重开仍显示 stopped。原始工具中断结果保留。
  截图存于忽略目录 `.data/acceptance/stop-root-cause-fixed.png`。
- 同一对话继续发送后收到 `STOP_RECOVERY_OK`，输入框恢复可发送，确认停止后容量释放和后续运行正常。

## 2026-10-26：迁移到 DSH 0.2.1-rc.3

- 新对话使用固定版本的官方 DSH SDK server；容器内的窄桥接扩展仅暴露
  实时 assistant-stream、原生历史和 Agent.cancel。没有修改上游源码或复制模型循环。
- 保留 JWT、账号、SQLite、现有前端设计和用户工作文件。旧 Pi 会话只读，
  不转写；新状态保存至每用户 dsh 目录。模型配置仍由管理员 .env 在启动时同步。
- 迁移前在忽略目录 `.data/backups/before-dsh-20261026/` 备份 SQLite 并记录旧
  会话 SHA256；真实验收后账号 ID、邮箱、密码哈希及 5 个旧会话文件均与备份一致。
- `make check` 通过；开启 Docker 后后端 40 项全部通过（包含真实 DSH 与旧 Pi
  容器），前端 14 项通过，生产构建通过。新测试覆盖原生事件、工具错误、压缩后
  展示、子会话过滤、只读旧历史及无需模型启动的空对话。
- 真实管理员和 `.env` 模型验收：登录、18 个流式更新、bash 输出、停止、恢复
  历史通过。浏览器验证真实回复 DSH_BROWSER_OK、工具执行时点击停止、停止后
  可继续发送；最终代码重启后历史恢复正常，旧对话显示只读且输入禁用。
- 原生工具取消结果仍保留在工具卡片中（例如 wait aborted）；运行状态正确显示
  “已停止”，不再产生额外的运行级模型失败提示。截图在忽略目录
  `.data/acceptance/dsh-migration.png`。
- 本次没有实现后端重启后自动续跑、审批面板或子智能体详情 UI。DSH 为预发布，
  安装审计存在上游依赖告警，未通过强制升级改变官方依赖组合。
- 未提交或推送此次迁移；GitHub CI 尚未验证这批修改。

## 2026-10-26：工作区预览、下载、文件交付与思考设置

- 复用 shadcn CLI 的 Sheet/NativeSelect、react-markdown/remark-gfm、浏览器图片/PDF 能力和 FastAPI/Starlette FileResponse。新增工作区面板与专用交付卡片；实际实现和限制见 README。
- DSH 通过公开 defineTool/output.render 持久化 present_files 结果。思考设置使用实际 npm 包公开 installModelSelection；同版本号的较新源码已有 agent.model.select，但发布包尚未包含，已修正研究文档。
- 迁移前确认无活动任务，在忽略目录 .data/backups/before-file-features-20261026-073913/ 保存 SQLite 与环境配置备份。新增 conversation.reasoning，不重写账号或历史。
- make check、生产构建通过；ORCHMESH_TEST_DOCKER=1 make test：后端 49 passed，前端 16 passed。容器测试验证真实 DSH 的交付结果持久化、off/high/default 请求字段、停止与恢复；后端覆盖鉴权、账户隔离、Range、路径穿越、链接/特殊文件、大小上限与打开后路径替换。
- 实际管理员和项目 deepseek-flash：生成 HTML/Markdown 并调用 present_files，流式完成；两个鉴权下载内容通过校验，历史重载仍有卡片。关闭思考返回 0 个推理字符，高等级返回 92 个；不以隐藏 UI 冒充模型参数变化。
- Codex 内置浏览器：卡片打开 HTML、目录导航、Markdown 表格预览、实际下载并与源文件逐字节一致、思考选择保存及刷新恢复通过。隔离验收 HTML 内联脚本未执行，页面保持 SCRIPT_BLOCKED。图片/PDF 分支已实现，此次没有逐格式做浏览器验收。
- 截图：忽略目录 .data/acceptance/file-features.png。验收会话和文件留在真实管理员工作区，未加入版本管理；密钥和日志未被 Git 跟踪。未提交、推送，GitHub CI 未验收这批修改。
- 限制：20 MiB 文件下载、1 MiB 文本预览；HTML 不执行脚本或加载外部资源；交付卡片是当前文件引用，不是版本快照。保留既有 Vite 大 chunk 提示。

## 2026-10-26：桌面分栏工作台

使用项目 shadcn CLI 添加官方 Resizable、Tabs；桌面文件预览不再使用遮罩抽屉。聊天与文件并排、目录常驻、多文件标签去重、关闭相邻选中、面板隐藏恢复及退出清理已接入现有 Zustand 文件状态。小屏仍使用同一内容组件的 Sheet。后端和 Agent 工具协议未改变。

验证：make check、生产构建及前端 17 项通过；新增文件标签生命周期测试。Codex 内置浏览器验证真实历史卡片打开、HTML/Markdown 标签切换、分栏键盘调整、面板收起恢复；并排预览时发送真实模型请求，正常收到 WORKBENCH_OK。本轮未重新运行后端套件；上一轮含 Docker 的 49 项结果不作为本轮新运行。窄屏分支已实现，尚未单独进行手机尺寸浏览器验收。截图保存在忽略目录 .data/acceptance/workbench-layout.png。未提交或推送。


### 左侧会话栏宽度调整

左侧会话栏也接入官方 Resizable，默认 244px，最小 180px，最大窗口宽度 35%；保留窄屏导航切换。生产构建和 ESLint 通过；浏览器验证键盘调整及鼠标拖动，分隔条从约 24.2% 调至 20.5%，右侧分隔条仍可用。仅布局修改，本轮未重复调用真实模型。截图：.data/acceptance/workbench-both-sides.png。

## 2026-10-26：置顶、归档与项目工作目录

迁移前确认没有活动任务并备份数据库至 .data/backups/before-projects-*。新增项目表和会话组织字段，旧会话 project_id 为空，原目录不搬迁。迁移后比对旧账号全字段和旧会话标识、归属、标题，均保持一致。

make check 通过，开启 Docker 的后端 51 项、前端随后补充到 19 项通过。新增项目归属、跨账户拒绝、项目/默认文件范围、生产容器挂载、置顶归档恢复保留历史、归档禁止发送、项目切换清空标签和首条消息归属测试。

真实管理员浏览器创建“项目工作区验收”，真实模型执行 Shell 确认 /workspace，写入并交付 project-proof.md。宿主文件确认只存在对应项目 work 目录，默认 work 未出现同名文件；网页预览 PROJECT_WORKSPACE_OK 成功。置顶、归档隐藏、归档历史只读、恢复及置顶保留通过。截图在忽略目录 .data/acceptance/projects-and-archive.png。未提交或推送。

## 2026-10-26：项目菜单与会话移动

按用户确认，移动仅修改导航分组，保留原执行目录和文件引用。新增 workspace_project_id 并从原 project_id 回填，Project 增加 archived；迁移前确认无活动任务，数据库备份在 .data/backups/before-project-management-*。项目重命名不触碰目录，项目归档只影响有效只读状态、不批量改写子会话归档标志。

复用 shadcn DropdownMenu/Dialog，把项目重命名、归档/恢复及会话置顶、归档、移动放入统一更多菜单。移动对话框说明文件不搬迁、排除归档目标。运行中拒绝移动和项目归档；跨账号访问拒绝。

make check、生产构建通过；开启 Docker 后端 53 passed，前端 19 passed。新增归属校验、重命名空值、项目归档恢复、新建/发送禁止、移动后历史和原目录不变、运行期阻止变更测试。浏览器真实管理员验证重命名、归档隐藏、恢复、移动会话和原目录提示；移动后真实模型读取原 project-proof.md，返回 MOVE_WORKSPACE_OK，原交付卡片预览成功。验收项目为“项目管理验收”和“会话分组验收”，未修改其他用户会话。截图 .data/acceptance/project-management.png。未提交或推送。

## 2026-10-26 官方 DSH 能力收敛

- profile 显式加载官方 `dsh-tool-present`，删除自定义 files.mjs。聊天展示读取官方 `deliverables/presented`，旧 orchmesh.files.v1 卡片只读兼容；工作区外声明不授予网页下载权限。
- 冷历史使用包根公开 `readColdSessionLog`，不激活 Agent；容器测试验证读取不改日志，之后可以正常 resume。实际执行仍使用 SDK resume/prompt/wait。
- 思考等级通过 SDK initialize 传入；rc3 恢复会继承旧 effort 的行为由官方 installModelSelection 一次性明确覆盖，不再维护自定义 WeakMap。
- 检查与构建通过；后端 54 项（含真实 DSH/Pi 容器与确定性模型）、前端 21 项通过。
- 使用现有管理员和真实模型验证官方交付、69 个流式更新、HTML/Markdown 下载、Range、移动分组保留工作目录、归档恢复、断开继续、停止和续聊、关闭思考/恢复默认。
- Codex 内置浏览器验证管理员登录、新卡片/HTML 预览/下载按钮、实际聊天输出与停止；旧交付记录和原 HTML 预览正常。验收过程中本地服务曾退出，重新启动后完成浏览器验收；没有据此修改认证实现。
- 备份比对原 user/conversation/project 行及 35 个已有工作文件/历史文件均未改变。测试创建独立标记项目与会话；数据、日志和截图保留在 git 忽略的 .data 内，未提交代码。
- 官方 WorkspaceRegistry 与完整 SessionController/Gateway 尚未接入：现有 /workspace 历史目录、独立导航分组、可恢复项目归档和账号隔离不能直接按官方桌面语义替换。具体保留理由与迁移前提见 docs/research/dsh-official-reuse-audit.md；本次不声称全部控制层已迁移。

## 2026-10-26：官方项目导航与 Session Controller

本节取代上一节“尚未接入 Controller”的结论。实际 rc3 容器验证后，加载五个官方 Workspace/Controller 配套插件，不引入额外 Web Server、Cookie 登录或 SDK 私有入口。项目登记/名称、会话置顶/归档以官方状态为准；SessionController 负责输入、模型选择、历史和标题投影，SDK 负责 Agent 激活与完成等待。停止继续使用公开 Agent.cancel 清理整个任务；Controller.cancel 保留队列，不适合本产品的停止语义。

执行目录改用稳定的 /workspaces/<project-id> 或 /workspaces/default；/workspace 仅指向同一目录以保留已有文件引用。控制容器只读挂载目录且拒绝执行任务；未配置模型凭据也能进行元数据操作。同一用户仅有一个状态写入进程。SQL 只保留所有权、显示分组、项目归档及导航读缓存，既有行通过官方接口一次性登记。新建失败不先写入 SQL，避免失败请求留下列表记录。

根据“未发布，不做兼容”要求，删除旧 pi/ 执行层、RPC、镜像与相关测试，不再维护两套运行时。核对 5 份旧 Pi 日志均未被现有会话引用，保留磁盘文件不删除。原有交付记录仍按数据内容展示。归档按官方语义清除置顶，恢复后不自动置顶，归档列表隐藏置顶入口。

备份：.data/backups/before-native-navigation-20261026-084447，含数据库和 DSH 状态。迁移保留全部既有用户/项目/会话/运行行，25 份原工作文件与旧 Pi 文件 SHA-256 不变。另用 Alembic 对齐早期两个 UUID 列的声明，原值已是 32 位格式，账号与值不改写；alembic check 无漂移。

验证：后端 56 项（包含真实 DSH 容器与确定性模型），前端 22 项，静态检查、API 类型同步和生产构建通过。真实管理员与配置模型验证项目/会话新建、官方标题、稳定 cwd、流式、文件交付/下载/Range、分组移动保留原文件、归档恢复、断开继续、停止续聊和思考设置。最终真实模型新会话回复 NATIVE_CONTROLLER_OK，确认 pwd 为其项目的稳定目录。内置浏览器验证导航、置顶/归档/恢复及移动后 HTML 卡片预览。验收记录位于忽略目录 .data/acceptance/native-controller.json 和 official-reuse.json。未提交或推送。

## 2026-10-26：保留现有界面，对齐官方桌面导航语义

本节取代上一节的 SQL 导航缓存、项目归档及显示分组移动设计。按用户选择保留当前 React 页面；官方业务 UI 依赖 ModuleLoader/Cordis，不将插件 bundle 当作普通 React 组件深路径导入。复用现有 shadcn/assistant-ui 控件与官方 Host Controller，审查见 [桌面能力对齐](../research/dsh-desktop-alignment.md)。

导航直接读取官方 Workspace 成员关系、Session 标题投影及置顶/归档状态，删除 SQL 重复列。新建传 workspaceId 并采用官方返回 SessionId；SessionId 为不透明字符串，Run 引用同步调整。新增官方会话重命名/分支，项目移除保留会话及文件，取消项目归档与纯分组移动。短生命周期的创建/重命名/分支通过公开 SessionStore.flush 等待持久化，避免退出丢写。

迁移前备份在 `.data/backups/before-native-authority-20261026-090741`。仅将 cwd 匹配的旧会话登记为项目成员，不匹配的进入未分组；SQL directory_id 保留原文件定位。备份比对确认原账号完整一致、原项目/会话/运行行保留、27 份原工作文件及旧 Pi 文件 SHA-256 不变。

验证：后端 54 项（包括真实 rc3 容器）、前端 22 项通过；make check、生产构建和 Alembic schema check 通过。管理员真实模型测试创建项目/会话、bash 写文件、present、流式、原生分支继承历史并继续执行、移除登记后下载、置顶与归档恢复、旧移动请求拒绝。浏览器验证官方重命名、菜单和移除项目后交付卡片预览。记录在 `.data/acceptance/desktop-alignment.json` 与同名 PNG；均不纳入 Git。

尚未接入官方审批、用户提问、输入队列、子任务及调度面板；本轮不声称桌面完整功能对等。未提交或推送。
