# OrchMesh

给自己和少量熟人使用的多用户 Pi 工作空间。React 页面、登录 API 和 SSE 由同一个 FastAPI 服务提供；Pi 在每用户独立的 Docker 容器内运行，保留 Shell、读写文件和原生会话。

## 首次运行

需要 Linux、Python 3.12、uv、Node.js 24、npm 和可用的 Docker。以下命令从仓库根目录运行：

```bash
uv sync --directory apps/server --locked
npm --prefix apps/web ci
docker build -f deploy/pi.Dockerfile -t orchmesh-pi:1.4.0 .
uv run --directory apps/server alembic upgrade head
uv run --directory apps/server orchmesh create-user you@example.com
```

账号命令交互输入密码（至少 12 个字符）。没有默认账号、开放注册或默认密码。

### 配置该账号的模型

**先停止 API 服务**，然后进入项目专用的官方 Pi 界面：

```bash
uv run --directory apps/server orchmesh pi-login you@example.com
```

使用 Pi 的 `/login` 配置该用户凭据，`/model` 选择模型并按 Ctrl+S 保存默认值，再 `/exit`。此命令只挂载该项目用户的目录，不读取宿主个人 `~/.pi`。

兼容 OpenAI 等自定义端点可按 [Pi 官方模型配置](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/models.md) 在账号目录写入 `config/models.json`，并设置默认模型：

```bash
uv run --directory apps/server orchmesh configure-pi you@example.com --provider YOUR_PROVIDER --model YOUR_MODEL
```

命令会显示配置目录。凭据文件权限设为 `600`；不要提交或粘贴进聊天。容器内的 Shell 能读取本用户凭据，因此只使用为该用户授权的模型凭据。

### 构建并启动

```bash
npm --prefix apps/web run build
uv run --directory apps/server fastapi run --host 127.0.0.1 --port 8000
```

打开 http://127.0.0.1:8000。FastAPI 原生 `frontend()` 托管 `apps/web/dist`；不需要 Nginx 或独立前端生产进程。

开发时分别运行：

```bash
uv run --directory apps/server fastapi dev --host 127.0.0.1
npm --prefix apps/web run dev
```

Vite 将 `/api` 代理到 8000 端口。环境变量示例见 [.env.example](.env.example)。对外部署前提供 HTTPS 并启用 `ORCHMESH_COOKIE_SECURE=true`。运行实例锁限制同一数据目录只能启动一个 API；开发热重载会中断执行，不会自动重放任务。

## 结构与技术栈

```text
apps/server/
  src/orchmesh/
    main.py          # API、SSE、用户归属和生命周期
    auth.py          # FastAPI Users Cookie + 数据库会话
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

前端使用 React、TypeScript、Vite、Tailwind、shadcn/ui、assistant-ui、TanStack Query 和 Zustand；后端使用 FastAPI、FastAPI Users、SQLAlchemy、SQLite、Alembic、starlette-csrf 和 limits。版本以锁文件为准，官方生成器的改动记录见 [实施与验收记录](docs/development/implementation.md)。

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
