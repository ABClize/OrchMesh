# 前端官方 CLI 与配套 Skills 核查

> 历史调研资料（2026-10-26），保留当时的候选与验证范围，不作为当前部署或实现说明。当前选型、目录和验收请看 [项目结构](../architecture/project-blueprint.md) 与 [当前架构](../architecture/v0.1-simplified.md)。

核查日期：2026-10-26。仅查询官方文档、维护者仓库、npm registry，并读取技能源文件；本报告没有安装 CLI、技能或应用依赖。

## 最新稳定发布快照

下表来自 npm 官方 registry 的 `dist-tags.latest`，同时核对 repository 字段。没有选择 beta、canary、rc、next。执行安装时应重新查询并记录解析版本。

| npm 包 | latest | 官方归属 |
|---|---|---|
| `shadcn` | 4.22.1 | shadcn-ui/ui，packages/shadcn |
| `assistant-ui`（CLI） | 0.0.126 | assistant-ui/assistant-ui，packages/cli |
| `create-vite` | 9.3.1 | vitejs/vite，packages/create-vite |
| `vite` | 8.3.5 | vitejs/vite，packages/vite |
| `@playwright/cli` | 0.1.22 | microsoft/playwright-cli |
| `@playwright/test` | 1.64.1 | microsoft/playwright |

