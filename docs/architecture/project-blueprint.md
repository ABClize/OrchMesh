# OrchMesh 项目结构与技术栈

更新：2026-10-26。本文描述已实现的结构；运行语义见 [v0.1 架构](v0.1-simplified.md)，安装与配置见 [README](../../README.md)。历史调研不作为当前实现说明。

## 部署结构

一个仓库、一个生产 Web 服务。Vite 构建至 `apps/web/dist/`，FastAPI 原生 `app.frontend()` 直接托管该目录，同时提供 `/api` 和 SSE。当前采用仓库目录运行，未实现把前端复制进 Python wheel 的发布流程。

开发时 `make dev` 启动 FastAPI 和 Vite 两个进程，Vite 将 `/api` 代理至配置的后端端口；生产运行方式 `make run` 只有一个 Web 端口。Pi 按需在用户容器中执行，不是额外的 Web 服务。未引入 Nginx、Compose 或 Dev Container；公网 HTTPS 和部署运维尚未验收。

## 实际结构

```text
OrchMesh/
├── .env.example                     # 配置模板；真实 .env 不提交
├── AGENTS.md                        # 贡献约定
├── Makefile                         # setup/dev/run/check/test/help
├── .github/workflows/check.yml      # 确定性检查与测试
├── .agents/skills/                  # 项目级上游 skills
├── skills-lock.json
├── apps/server/
│   ├── pyproject.toml / uv.lock
│   ├── migrations/                  # Alembic schema 历史
│   ├── src/orchmesh/
│   │   ├── main.py                  # 路由、归属校验、SSE、生命周期
│   │   ├── auth.py / security.py    # Bearer JWT、密码哈希、登录限流
│   │   ├── accounts.py              # 账号模型及创建查询
│   │   ├── config.py / bootstrap.py # .env、初始管理员、模型同步
│   │   ├── storage.py               # SQLAlchemy 模型与 async Session
│   │   ├── cli.py / serve.py        # 管理命令、官方 CLI 启动包装
│   │   ├── logging.py              # 应用诊断及每日轮转
│   │   └── pi/
│   │       ├── containers.py        # 用户挂载、容器启动与清理
│   │       ├── rpc.py               # 官方 JSONL RPC 收发
│   │       ├── manager.py           # 执行槽位、停止、历史与恢复
│   │       ├── events.py            # 内存消息投影
│   │       └── configuration.py     # .env 到 Pi 配置的适配
│   └── tests/                      # pytest；含 fixtures/fake_pi.py
├── apps/web/
│   ├── package.json / package-lock.json
│   ├── openapi.json                # 提交的 API schema
│   └── src/
│       ├── main.tsx / App.tsx       # 入口、登录表单、工作区
│       ├── features/auth/           # TanStack Query 认证 hook
│       ├── features/chat/           # RPC 增量适配、Zustand、聊天界面
│       ├── components/             # shadcn/ui、assistant-ui 生成源码
│       ├── lib/                    # API 类型、请求、令牌与 SSE
│       └── index.css
├── deploy/pi.Dockerfile             # Pi 1.4.0，Node 24
├── scripts/                        # generate-api.sh、check-api.sh
└── docs/                           # 架构、开发说明、历史调研
```

模块按当前职责保留为文件；未预建 repository/service 等空层。测试就近放置，后端使用 `test_*.py`，前端使用 `*.test.ts`。

## 当前技术栈

| 领域 | 选择与用途 |
|---|---|
| 后端 | Python 3.12、FastAPI、Uvicorn，单应用进程 |
| 校验与配置 | Pydantic、pydantic-settings，根目录 .env |
| 元数据 | SQLite、SQLAlchemy async、aiosqlite、Alembic；外键约束不启用 |
| 认证 | OAuth2 表单登录、PyJWT、pwdlib Argon2/Bcrypt；无 Cookie/CSRF 会话 |
| 登录限流 | limits async MemoryStorage；执行限额由 Manager 负责 |
| 前端 | React、TypeScript、Vite、Tailwind、shadcn/ui |
| 聊天 | assistant-ui ExternalStoreRuntime 与生成组件；react-pi 官方消息转换 |
| 状态 | TanStack Query 管理请求、mutation 和快照；Zustand 管理活动聊天 |
| API | openapi-typescript + openapi-fetch；Authorization 请求头 |
| 浏览器流 | @microsoft/fetch-event-source + FastAPI 原生 SSE |
| Agent | Pi 1.4.0：模型循环、工具、JSONL 历史；Docker 隔离用户目录 |
| 日志 | Python logging + TimedRotatingFileHandler，控制台和每日文件 |
| 检查 | Ruff、Pyright、pytest；ESLint、Prettier、TypeScript、Vitest |
| 工具链 | uv、npm、官方组件 CLI、npx skills；版本以锁文件为准 |
| 浏览器验收 | Codex 内置浏览器；不添加 Playwright 项目依赖 |

## 数据目录

默认 `.data/`，整体忽略提交；可通过 `ORCHMESH_DATA_DIR` 指定绝对路径。

```text
.data/
├── platform.sqlite3                 # user、conversation、run
├── jwt-secret                       # 持久签名密钥，权限 600
├── runtime.lock                     # 单实例执行管理锁
├── logs/orchmesh.log                 # 当前日志；历史按日期归档
└── users/<UUID>/
    ├── work/                        # 该用户各对话共享文件
    ├── config/                      # Pi 配置及用户模型凭据
    └── sessions/<conversation UUID>.jsonl
```

本机还可能有 `backups/`、`acceptance/` 等备份和验收文件。Pi 只挂载对应用户的三个目录，不挂载平台数据库、签名密钥或日志。备份需协调停止写入，并保存数据库、签名密钥和用户目录；不是单独复制正在写入的 SQLite 主文件。

## 复用边界

Pi 的 RPC 不等于 React SDK 的事件契约：1.4.0 RPC 的 `message_update` 省略完整消息，而 `@assistant-ui/react-pi` 的 reducer 需要完整消息。因此当前复用公开的 `projectPiThreadMessages`，保留增量重建；没有启用其 Node supervisor，也没有增加 Node 中转服务。

MCP Streamable HTTP 是 Pi 与远程工具的传输方式，不替代浏览器聊天 SSE。MCP 配置与额外模型由 Pi 原生能力处理，平台未实现相关管理界面。Pi Durable 暂不采用。
