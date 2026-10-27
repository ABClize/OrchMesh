# 按任务沙盒与现有代码复用审查

日期：2026-10-27。状态：研究建议，尚未实施或完成运行验证。

范围：把持久聊天/智能体状态与临时代码执行环境拆开，优先复用 DSH 公开能力。核查基线为 OrchMesh `75e1576`、锁定 npm `0.2.1-rc.3`，官方源码 `22ddee3792402c3e70ec5f86a63c3e3e895a2f60`。没有升级依赖、改动运行配置、创建沙盒或调用真实模型。

## 结论

“长期助手”不要求一个长期运行的用户容器。会话、智能体定义、个人记忆、附件与产物可以持久保存；执行进程和代码沙盒使用独立生命周期。但是，当前实现把导航、会话读取、Agent Loop 和 Shell 都放在同一个用户 Host 中，不能只把容器名称从 user 改成 task 就完成拆分。

DSH 已有完整的 **SSH 执行提供方**，可让 Harness、模型调用和 Session 存储留在服务侧，而文件和子进程运行在远端。没有在此次核查的包目录/README 中找到官方 `fs-docker`、`subprocess-docker`、E2B 或 Daytona 提供方；“有可替换接口”不等于“这些集成已经实现”。[官方 SSH 组件族](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/ssh/README.md)

## 官方能力与实际边界

| 能力 | 核查结果 | 对本项目的含义 |
| --- | --- | --- |
| `ctx.fs` | 公开 FileSystem 服务；文件工具与存储提供方分离 | 可保留官方读写/编辑工具，不必重写工具 schema |
| `ctx.subprocess`、`ctx.shell` | 子进程与 Shell 服务分离；Bash 执行器使用 subprocess | 远程执行必须覆盖 subprocess，不能只拦截 bash 工具 |
| `dsh-ssh` | OpenSSH 连接、验证 helper、租约及连接清理 | 传输和远端进程清理由官方承担；沙盒创建/分配仍由平台承担 |
| `dsh-fs-ssh` | 远端文件身份、读取、原子修改及版本检查 | 与远端 Shell 使用同一文件世界；远端路径不能当成本机路径 |
| `dsh-subprocess-ssh` | 远端 executable lookup、spawn、PTY、进程范围终止 | 可复用流式输出、取消、后台作业相关语义 |
| `dsh-sandbox-ssh` | 在远端调用当地 sandbox provider | SSH 是传输；隔离仍由远端容器或当地沙盒实施 |
| `fs-sandbox` | 官方明确写入限制，读取不限制 | 不能独自作为用户间文件读取隔离方案 |

来源：[文件服务](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/fs/fs/README.md)、[子进程服务](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/subprocess/subprocess/README.md)、[Shell 服务](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/shell/shell/README.md)、[fs-sandbox](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/fs/fs-sandbox/README.md)。

本次直接查询 npm 元数据，`dsh-ssh`、`dsh-fs-ssh`、`dsh-subprocess-ssh`、`dsh-sandbox-ssh` 的 `0.2.1-rc.3` 均存在。`dsh-ssh-helper-runtime` 是私有构建载体，不是 npm 可安装 CLI；它产出独立可执行归档，也可部署官方 helper 脚本及匹配依赖。没有验证对应版本的 GitHub 二进制归档是否已经发布。[helper 构建与部署](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/ssh/ssh-helper-runtime/README.md)

### SSH 不是零配置 Docker 适配器

- 需要预先提供 SSH alias、认证、known-host 和允许 Unix socket 转发的 SSH 服务，客户端要求严格 host-key 检查并禁止交互式认证；平台不能把模型给出的地址/用户名直接作为连接配置。
- helper 需部署在工作目录和可写临时目录之外，并核验摘要。平台可以将它预装到任务 Docker 镜像中，但容器启动、连接地址和密钥生命周期、配额、到期回收仍需要平台管理。
- 官方不自动供给远端、不自动重连、不重放可能已经执行的命令。连接丢失时远端租约会发起清理，但客户端不能把“不知道结果”宣称成“已成功停止”。
- `fs-ssh` 不提供 watch；单次整段文本/字节窗口有 8 MiB 限制，可流式或分窗口读取。现有网页预览可继续主动读取，不能假设原来的目录监听自动可用。

