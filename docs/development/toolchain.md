# 开发工具链与项目 Skills

更新：2026-10-26。应用、迁移、管理 CLI 和业务测试均已实现。日常运行以 [README](../../README.md) 和 Makefile 为入口；本文说明工具边界。

## 依赖与版本

Python 使用 3.12，前端及 Pi 镜像使用 Node 24。后端依赖声明在 `apps/server/pyproject.toml`，解析结果在 `uv.lock`；前端声明在 `package.json`，解析结果在 `package-lock.json`。声明可能使用兼容范围，锁文件才是复现依据。

[toolchain-versions.json](toolchain-versions.json) 是本次从锁文件及本机运行时生成的直接依赖快照，不是上游 latest 清单。安装使用 `uv sync --locked` 和 `npm ci`；升级后重新锁定并验证，不用 force 或 legacy-peer-deps 跳过约束。

- 已移除 FastAPI Users、其数据库适配器和 starlette-csrf，认证直接使用 PyJWT、pwdlib。
- SQLAlchemy 保留现有 2.0 系列；原认证适配器约束已不存在，当前没有为追求版本数字而升级 ORM。
- TypeScript 5 与当前 openapi-typescript 等工具兼容，升级需一起核查 peer 范围。
- FastAPI 基础包、官方 fastapi-cli、uvicorn 已安装；不引入云部署 CLI 或第二套 Python 类型检查器。

## 运行与质量检查

`make setup` 准备依赖和镜像，`make dev` 启动双进程热更新，`make run` 构建并以单 Web 服务运行。两个启动入口均执行 Alembic；FastAPI entrypoint 已在 pyproject 中配置。`orchmesh` 管理 CLI 使用 Python argparse，提供账号、Pi 配置、镜像和启动入口。

`make check` 执行 Ruff lint/format、Pyright、ESLint、TypeScript、Prettier，以及只读的 API 类型同步检查。`make test` 构建前端并执行 pytest/Vitest；`ORCHMESH_TEST_DOCKER=1 make test` 加测真实 Pi 镜像与本地模拟模型。

更新 API 后运行 `./scripts/generate-api.sh`；`./scripts/check-api.sh` 在临时目录导出并比较 schema/types，不改写仓库文件，也不使用运行数据目录。

GitHub Actions 配置位于 `.github/workflows/check.yml`，使用锁定依赖执行相同检查和默认测试，不读取个人 `.env`。当前仅完成本地验证，尚未在 GitHub 运行。浏览器和真实模型验收按 [验收清单](browser-acceptance.md) 单独执行。

## 官方组件 CLI

```bash
npm --prefix apps/web run shadcn -- --help
npm --prefix apps/web run assistant-ui -- --help
npm --prefix apps/web run openapi-typescript -- --help
uv run --directory apps/server fastapi --help
uv run --directory apps/server alembic --help
```

现有工程由 create-vite、shadcn 和 assistant-ui CLI 初始化。继续按需添加组件，更新前检查本地定制；避免生成另一套默认 Next.js/AI SDK 工程。Tailwind 使用 Vite 插件。项目不安装额外浏览器 CLI 或 Playwright Test，交互调试使用 Codex 内置浏览器。

`@assistant-ui/react-pi` 仅使用浏览器安全入口的公开消息转换函数。当前未启用其 Node SDK supervisor；Pi 1.4 RPC 与 SDK reducer 的完整消息契约不同，详见 [架构说明](../architecture/project-blueprint.md#复用边界)。

## 项目级 Skills

12 个技能放在 `.agents/skills/`，通过 `npx skills` 管理，来源和哈希在 `skills-lock.json`。不改上游技能源码、不安装为全局。

| 来源 | 技能 |
|---|---|
| fastapi/fastapi | fastapi |
| shadcn-ui/ui | shadcn |
| assistant-ui/skills | assistant-ui、setup、runtime、elements、primitives、markdown、thread-list、tools、streaming、update |

从仓库根目录使用 `npx skills list --json` 查看，维护时使用 `npx skills update -p -y`。上游默认示例不覆盖项目已确认的 FastAPI/Pi、SQLAlchemy/asyncio 和多用户容器边界。