可复核命令：`npm view <package> dist-tags engines repository --json`。资料源：[shadcn registry](https://registry.npmjs.org/shadcn/latest)、[assistant-ui registry](https://registry.npmjs.org/assistant-ui/latest)、[create-vite registry](https://registry.npmjs.org/create-vite/latest)、[Vite registry](https://registry.npmjs.org/vite/latest)、[Playwright CLI registry](https://registry.npmjs.org/@playwright%2fcli/latest)、[Playwright Test registry](https://registry.npmjs.org/@playwright%2ftest/latest)。CLI 与运行时库版本号不可混用。

## 官方 CLI 与建议使用方式

### Vite / React

官方入口为 `create-vite`，模板支持 `react-ts`。建议从仓库根目录创建既定前端工程：

```bash
npm create vite@latest apps/web -- --template react-ts
```

它会创建应用文件，不能用来仅安装工具或覆盖既有目录。Vite CLI 随项目依赖使用，不需要全局安装；开发、构建使用生成的 npm scripts。官方文档要求 Node 20.19+ 或 22.12+，具体模板仍需检查更高要求。[Vite 官方入门](https://vite.dev/guide/)、[官方模板列表](https://github.com/vitejs/vite/tree/main/packages/create-vite)

在 Vite 官方仓库树内未发现可安装的 `SKILL.md`；本次未找到 Vite/React 维护者发布的对应通用技能，因此不把社区同名技能标成官方，也不为凑齐名单安装。

### shadcn/ui

官方 CLI `shadcn` 可一次性通过 npx 调用；安装组件必须在 `apps/web` 执行，避免改错工程：

```bash
npx shadcn@latest init --template vite
npx shadcn@latest info --json
npx shadcn@latest docs button dialog
npx shadcn@latest add button dialog
```

这里 `init` 是源码/依赖变更，`info` 和 `docs` 用于检查。Base UI/Radix、preset 等应按已选组件兼容性设置，不能把 CLI 默认的 Next 模板当成本项目选择。[官方 CLI](https://ui.shadcn.com/docs/cli)

### assistant-ui

已有 Vite/shadcn 工程后，用组件增量安装方式，避免 `create` 自动生成另一套带模型后端的应用：

```bash
npx assistant-ui@latest add thread thread-list
npx assistant-ui@latest add shiki-highlighter
npx assistant-ui@latest info
npx assistant-ui@latest doctor
```

`init` 适合尚未配置 shadcn 的已有 package 项目，但官方文档说明已有 `components.json` 时可能直接提示退出；采用 Vite → shadcn → assistant-ui add 的顺序更明确。`add thread` 会安装相关 registry 依赖，依赖闭包应由 CLI 处理，而非手工拷贝上游源码。最终仍需配置我们的 ExternalStoreRuntime，CLI 不会自动完成 Pi/FastAPI 接线。[官方 CLI](https://www.assistant-ui.com/docs/cli)、[官方 elements skill](https://github.com/assistant-ui/skills/blob/main/assistant-ui/skills/elements/SKILL.md)

不运行 `assistant-ui agent`（它会启动 Claude Code），也不采用文档中针对云登录的临时 prerelease tarball。它们与本项目稳定、本地 FastAPI 方案无关。

### Playwright

Playwright Test 是项目测试依赖，Playwright CLI 是给 agent 操作浏览器的工具，职责不同。官方支持全局 CLI 或项目内调用：

```bash
# 单独的 agent 浏览器 CLI；若需全局可执行命令
npm install -g @playwright/cli@latest
playwright-cli --help

# 项目测试依赖；在 apps/web 内执行
npm install -D @playwright/test@latest
npx --no-install playwright --version
npx playwright cli --help
```

已有本地 Playwright 时不必重复安装全局 CLI。安装测试包不等于下载浏览器；后续根据要跑的浏览器使用官方 install 命令。本报告不下载浏览器、不启动测试。[官方 CLI 安装](https://playwright.dev/agent-cli/installation)、[官方 coding agent 文档](https://playwright.dev/docs/getting-started-cli)

## 对应官方 Skills

| 来源 | 精确 skill name | 已核对适用范围 |
|---|---|---|
| `shadcn-ui/ui` | `shadcn` | 按 components.json 查组件、调用官方 CLI、组合现成组件 |
| `assistant-ui/skills` | `assistant-ui` | 总入口及架构路由 |
| 同上 | `setup` | CLI 与接入方式 |
| 同上 | `runtime` | 外部状态、消息/运行状态契约 |
| 同上 | `elements` | 安装与定制复制式组件 |
| 同上 | `markdown` | Markdown、Shiki、可选 Streamdown |
| `microsoft/playwright-cli` | `playwright-cli` | agent 浏览器操作及测试参考 |

上述是维护者自有仓库，不是第三方“best practices”集合。已经读取对应技能内容；没有把 beta/实验技能目录列为候选。注意“main 分支的正式技能文件”不等于有独立稳定发行版本：技能包含个别实验 API 的介绍时，项目仍只使用稳定部分。

来源：[shadcn 官方 Skills](https://ui.shadcn.com/docs/skills)、[shadcn SKILL.md](https://github.com/shadcn-ui/ui/blob/main/skills/shadcn/SKILL.md)、[assistant-ui 官方 Skills](https://www.assistant-ui.com/docs/llm)、[assistant-ui 技能仓库](https://github.com/assistant-ui/skills)、[Playwright 官方 skill](https://github.com/microsoft/playwright-cli/blob/main/skills/playwright-cli/SKILL.md)。

## 通过 Skills CLI 安装的精确候选命令

所有技能安装保持使用 `npx skills`，不手工写入受管理目录。默认安装到本项目，目标 Codex；若用户指定全局，再加 `-g`。先检查同名 `setup`、`runtime`、`markdown` 等是否已有其他来源，避免覆盖。

```bash
npx skills add shadcn-ui/ui --list
npx skills add assistant-ui/skills --list
npx skills add microsoft/playwright-cli --list

npx skills add shadcn-ui/ui --skill shadcn -a codex -y
npx skills add assistant-ui/skills --skill assistant-ui --skill setup --skill runtime --skill elements --skill markdown -a codex -y
npx skills add microsoft/playwright-cli --skill playwright-cli -a codex -y

npx skills list -a codex
```

以上来源路径和 name 来自实际 GitHub tree 与 SKILL frontmatter；`--list`、`--skill`、`-a codex`、`-y` 为 Skills CLI 官方参数。[Skills CLI reference](https://github.com/vercel-labs/skills/blob/main/docs/commands.md)

本次未实际运行技能安装，安装成功与最终落盘版本必须由执行方另行核验。Playwright 文档也提供 `playwright-cli install --skills=agents`，但这里统一使用 Skills CLI 来满足项目技能生命周期管理方式，不混用两种安装器。

## 适用范围与冲突处理

- shadcn skill 最新内容会推荐自己的 MessageScroller/Trace 等聊天组件；本项目已经选择 assistant-ui，通用组件按 shadcn，聊天线程按 assistant-ui，不能因此把已选聊天运行时再替换一遍。
- assistant-ui 技能示例经常使用 AI SDK/cloud，不意味着 OrchMesh 要安装对应执行层；保留 FastAPI + Pi 原生执行和自有会话。
- 不安装 `cloud`、`react-native`、`ink`、`react-mcp` 等当前无需要的技能；MCP 工具执行在 Pi，不在浏览器再建客户端。
- 不运行 `skills experimental_sync`，它在官方命令文档中明确列入实验功能。
- 技能当前提到 Pi adapter 是值得另外验证的复用线索，不能仅凭技能描述就宣称已兼容现有 HTTP/SSE 设计。
