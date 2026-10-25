# OrchMesh 项目结构与技术栈

> 实施状态更新（2026-10-26）：登录、Pi RPC、SSE 和停止骨架已实现；实际结构与验收以 [实施记录](../development/implementation.md) 和仓库 README 为准。下文保留设计/工具调研背景。
状态：首版实施蓝图；已安装项目依赖、官方开发 CLI 与 skills，尚未创建应用入口或业务界面。范围为本人和少量熟人使用的多用户 Pi Web 工作台。目录按功能逐步创建，不预先生成空模块。

## 一、代码与部署边界

一个仓库，前后端源码分目录，生产环境由 FastAPI 同时提供页面、API 和 SSE。`apps/web` 是前端构建工程，不是独立生产服务。开发时启动 Vite 与 FastAPI，Vite 将 `/api` 代理到后端。

发布时执行前端构建，将 `apps/web/dist/` 复制进 Python 应用包的 `orchmesh/web_dist/`，作为生成资源随应用一起发布，不提交 Git。使用当前 FastAPI 原生 `app.frontend()` 托管产物，复用其低优先级页面路由与 SPA 回退，避免手写 StaticFiles 回退。实现时验证未知 API 和缺失资源的响应。第一版不配置独立 Nginx，HTTPS 由部署入口提供，具体入口在部署时确定。

