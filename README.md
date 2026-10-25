# OrchMesh

给自己和少量熟人使用的多用户 Pi 工作空间。React 页面、登录 API 和 SSE 由同一个 FastAPI 服务提供；Pi 在每用户独立的 Docker 容器内运行，保留 Shell、读写文件和原生会话。

## 首次运行

需要 Linux、Python 3.12、uv、Node.js 24、npm 和可用的 Docker。从仓库根目录执行：

```bash
make setup
# 编辑根目录 .env，填写下面的账号与模型配置
make run
```

`setup` 安装锁定依赖、在缺失时创建权限为 `600` 的 `.env`，并构建 Pi 镜像；不会覆盖已有 `.env`。`run` 构建前端、自动执行 Alembic 迁移并启动 FastAPI。默认打开 http://127.0.0.1:8000，页面和 API 同源，不需要 Nginx 或独立前端生产进程。

### 统一配置：根目录 .env

完整模板见 [.env.example](.env.example)。不要将 `.env` 提交或把凭据粘贴进聊天。

```dotenv
ORCHMESH_HOST=127.0.0.1
ORCHMESH_PORT=8000
ORCHMESH_WEB_PORT=5173
ORCHMESH_BOOTSTRAP_ADMIN_EMAIL=you@example.com
ORCHMESH_BOOTSTRAP_ADMIN_PASSWORD='自行设置至少12个字符的密码'
ORCHMESH_MODEL_BASE_URL=https://your-provider.example/v1
ORCHMESH_MODEL_API=openai-completions
ORCHMESH_MODEL_API_KEY='填写项目专用Key'
ORCHMESH_MODEL_ID=填写供应商的模型ID
```

- 登录账号使用邮箱。首次启动创建 `is_superuser=true` 的管理员；没有默认密码或开放注册。当前界面尚无管理后台。
- `BOOTSTRAP_ADMIN_*` **仅用于初始化管理员**：重复启动不修改密码、不提升已有普通用户权限，也不在已有管理员时创建第二位管理员。初始化后可清空这两项；运行模型配置仍会作用于已有管理员。
- 模型地址、Key、ID 三项同时填写，或全部留空后通过 Pi 配置。支持 `openai-completions`、`openai-responses`、`anthropic-messages`；协议须与供应商接口对应。
- `ORCHMESH_MODEL_*` 是管理员模型的运行配置，**修改 `.env` 后重启 `make run` / `make dev` 即生效**。无需打开 Pi 配置文件。`.env` 由 pydantic-settings 读取，不依赖 shell 执行。
- 启动时自动同步到管理员的 Pi 配置（文件权限 `600`）：平台管理 `project-api` provider 和默认模型，保留其他 provider 与无关设置，不修改其他用户。不要手改这部分生成配置。模型地址、Key、ID 全部清空后，重启会移除该 provider、旧 Key 和对应默认模型；其他原生 Pi 配置仍可使用。
- 原先的 `ORCHMESH_BOOTSTRAP_MODEL_*` 已更名为 `ORCHMESH_MODEL_*`；旧配置需同步更名，值无需改变。
- 端口、监听地址等运行配置修改后重启生效；开发时代理自动跟随 API 端口。系统环境变量优先于 `.env`。含 `#`、空格或 `$` 的秘密建议使用单引号；不要 `source .env`。
- Pi 在 Docker 内请求模型，模型地址的 `localhost` 指向容器自己；本机模型服务请填写容器可达的宿主地址。凭据只放进该管理员的 Pi 配置，不复制给其他用户；本用户 Shell 能读取自身凭据。

### 日常命令

| 命令 | 用途 |
|---|---|
| `make setup` | 首次安装或更新依赖、构建 Pi 镜像 |
| `make dev` | 一个终端启动前后端热更新，默认打开 http://127.0.0.1:5173 |
| `make run` | 构建页面并启动单服务，默认 8000 端口 |
| `make check` | Ruff、Pyright、ESLint、TypeScript 检查 |
| `make test` | 构建并运行 pytest、Vitest，不调用外部模型 |

`make` 或 `make help` 显示上述命令。真实 Pi + 本地模拟模型回归使用 `ORCHMESH_TEST_DOCKER=1 make test`。不额外包装低频管理操作：

```bash
# 添加熟人账号，交互输入密码
uv run --directory apps/server orchmesh create-user friend@example.com
# 停止 API 后，打开该用户的官方 Pi 界面：/login、/model，再 /exit
uv run --directory apps/server orchmesh pi-login friend@example.com
# 更新 API 类型
./scripts/generate-api.sh
```

所有服务前台运行，日志在当前终端，按 **Ctrl+C** 停止；`make dev` 会一起停止前后端。一侧退出时另一侧也会结束。`dev` 与 `run` 二选一，单实例锁限制同一数据目录只能运行一个 API。后端热重载会中断任务，长任务验收用 `make run`。