来源：[SSH 连接](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/ssh/ssh/README.md)、[远端文件](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/ssh/fs-ssh/README.md)、[远端进程](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/ssh/subprocess-ssh/README.md)。

### 需要一并审查的执行入口

1. `tool-fs-search` 的 grep/glob 调用 `ctx.subprocess.spawn`，且 argv 使用本地解析的随包 ripgrep 路径；不能只替换 fs 就宣称搜索在远端可用。应验证目标镜像中的同路径制品或另选受控搜索入口，失败时不得退回宿主运行。
2. PTC Node worker 需要显式远端启动制品；官方 SSH 提供 `ctx.ssh.ptcLaunch`。所有插件的 Node/浏览器/LSP/终端/MCP stdio 执行路径都需要逐项审核。
3. 默认 `sdk` 继承 coding 工具；`sdk-minimal` 仍含持久 Shell，且使用 danger-full-access。它们都不能直接作为“无代码执行的聊天运行时”。应组合明确的工具白名单，拒绝把未审查插件随用户发布内容加载进服务进程。
4. 官方 Workspace Registry 仍有直接 `node:fs` 目录检查；官方文档也明确 Web 工作区不是自动 remote-aware。发布平台的逻辑项目/智能体目录不应继续借用“本机 cwd 即项目”的定义。

来源：[搜索实现](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/fs/tool-fs-search/src/search-core.ts)、[SSH 执行坐标](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/docs/subsystems/ssh.md)、[sdk-minimal](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/bundle/sdk-minimal/README.md)、[Workspace 实现](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/workspace/workspace/src/index.ts)。

## 首版最小方案：按产品语义选择，不先造通用沙盒框架

**若代码执行可以是一次独立的代码任务：优先复用现有完整 DSH 运行容器，改为按代码任务分配。** 普通聊天/智能体选择/记忆读取不申请代码容器；执行入口仅接受平台签发的任务配置和授权文件。代码任务内继续使用官方本地文件、Shell、作业、审批和 Session 能力，它们的“本地”在容器内。任务结束先保存产物、flush 历史，再释放环境。无需先实现远端 FileSystem 或 SSH 服务。

这个方案需要一个明确的“委派代码任务”边界，不能假装直接继承原父 Agent 的所有状态。官方 `subagents.registerProvider` 可承载外部执行，但 Docker 创建/销毁适配仍需项目代码。官方 `subagent-dsh-sdk` 是一次性子运行，会返回最终文本，且中间工具流留在子进程；其 `dshBin` 是 CLI 模块文件，并不是任意 Docker 命令参数。不能通过 SDK 私有构造参数塞入 Docker 启动器，不能承诺其现成插件已处理容器及完整子任务面板。[外部 DSH 子任务](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/subagent/subagent-dsh-sdk/README.md)

**若同一个 Agent 必须直接连续调用远端原生文件/Shell 工具：优先验证官方 SSH 提供方组合。** 平台创建任务容器并准备 helper；任务级 composition 配套接入 fs/subprocess/sandbox SSH 提供方；官方工具照常工作。还需验证按需创建 composition 的时机，不能假设 eager SSH 初始化支持“第一次工具调用才连接”。会话/记忆在可信服务存储，不能挂到不可信代码环境中。