FastAPI 提供原生 frontend 接口，Vite 支持构建产物与后端集成；此处选择完整 SPA 产物托管，不引入服务端模板渲染。[FastAPI](https://fastapi.tiangolo.com/tutorial/static-files/)、[Vite](https://vite.dev/guide/backend-integration)

## 二、目标结构树

```text
OrchMesh/
├── AGENTS.md                         # 贡献指南与文档入口
├── README.md                         # 安装、开发、发布说明
├── .gitignore
├── .env.example                      # 平台配置示例，不含真实密钥
├── apps/
│   ├── web/                          # 只负责 UI 和前端构建
│   │   ├── package.json
│   │   ├── package-lock.json
│   │   ├── vite.config.ts
│   │   ├── tsconfig.json
│   │   ├── index.html
│   │   ├── public/                   # 图标等公开静态资源
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── app/                  # 页面路由、布局、Provider
│   │       ├── features/
│   │       │   ├── auth/             # 登录界面
│   │       │   └── chat/             # assistant-ui 组件、外部状态适配器、事件处理
│   │       ├── components/ui/        # 按需引入的 shadcn/ui 组件
│   │       ├── lib/                  # 生成的 API 类型、openapi-fetch、SSE
│   │       └── styles/               # 全局样式和主题
│   └── server/                       # 一个 Python 项目
│       ├── pyproject.toml
│       ├── uv.lock
│       ├── alembic.ini
│       ├── migrations/               # SQLite schema 迁移
│       ├── src/orchmesh/
│       │   ├── main.py               # FastAPI 组装与生命周期
│       │   ├── config.py             # 环境配置验证
│       │   ├── cli.py                # 管理员创建账号等维护命令
│       │   ├── auth/                 # FastAPI Users 配置、CSRF、限流与账号管理
│       │   ├── conversations/        # 聊天归属、执行请求、SSE
│       │   ├── pi/                   # 所有 Pi/容器交互集中于此
│       │   │   ├── rpc.py            # JSONL 分帧、请求 ID、响应及事件
│       │   │   ├── manager.py        # 会话进程、并发、取消与回收
│       │   │   ├── containers.py     # 固定用户容器的启动/exec/停止
│       │   │   └── events.py         # Pi 事件到前端契约的转换
│       │   ├── storage/              # 数据库连接及数据持久化
│       │   ├── web.py                # FastAPI 原生 frontend 配置
│       │   └── web_dist/             # 构建时生成，Git 忽略
│       └── tests/
│           ├── unit/                 # RPC 解析、状态等纯逻辑
│           └── integration/          # 登录、归属、Pi/容器契约
├── deploy/
│   ├── pi.Dockerfile                 # 固定版本 Pi 执行镜像
│   ├── compose.yaml                 # 少量用户预配置执行容器
│   └── orchmesh.service              # 宿主 Web 服务示例
├── scripts/
│   └── build-web.sh                  # 构建 UI 并复制到 web_dist
└── docs/
    ├── architecture/
    │   ├── project-blueprint.md      # 本文：目录与技术清单
    │   └── v0.1-simplified.md        # 职责、数据与执行语义
    └── research/
        └── pi-capabilities.md        # Pi 能力证据与复用边界
```

小模块先用少量文件实现，复杂后再分 api/service/repository；不要求每个目录拥有同样的层数。前端组件测试就近存放为 `*.test.tsx`。浏览器验收使用 Codex 内置工具，操作清单见 `docs/development/browser-acceptance.md`。

## 三、首版技术栈

| 领域 | 选择 | 用途与边界 |
|---|---|---|
| 后端语言 | Python 3.12 | 平台业务与 Pi 进程管理 |
| Web | FastAPI + Uvicorn | API、静态页面、单进程应用生命周期 |
| 配置与校验 | Pydantic v2 + pydantic-settings | 请求模型和环境配置 |
| Python 依赖 | uv | 单 pyproject.toml、单 uv.lock |
| 数据 | SQLite + SQLAlchemy 2.x async + aiosqlite + Alembic | 用户、登录会话、聊天索引、执行摘要；短事务，不保存第二份消息历史 |
| 认证 | FastAPI Users + SQLAlchemy 适配器 | CookieTransport + DatabaseStrategy；维护模式下的窄范围采用，须通过兼容测试 |
| 密码 | pwdlib / Argon2 | 复用认证库密码管理，不自编密码算法 |
| CSRF | starlette-csrf（有条件采用） | signed double-submit；低发布频率，须验证当前框架兼容性 |
| 请求限流 | limits async MemoryStorage | 登录/写接口限流；单实例内存计数，不替代执行并发限制 |
| 前端 | React + TypeScript + Vite | 客户端交互、开发热更新、静态构建 |
| UI | Tailwind CSS + shadcn/ui | 现成基础组件，按需引入源码 |
| 聊天 UI | assistant-ui + ExternalStoreRuntime | Thread、Composer、ToolFallback；接自有状态和后端 |
| Markdown | assistant-ui MarkdownText；Shiki 按需 | 同一渲染体系，默认不叠 Streamdown，不启用不可信 HTML |
| 前端依赖 | npm | 单 package.json 与 package-lock.json，无需 workspace 管理器 |
| 服务端状态缓存 | TanStack Query | 用户信息、会话列表、历史快照及失效刷新 |
| 客户端共享状态 | Zustand | 当前聊天活动视图与共享 UI；assistant-ui 消费此状态 |
| 浏览器通信 | openapi-typescript + openapi-fetch；EventSource | REST 类型生成与客户端；GET SSE，Cookie 鉴权 |
| SSE 响应 | FastAPI 原生 EventSourceResponse | 使用具备 fastapi.sse 的版本；平台负责缓冲、心跳和恢复 |
| 外部工具通信 | Pi 内置 MCP：stdio / Streamable HTTP | 本地工具用 stdio；远程工具按服务器支持使用 Streamable HTTP |
| Agent | Pi coding agent | Loop、模型接入、压缩、工具、MCP、会话记录 |
| Python → Pi | 官方 JSONL RPC + asyncio 子进程 I/O | 不添加 TS HTTP 中转层 |
| Pi 环境 | Node.js + Docker | 完整 Pi 在每用户容器运行，文件/配置/历史独立 |
| 日志 | Python logging + 容器日志 | 有界、可轮转，避免记录密钥；先不搭完整观测平台 |
| 后端质量 | Ruff + Pyright + pytest + pytest-asyncio + httpx | 格式、类型、异步与接口测试 |
| 前端质量 | TypeScript + ESLint + Prettier | 类型、Lint、格式 |
| UI 验证 | Vitest + Testing Library；Codex 内置浏览器 | 必要的组件行为与登录/聊天关键路径 |

shadcn/ui 提供 Vite 安装路径。[官方文档](https://ui.shadcn.com/docs/installation/vite)

版本策略：项目已按最新稳定兼容版本安装并生成锁文件，具体版本和例外见[开发工具链](../development/toolchain.md)。Pi 执行镜像尚未构建；宿主个人 Pi 未升级。组件已安装不代表业务集成已验收。

## 四、暂不锁定或引入的依赖

- 认证选型：FastAPI Users 的 CookieTransport + DatabaseStrategy + SQLAlchemy 适配器，管理员通过 UserManager 建账号，仅开放必要登录/退出/当前用户接口。它处于维护模式，不再增加功能，作为首版边界清晰的依赖采用；不是活跃扩展的企业 IAM。starlette-csrf 低发布频率，作为须通过兼容与安全行为测试的 CSRF 候选，未通过前不开放 Cookie 写接口。详见认证调研。
- 聊天选 assistant-ui 的 ExternalStoreRuntime，复用 Thread/Composer/ToolFallback/MarkdownText；Pi 是唯一工具执行方。未实现编辑、重新生成、分支和审批的服务端语义时不启用这些 UI 回调。Streamdown 仅作为实际渲染验证不达标时的替代，不同时维护两套。
- 状态归属：Query 保存服务器快照；Zustand 根据历史快照和事件构建唯一的当前聊天活动视图；assistant-ui 只消费它。Query 不逐 token 更新，不新增独立聊天持久化。按 conversation/run ID 和稳定 message/toolCall ID 对齐，忽略过期事件；登出时清空缓存，不自动 persist 消息/凭据到 localStorage。局部状态仍用 React state。
- 不引入 Next.js、SSR、独立前端服务、Nginx、Redis、Taskiq、通用 Runtime 框架或 MCP 自研客户端。

## 五、运行数据不属于源码结构

数据根目录通过配置指定。部署时为不同用户分别挂载，平台数据库只给可信后端使用：

```text
<data-root>/
├── platform/
│   └── orchmesh.sqlite3
└── users/<server-generated-user-id>/
    ├── work/                        # 此用户所有聊天可操作的文件
    ├── pi-config/                   # 此用户 Pi 配置及必要凭据
    └── sessions/                    # Pi 原生 JSONL 历史
```

目录树本身不是安全机制；实际依赖容器挂载和权限。工作文件不是 public 静态资源。账号、会话元数据与 Pi JSONL 一并备份，但 Pi 不能访问平台数据库。

## 六、部署含义

第一版建议宿主专用账号运行一个 Uvicorn 应用进程，通过容器引擎管理预配置的用户 Pi 容器。Compose 组织执行环境，不额外创建前端 Web 服务。这个方案避免把容器管理 socket 再挂进一个公开应用容器；可信后端本身仍拥有其管理的用户容器的控制权。

因此，“一个 Web 应用部署”不等于“所有程序放进一个容器”。用户只访问一个地址；执行容器用于 Shell/文件隔离。部署实现前验证 rootless、挂载、网络和资源限制，不在此阶段修改系统配置。


## 七、通信与状态管理选型说明

Streamable HTTP 是 MCP 的标准传输方式，并非 SSE 的通用替代品；它自身也可使用 SSE。MCP 废弃的旧 HTTP+SSE transport 与浏览器接收聊天事件使用 SSE 是两回事。[MCP transport 规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)

三段连接分别选型：浏览器与 FastAPI 使用 HTTP 命令 + SSE；FastAPI 与 Pi 使用 Pi 原生 JSONL RPC；Pi 与远程 MCP 工具服务使用 Streamable HTTP，本地 MCP 子进程用 stdio。[Pi MCP 文档](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/mcp.md)

如果所谓 streamable HTTP 指通用 fetch 流式响应，它同样可行；当前选择独立 GET 订阅，是为了把任务提交和浏览器连接生命周期分开。EventSource 适合同源 Cookie，但不支持像 fetch 一样自定义 Authorization 请求头；将来采用 Bearer Token 时再评估 fetch SSE 客户端。任何传输都不自动提供业务级去重、状态恢复或持久事件重放。

TanStack Query 用来复用服务器状态的获取、缓存和刷新；Zustand 保存当前聊天活动视图；assistant-ui 的 ExternalStoreRuntime 消费该视图。它们不会自动解释 Pi 事件，仍需一个有明确归属和清理时机的聊天事件适配模块。[TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview)、[Zustand](https://github.com/pmndrs/zustand)


## 八、组件选型依据与验收边界

依赖与 CLI 后续已安装并锁定，完成工具启动、模块导入与基础前端托管检查，尚未验收业务集成。详细来源、候选比较和限制见：

- [认证组件](../research/auth-components.md)：维护模式、数据库 token、CSRF、路由开关与撤销语义。
- [聊天展示组件](../research/chat-components.md)：assistant-ui 外部状态适配、工具渲染、旧 AI Elements 迁移状态。
- [后端基础组件](../research/backend-components.md)：原生 SSE、async 数据库、限流、容器执行与 API 类型生成。

先完成一条真实接入链路的验收：登录 → 创建聊天 → Pi 工具执行 → UI 流式展示 → 停止 → 重连 → 退出/撤销。认证版本、CSRF 兼容、assistant-ui peer dependencies、长输出背压都必须在这一步验证，不能用文档支持替代运行验证。
