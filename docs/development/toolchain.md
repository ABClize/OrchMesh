# 开发工具链与官方 Skills

> 实施状态更新（2026-10-26）：登录、Pi RPC、SSE 和停止骨架已实现；实际结构与验收以 [实施记录](../development/implementation.md) 和仓库 README 为准。下文保留设计/工具调研背景。
核查并安装：2026-10-26。项目已有依赖清单、锁文件和开发工具；尚无应用入口、页面、迁移脚本或业务测试。CLI 可用不等于应用已经可运行。

## 版本原则

优先使用执行安装时 npm/PyPI 的最新稳定版本，兼容约束优先于版本数字。不使用 `--force`、`--legacy-peer-deps` 跳过冲突，不主动选择 beta/canary。前端精确版本与完整解析结果写入 package.json/package-lock.json，后端写入 pyproject.toml/uv.lock。今后的更新须重新解析并执行适配测试。

当前 Python 固定 3.12 系列（本机解析为 3.12.15），Node 固定 24 系列（本机 24.21.0）。这两个是既有架构和宿主可用的兼容运行环境，不宣称是最新语言大版本。无需为升级 FastAPI 改动全局 Python/Node。

已验证的重要例外：

- SQLAlchemy 使用 **2.0.55**：fastapi-users-db-sqlalchemy 7.0.0 的包约束为 `sqlalchemy[asyncio]>=2.0.0,<2.1.0`，所以不强装最新 2.1.6。
- TypeScript 使用 **5.9.3**：openapi-typescript 7.13.0 的 peer 范围为 `^5.x`，typescript-eslint 8.72.0 为 `<6.1.0`；当前 latest TypeScript 7.0.2 不符合这套组合。
- FastAPI 安装基础包、官方 fastapi-cli 和 uvicorn[standard]，未保留 standard extra 自动带入的云部署 CLI；本项目采用本地部署。

版本事实核对自 [PyPI](https://pypi.org/project/fastapi/)、[npm](https://www.npmjs.com/package/shadcn) 及实际安装包 metadata；完整已装直接依赖快照见 [toolchain-versions.json](toolchain-versions.json)。

## 后端：从仓库根目录运行

```bash
uv sync --directory apps/server --locked
uv run --directory apps/server fastapi --help
uv run --directory apps/server alembic --help
uv run --directory apps/server ruff --version
uv run --directory apps/server pyright --version
uv run --directory apps/server pytest --version
```

官方 [FastAPI CLI](https://fastapi.tiangolo.com/fastapi-cli/) 用 `fastapi dev` 开发，`fastapi run` 生产；创建应用后再配置 `[tool.fastapi].entrypoint`，生产保持单 worker。现在不要把无入口的启动失败误诊成安装故障。

Ruff、Pyright、Alembic、pytest 都是各项目的正式 CLI。沿用 Pyright，不为凑齐工具同时启用第二套类型检查器。需要管理员账号命令时复用已安装的 Typer；目前无业务 CLI 命令。

## 前端：从仓库根目录运行

```bash
npm --prefix apps/web ci
npm --prefix apps/web run shadcn -- --help
npm --prefix apps/web run assistant-ui -- --help
npm --prefix apps/web run vite -- --version
npm --prefix apps/web run tsc -- --version
npm --prefix apps/web run eslint -- --version
npm --prefix apps/web run prettier -- --version
npm --prefix apps/web run vitest -- --version
npm --prefix apps/web run openapi-typescript -- --help
```

`assistant-ui` CLI 没有 `--version`，版本从 package.json/lock 读取；用 `--help` 或 `info` 检查 CLI。

浏览器调试与交互验收统一使用 Codex 内置浏览器。项目不安装 Playwright CLI、Test 或对应 skill；验收步骤见 [浏览器验收](browser-acceptance.md)。

## 初始化顺序与边界

1. 先补 Vite 配置、React 入口和 TypeScript alias，沿用已有 package.json，不运行默认生成另一套工程的创建命令。
2. 使用官方 shadcn CLI 为 Vite 初始化配置。模板明确选择 Vite，避免默认 Next.js。按需添加组件，不 `add --all`。
3. 使用 assistant-ui CLI 的 `add` 加聊天组件，按既定 ExternalStoreRuntime 接自有 FastAPI/Pi 后端；不要默认生成 AI SDK、Next.js 或云服务模板。
4. Tailwind 使用官方 Vite 插件，已经安装；本构建路径不需要再安装独立 Tailwind CLI。
5. OpenAPI CLI 从应用导出的 schema 生成 TS 类型；应用未创建前不生成假的 API 文件。

源码资源更新遵守官方 CLI 的 dry-run/diff 能力，先检查本地修改。详见 [shadcn CLI](https://ui.shadcn.com/docs/cli)、[assistant-ui 工具调研](../research/frontend-tooling.md)。

## 已安装官方 Skills

全部通过 `npx skills` 安装在项目 `.agents/skills/`，不定制上游文件；来源与内容哈希由根目录 `skills-lock.json` 记录。

| 来源 | 安装技能 | 作用 |
|---|---|---|
| fastapi/fastapi | fastapi | FastAPI 新接口、依赖、SSE、前端托管 |
| shadcn-ui/ui | shadcn | 官方组件查询、添加、更新与样式约定 |
| assistant-ui/skills | assistant-ui、setup、runtime、elements、primitives、markdown、thread-list、tools、streaming、update | 聊天组件、外部状态、事件、工具 UI 与升级 |

共 **12 个项目级 skills**。这是按已选技术栈筛选的官方子集，不包含云端、移动端、其他 Agent 框架等无关技能。[shadcn 官方 skills 文档](https://ui.shadcn.com/docs/skills)、[assistant-ui 官方 skills](https://github.com/assistant-ui/skills)

未找到可确认适配本项目的 TanStack Query、Vite、React 官方技能时，继续使用官方文档；不把社区同名技能标成官方，也不装 TanStack Start/Router 来代替 Query。

```bash
# 从仓库根目录执行，确保 scope 是项目
npx skills list --json
npx skills update -p -y
# 单独补装/恢复例子
npx skills add fastapi/fastapi --skill fastapi -a codex -y
npx skills add shadcn-ui/ui --skill shadcn -a codex -y
```

上游技能提供通用默认值，项目边界仍优先：FastAPI 技能的 SQLModel/Asyncer 偏好不会自动替换已确定的 SQLAlchemy/asyncio；shadcn 的聊天组件建议不会替换 assistant-ui；assistant-ui 的默认 AI SDK 示例不引入新的 Agent Loop。用户授权执行的具体组件操作无需因技能泛化提示重复请求确认。

## 本次验证

已执行依赖解析与安装、`uv pip check`、`npm ls --depth=0`、各 CLI 版本或帮助检查；FastAPI SSE、frontend 方法、认证数据库策略、CSRF、async ORM 的导入检查通过。npm 安装报告 0 个已知漏洞，不代表安全审计或业务验收。

Chromium 下载并无头启动成功；临时 FastAPI 应用原生 frontend 页面托管冒烟通过。当前 Starlette TestClient 已提示优先 httpx2，故开发依赖补入 httpx2，保留 httpx 用于现有兼容路径。

尚未执行应用构建、真实登录/CSRF、Pi 集成或业务 E2E。后续应补配置和应用入口后按前述架构执行验证。