外部沙盒也可后续替换：例如 E2B 官方 SDK 已有按需创建与命令运行接口，但这不是 DSH 官方 provider，接入 DSH 的原子编辑、取消、输出流及路径语义仍需适配。本轮不比较供应商价格/性能，不据文档推断已完成集成。[E2B 官方文档](https://docs.e2b.dev/)

Docker 的容器、挂载、非 root、资源上限等继续使用官方机制。没有必要仅因改成任务生命周期就引入完整集群管理系统；也不能把普通 Docker 等同于敌对代码的完整安全保证。[Docker 运行与资源控制](https://docs.docker.com/engine/containers/run/)

## 现有文件如何处理

| 文件/模块 | 建议 |
| --- | --- |
| `auth.py`、`main.py` | 保留账号/JWT；移除登录和 `/api/me` 预热执行容器的耦合 |
| `storage.py` | 保留账号、会话与历史运行行；新增智能体定义/发布版本/任务/产物模型另行设计，不删除旧绑定 |
| `dsh/manager.py` | 保留事件转换、SSE、状态处理思路；把用户 Host 池拆成聊天运行与任务沙盒租约，配额不再等同于用户数 |
| `dsh/containers.py` | 保留 Docker 隔离参数/可靠删除；容器标识、挂载、回收对象改为任务租约；停止默认挂载整棵用户项目树 |
| `apps/runtime/launch.mjs` | 拆分无代码聊天 profile 和执行 profile；不要把现有 danger-full-access SDK 直接搬到宿主进程 |
| `bridge.mjs`、`interactions.mjs` | 复用 Controller/公开等待、审批/提问/队列；重新核对 Session 所有者，避免再次混用 SDK 与 Controller 内部注册表 |
| `dsh/events.py`、`messages.py`、聊天 UI | 尽量保留；执行来源和交付引用转换集中在适配层 |
| `projects.py`、`dsh/navigation.py` | 逻辑导航与物理目录分离；保留旧目录所有权记录，不能直接把旧项目行重命名成智能体 |
| `workspace.py` | 保留鉴权、O_NOFOLLOW、文件类型/大小校验、Range 下载；新产物定位改为受鉴权的 artifact ID |
| `features/workspace/files.ts` | 旧卡片继续解析原目录绑定；新卡片按产物 ID 读取，不再用当前界面项目推断任意沙盒绝对路径 |
| `deploy/dsh.Dockerfile` | 完整 DSH 任务容器方案可复用；SSH 方案需另有包含 helper 的任务镜像，不向任务暴露 Docker socket |

## 文件位置与迁移约束

- 原 `.data/users/<user>/work`、`projects/<id>/work`、`dsh`、`config` 保留原位。现有 `Conversation.directory_id` 和 Project 所有权行不删除；即使不再显示旧项目，也保留下载定位。
- 原卡片包括 `/workspace`、`/workspaces/<id>`、`/project-workspaces/<id>/work` 等运行时路径。它们只应通过原会话绑定转换；不可把新临时沙盒的同名路径直接指向别的用户/任务目录。
- 新任务使用唯一 task/lease 标识，输入文件按明确授权清单复制或只读挂载，输出先进入任务暂存目录；受控提交后成为持久产物。容器回收不删除已提交产物，不把整个用户历史/凭据目录放进代码环境。
- 远程沙盒文件下载需经提供方读取或复制到持久存储，不能对远程字符串调用本机 `FileResponse`。若仍用本机受控文件目录存储产物，可继续复用现有文件响应安全代码。
- “停止任务”“释放执行租约”“删除产物”“归档会话”必须分开。失败后自动重试会重复副作用，应保留当前不重放未知结果的约束。

## 实施前验证门槛

1. 未触发代码工具的登录、聊天、历史、记忆读取不创建用户/任务 Docker；聊天 profile 的模型可见工具中没有宿主 Shell/文件写入/任意插件安装路径。
2. 两个任务各自的 Shell、读写、搜索和 present 看到同一授权目录，但不能读取另一任务、平台数据库或模型凭据。
3. 新建/停止/断线/超时清理使用官方生命周期，孤儿进程可确认清除；无法确认时标记结果未知而非自动重跑。
4. 回收后聊天历史、旧文件链接及已提交的新产物仍可用；原账号和文件校验不变。
5. 若采用 SSH，额外验证真实已发布包、helper 摘要、ripgrep/PTC 路径、后台进程终止与传输中断，不以源码声明代替运行验收。

本轮只完成源码、文档和包发布存在性核查；上述两种组合均未在 OrchMesh 实装验证。