对外部署前提供 HTTPS。JWT 默认有效期 60 分钟，可通过 `ORCHMESH_ACCESS_TOKEN_EXPIRE_MINUTES` 调整。暂不增加 Dev Container、Compose 或进程管理依赖。Makefile 参考 [Dify](https://github.com/langgenius/dify/blob/main/Makefile) 的任务组合和 [Argo CD](https://github.com/argoproj/argo-cd/blob/master/Makefile) 的脚本委托方式，只保留本项目常用入口。

## 结构与技术栈

```text
apps/server/
  src/orchmesh/
    main.py          # API、SSE、用户归属和生命周期
    auth.py          # OAuth2 Bearer JWT + pwdlib
    config.py        # pydantic-settings
    storage.py       # SQLAlchemy async 模型
    cli.py           # 账号与 Pi 配置入口
    pi/              # 官方 JSONL RPC、容器、运行管理、临时消息投影
  migrations/        # Alembic
  tests/             # pytest、RPC 故障测试、真实 Pi 容器测试
apps/web/
  src/components/    # shadcn / assistant-ui CLI 生成的组件
  src/features/chat/ # Zustand 状态与 ExternalStoreRuntime 适配
  src/lib/           # openapi-fetch、生成的 API 类型
deploy/pi.Dockerfile
.agents/skills/       # 项目级 upstream skills
```

前端使用 React、TypeScript、Vite、Tailwind、shadcn/ui、assistant-ui、TanStack Query 和 Zustand；后端使用 FastAPI、PyJWT、pwdlib、SQLAlchemy、SQLite、Alembic 和 limits。版本以锁文件为准，官方生成器的改动记录见 [实施与验收记录](docs/development/implementation.md)。

## 验证与维护

```bash
uv run --directory apps/server ruff check src tests
uv run --directory apps/server pyright src
uv run --directory apps/server pytest -q
# 需已构建 Pi 镜像；使用本地模拟模型，不消耗外部 API：
ORCHMESH_TEST_DOCKER=1 uv run --directory apps/server pytest -q tests/test_pi_docker.py
npm --prefix apps/web run lint
npm --prefix apps/web test -- src/features/chat/store.test.ts
npm --prefix apps/web run build
./scripts/generate-api.sh
```

浏览器调试与页面验收使用 Codex 内置浏览器，不安装额外浏览器 CLI 或测试框架。操作清单和独立测试服务见 [浏览器验收](docs/development/browser-acceptance.md)。基础静态页面测试需先构建前端。

默认运行数据在忽略提交的 `.data/`：平台数据库与每用户 `work/`、`config/`、`sessions/`。备份时一起保存数据库和用户目录；Pi JSONL 是消息历史源，数据库只保存账号、会话索引和执行状态。

初版每用户一个活动执行，全局默认四个。断线不停止任务；重连先读取快照。停止先清队列再 abort，超时则销毁容器；已发生的工具副作用不回滚。服务重启清理遗留容器并标记中断。容器隔离挂载目录，但网络仍可出站；当前面向可信熟人，不是敌对租户沙箱。

**验收边界：**本地 RPC、真实 Pi 容器及模拟模型、浏览器链路已测试；真实外部模型凭据由使用者另行配置，尚未进行真实模型与公网部署验收。


## 认证与迁移

认证遵循 FastAPI 官方全栈模板：`POST /api/login/access-token` 接收邮箱/密码表单，返回 Bearer JWT；前端在当前 origin 的 localStorage 保存 `access_token`。API 和聊天流都通过 Authorization 请求头认证，不把令牌写进 URL，不再使用登录 Cookie 或 CSRF。

聊天流复用 `@microsoft/fetch-event-source`，支持带认证头、断线重连、AbortController；刷新后重新读取快照。401/令牌过期会清除当前登录，服务器也会检查流中令牌过期和账号禁用。退出清除本浏览器当前 origin 的令牌并关闭流，其他标签页同步退出；其他浏览器不受影响。已经签发的 JWT 在过期前仍有效，退出不会终止后台 Pi 任务，不提供 JWT 黑名单或自动刷新令牌。

首次升级先备份 `.data/`。`make run` / `make dev` 自动迁移：旧用户 UUID 的数据库表示规范化，密码哈希、角色、对话 ID、执行记录及 Pi 用户目录保持不变；旧登录会话表移除，需要重新登录。历史迁移去除了对已删除认证包的导入，仍可从空库升级。JWT 密钥自动保存在私有 `.data/jwt-secret`（600），持久保留；删除或更换会使现有 JWT 全部失效。

旧浏览器 Cookie 不再参与任何鉴权，可由浏览器正常清理；应用不保留双栈兼容分支。localStorage 的令牌可被同源 JavaScript 读取，这是官方模板的取舍；不渲染未净化的 HTML，不向 URL、日志或错误信息输出令牌。

### 日志与自动检查

应用日志默认写入 `.data/logs/orchmesh.log`，按本机时区每日轮转，历史文件名为
`orchmesh.log.YYYY-MM-DD`；重启继续追加。根目录 `.env` 可配置
`ORCHMESH_LOG_LEVEL` 和 `ORCHMESH_LOG_RETENTION_DAYS`（默认保留 30 份每日归档）。
使用 `tail -F .data/logs/orchmesh.log` 持续查看。日志包含 HTTP 状态、请求 ID、
运行 ID、失败阶段和退出码，不记录 Key、密码、聊天正文或原始工具输出。
轮转、保留与诊断边界见 [日志说明](docs/development/logging.md)。

`make check` 同时检查格式、类型、Lint 和 OpenAPI 生成文件同步；GitHub Actions
执行同一检查及确定性测试，不使用个人管理员凭据或真实模型。
