# OrchMesh 项目结构与技术栈

更新：2026-10-26。本文描述已实现的结构；运行语义见 [v0.1 架构](v0.1-simplified.md)，安装与配置见 [README](../../README.md)。历史调研不作为当前实现说明。

## 部署结构

一个仓库、一个生产 Web 服务。Vite 构建至 `apps/web/dist/`，FastAPI 原生 `app.frontend()` 直接托管该目录，同时提供 `/api` 和 SSE。当前采用仓库目录运行，未实现把前端复制进 Python wheel 的发布流程。

开发时 `make dev` 启动 FastAPI 和 Vite 两个进程，Vite 将 `/api` 代理至配置的后端端口；生产运行方式 `make run` 只有一个 Web 端口。DSH 按需在用户容器中执行，不是额外的 Web 服务。未引入 Nginx、Compose 或 Dev Container；公网 HTTPS 和部署运维尚未验收。

## DSH 迁移增量

当前运行代码在 `apps/server/src/orchmesh/dsh/`，官方运行时与扩展在 `apps/runtime/`，镜像为 `deploy/dsh.Dockerfile`。旧 `pi/` 运行时与镜像已移除。配置与生命周期以 [DSH 执行层](dsh-runtime.md) 为准，

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
│   │   ├── dsh/
│   │   │   ├── containers.py        # 用户挂载、容器启动与清理
│   │   │   ├── rpc.py               # JSON-RPC 2.0 管道
│   │   │   ├── manager.py           # 执行槽位、停止、历史与恢复
│   │   │   ├── events.py / messages.py # 原生事件到聊天展示的适配
│   │   │   └── configuration.py     # .env 模型配置适配
│   └── tests/                      # pytest；fake_dsh 和真实容器测试
├── apps/runtime/
│   ├── package.json / package-lock.json # 固定官方 DSH 版本
│   └── launch.mjs / bridge.mjs      # 模型配置与 SDK 公开接口桥接
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
├── deploy/dsh.Dockerfile            # DSH 0.2.1-rc.3，Node 24
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
| Agent | DSH 0.2.1-rc.3：模型循环、工具、JSONL 事件；Docker 隔离用户目录 |
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
    ├── config/                      # 兼容原有文件布局的模型配置及凭据
    ├── dsh/sessions/                # DSH 原生持久事件
    └── sessions/<conversation UUID>.jsonl # 保留的旧 Pi 历史
```

本机还可能有 `backups/`、`acceptance/` 等备份和验收文件。DSH 只挂载对应用户的 work、config、dsh 目录，不挂载平台数据库、签名密钥或日志。备份需协调停止写入，并保存数据库、签名密钥和用户目录；不是单独复制正在写入的 SQLite 主文件。

## 复用边界

官方 DSH 负责模型循环、工具执行、事件持久化和取消；平台通过官方 SDK server 公开 API 的小型扩展接入。没有复制 Agent Loop，也没有启用 DSH Web API 的第二套认证。

前端继续使用 `@assistant-ui/react-pi` 的公开消息投影函数作为展示格式适配，适配 DSH 展示事件；这不代表执行层仍是 Pi。新增运行事件通过现有鉴权 SSE 传输。详见 [DSH 执行层](dsh-runtime.md)。

MCP、权限审批、分支、子 Agent 观测等上游能力尚未全部映射到平台 UI。当前支持断开页面后继续执行和重开历史；服务重启后的未完成任务标记 interrupted，不自动重放有副作用的工具。

## 工作区交付与思考设置（2026-10-26）

- `apps/server/src/orchmesh/workspace.py`：只读鉴权目录与文件下载，复用账户工作目录。
- `apps/runtime/launch.mjs`：加载官方 dsh-tool-present；桥接原生 deliverables/presented 事件，旧文件卡片兼容保留。
- `apps/web/src/features/workspace/`：文件面板、统一预览/下载和聊天交付卡片。
- `features/chat/ReasoningSettings.tsx`：按模型能力展示思考偏好；数据库仅保存每对话选择，运行请求由官方 DSH 模型选择接口组装。
- 预览复用 shadcn Sheet、react-markdown/remark-gfm 和浏览器能力；不引入文档转换服务、对象存储或另一套文件授权体系。

## 项目与会话组织

项目、会话导航直接读取 DSH Workspace/Session Controller。Project 行保存账号所有权与稳定目录映射；Conversation 使用官方不透明字符串 ID，以 directory_id 定位文件。SQL 不再保存标题、置顶、归档或显示分组副本。

Navigation.tsx 保留当前设计，提供项目新建/重命名/移除、会话重命名/分支/置顶/归档恢复。项目移除保留 SQL 目录映射与原文件，会话成为未分组。取消项目归档和跨目录纯分组移动。详细接口、迁移与组件复用边界见 [DSH 执行层](dsh-runtime.md) 和 [桌面能力审查](../research/dsh-desktop-alignment.md)。
