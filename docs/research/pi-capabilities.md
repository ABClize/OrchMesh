# Pi 能力核查与 OrchMesh 复用边界

> 历史调研资料（2026-10-26），保留当时的候选与验证范围，不作为当前部署或实现说明。当前选型、目录和验收请看 [项目结构](../architecture/project-blueprint.md) 与 [当前架构](../architecture/v0.1-simplified.md)。

核查日期：2026-10-26。范围：少量熟人、多用户聊天、保留 Shell 和文件操作；不实现企业多租户平台。

## 版本与证据

- 本机 `pi --version` 实测为 **1.3.0**；可执行文件解析到 `/home/rainpond/.nvm/versions/node/v24.21.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js`。读取其 `package.json` 与随包 `docs/`，未读取个人凭据、运行模型或更新软件。
- 官方仓库为 `earendil-works/pi`，当前 latest release 重定向到 **v1.4.0**。研究不等于已升级；实现前应固定选定版本并验证契约。[发布页](https://github.com/earendil-works/pi/releases/tag/v1.4.0)
- 官网明确列出 RPC、SDK、会话树、扩展、Skills，且已经内置 MCP；旧资料“Pi 没有 MCP”的结论已过时。[官网](https://pi.dev/)

## 可以直接复用

| 能力 | 已核实内容 | 平台仍需承担 |
| --- | --- | --- |
| Agent Loop | 模型调用、工具循环、上下文压缩、自动重试由 Pi 处理 | 用户归属、执行生命周期呈现、并发上限 |
| Shell 与文件 | 内置工具与扩展使用 Pi 进程的 OS 权限 | 用户执行环境隔离、目录与挂载分配 |
| 历史 | 默认保存 JSONL 会话树，可指定 session 路径恢复，支持 fork/clone | 会话属于哪个用户、标题与索引、备份 |
| 上下文 | 自动/手动压缩，恢复活动分支上下文 | 不另造一套摘要与上下文拼接逻辑 |
| 实时交互 | 消息增量、工具事件、取消、steer、follow-up | Web 传输、重连与错误展示 |
| 工具生态 | Skills、扩展、提示词模板；内置 MCP | 选择允许的资源，管理各用户独立配置 |

来源：[SDK](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/sdk.md)、[Sessions](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/sessions.md)、[RPC Commands](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/rpc-commands.md)。以上主要能力也存在于本机 1.3.0 随包文档。

## FastAPI 接入方式

官方将 **RPC** 定位为非 Node 语言的长驻子进程接口，并提供 Python 示例；使用 stdin/stdout JSONL，不需要为 FastAPI 额外搭建 TypeScript HTTP 微服务。若改用 Node/Bun 后端，官方建议进程内 TypeScript SDK。SDK 自定义能力更直接，但没有理由只为了包装 SDK 引入第三个应用服务。[RPC](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/rpc.md)

接入层必须实现：唯一命令 ID 与 response 关联、持续读取 stdout、stderr 单独采集、进程退出与期限处理。`prompt` 成功表示接受而非完成；`agent_end` 后仍可能自动继续，`agent_settled` 才表示进入稳定空闲；`disposition=handled` 不一定启动执行。按 LF 分帧，持续读取以避免输出背压阻塞进程。上述均是 RPC 官方契约。[RPC](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/rpc.md)

**并发建议（架构推论）：**一个活动会话对应一个 RPC 进程；初版每用户最多一个活动执行，拒绝重复发送或明确排队。不要把所有用户送入同一个活动 Pi 会话。依据是 SDK 的一个 `AgentSession` 拥有一段会话，RPC 新消息在忙时需要显式选择 `steer` / `followUp`。[SDK](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/sdk.md)、[RPC Commands](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/rpc-commands.md)

取消按钮如表示“停止并取消待处理输入”，要先 `clear_queue` 再 `abort`；仅 abort 时队列可能继续。`abort` 等待空闲才响应；显式 bash 命令另有 `abort_bash`。取消无法回滚已经发生的文件写入或外部副作用。[RPC Commands](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/rpc-commands.md)

## MCP 与配置复用

Pi 内置 MCP 支持 **stdio 和 streamable HTTP**，不支持旧 SSE transport。支持工具发现、资源、OAuth，以及 direct/deferred/codemode 等工具暴露策略。平台无需另写 MCP Client；先由管理员配置所需服务器，逐步增加 Web 配置界面。CLI 会加载内置 MCP，进程内 SDK 需要显式加入相关内置扩展并绑定。[MCP](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/mcp.md)、[SDK](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/sdk.md)

使用独立 `PI_CODING_AGENT_DIR` 和 `--session-dir` 可以分开用户配置与会话；显式 cwd 确定默认工作目录。项目配置和扩展受 project trust 影响，RPC 无交互信任提示，自动运行必须显式决定资源加载策略。`--approve` 是项目资源信任，不是每次工具调用批准。[环境变量](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/environment-variables.md)、[安全说明](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/security.md)

## 不能误认成 Pi 已解决的事情

1. **用户隔离**：cwd 与配置目录只是路径选择，不限制 Shell 访问其他可达路径。Pi、扩展与其子进程继承启动账户的权限。[安全说明](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/security.md)
2. **自动安全审批**：Pi 没有每次工具调用都弹出审批的默认保证。可用扩展实现工具事件拦截，不能把它当 OS 隔离。[安全说明](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/security.md)
3. **持久工作流**：会话恢复意味着重建已保存上下文，不代表恢复运行中的 shell 进程、任意工具检查点或避免副作用重复。官方 RPC 要求宿主处理进程异常退出。初版建议标记 interrupted，用户检查后继续，避免整轮自动重放。[Sessions](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/sessions.md)、[RPC](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/rpc.md)
4. **Web 断线重连**：Pi 输出流不是带平台 cursor 的 Web 事件存储。平台需要自己的有限缓冲与快照重同步策略；不必因此建设完整 Event Bus。
5. **保密凭据**：传入容器的环境变量、凭据文件仍可能被 Shell 读取。容器解决宿主暴露范围，不会让容器内的模型密钥对 Agent 隐形。[容器化说明](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/containerization.md)

## 简化建议与验证清单

建议用完整 Pi 进程的每用户容器边界，挂载该用户工作目录和独立 Pi 状态卷；不共享宿主个人 `~/.pi/agent`，不向 Agent 容器暴露 Docker socket、平台数据库或其他用户目录。官方给出了 plain Docker、Docker Sandboxes、OpenShell 等集成路径；小规模初版优先评估 plain Docker，无须自建沙箱实现。[容器化说明](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/containerization.md)

平台只补登录/归属校验、会话索引、RPC 生命周期、Web 事件桥、有限并发和容器资源限制。初版可由一个 API 实例拥有这些内存态管理器；API 重启按执行中断处理，水平扩容与跨实例调度以后再做。这是基于小规模需求的建议，不是 Pi 原生保证。

进入实现前应做一次小型验证：固定 Pi 版本；两用户互相不可读；模型文本与工具增量；取消和取消排队；浏览器断线后重连；Pi 退出后恢复已有会话；长输出背压；MCP 配置加载；进程退出后 Shell 子进程清理。本轮只有文档与本机安装核查，**未执行模型、容器、RPC 端到端或故障注入测试**。
