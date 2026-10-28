# OrchMesh

**A workspace for agents. A network for collaboration.**

OrchMesh 是一个开源、自托管的多用户智能体平台。通过自然语言澄清需求、生成可编辑草稿，试运行后由用户确认发布。其他用户可以使用和评论已发布智能体；Agent 可以发现协作者并通过 A2A 委派任务。

长期助手依靠保存的聊天和个人记忆延续上下文。只有任务需要代码或文件操作时才分配临时 Docker 环境，不再为每个用户维护常驻 Shell 和 DSH Host。

## 当前能力

- **创建与发布**：需求问答、草稿编辑、工具与知识选择、试运行、显式确认发布。每次发布产生不可变版本，执行中的任务保持原版本。
- **Skills**：管理员通过 skills CLI 来源导入或上传 SKILL.md/ZIP 包，查看和编辑资源；智能体草稿显式绑定不可变快照。DSH 负责按需加载，任务恢复仍使用原快照，脚本资源只读挂载。普通 Agent 不提供库管理工具。
- **自动协作**：使用官方 A2A 客户端和服务端，记录父子任务、共享根任务内的分工信息，以工作标识复用重复委派，拒绝循环等待。
- **持久执行**：DBOS 管受理、等待与重启接管；DSH 管模型循环、JSONL、检查点和可继续提问。页面关闭不会取消任务，服务重新启动后接管未完成任务。
- **按需执行**：官方 DSH SSH 文件、Shell、搜索和交付工具运行在任务容器中；容器释放后保留工作文件、会话与交付快照。
- **聊天与知识**：聊天列表、置顶、归档、思考设置、个人记忆编辑/停用，以及文本/Markdown 知识导入、PostgreSQL 检索和发布版本快照。
- **任务材料**：进入对话后上传文件，后续任务通过临时环境读取当前对话的副本；不跨账号共享。
- **文件交付**：官方 `present` 结果显示为可预览、下载的卡片；新交付保存不可变快照，旧卡片保留原目录引用。支持 Markdown、文本、图片、PDF、自包含 HTML；下载上限 20 MiB，文本预览 1 MiB。
- **界面**：保留左右可调整宽度的工作台，优先复用 Affect UI、shadcn 和 assistant-ui。

迁移仍在验收中，完整范围与剩余门槛见[迁移验收](docs/development/platform-acceptance.md)。旧项目登记仅作为历史文件绑定保留，不继续提供长期项目执行环境。

## 快速开始

需要 Linux、Python 3.12、uv、Node.js 24、npm、Docker Compose 和 OpenSSH 客户端。

```bash
make setup
```

编辑根目录 `.env`：

```dotenv
ORCHMESH_PORT=8000
ORCHMESH_BOOTSTRAP_ADMIN_EMAIL=you@example.com
ORCHMESH_BOOTSTRAP_ADMIN_PASSWORD='use-a-unique-long-password'
ORCHMESH_MODEL_BASE_URL=https://your-provider.example/v1
ORCHMESH_MODEL_API_KEY='your-model-key'
ORCHMESH_MODEL_ID=your-model-id
```

地址填写模型 API 基址，不包含 `/chat/completions`。`ORCHMESH_MODEL_API` 可省略，默认 `openai-completions`；其他协议必须明确配置。含 `#` 或空格的值加引号。管理员账号密码只用于首次创建；直接修改环境变量后需重启；日常可在管理员侧栏「模型设置」添加、编辑和测试模型，保存即时生效。平台统一使用部署方模型凭据，不将凭据交给用户或执行容器。

`make setup` 自动生成本地 PostgreSQL 密码。数据库默认只监听 `127.0.0.1:5433`；外部 PostgreSQL 使用 `ORCHMESH_DATABASE_URL`。不要在数据库初始化后单独改密码变量而不更新数据库角色。

```bash
make run
```

访问 **http://127.0.0.1:8000**。开发时用 `make dev`，默认 Vite 地址为 `http://127.0.0.1:5173`。

| 命令 | 用途 |
| --- | --- |
| `make setup` | 安装锁定依赖、启动数据库、构建沙盒镜像 |
| `make run` | 构建页面、迁移数据库并启动服务 |
| `make dev` | 数据库迁移及前后端热更新 |
| `make check` | Lint、类型、格式及 API 合约检查 |
| `make test` | 构建与确定性测试 |

Ctrl+C 停止应用，未完成任务在应用再次启动后恢复；数据库独立运行，用 `docker compose stop db` 停止。恢复不等于自动拉起应用进程，长期部署需配置服务管理器。

## 旧数据迁移

先停止旧服务，备份 `.data/`、`.env` 和 JWT 密钥。保留旧 SQLite 与用户目录，准备 PostgreSQL 后执行：

```bash
uv run --directory apps/server alembic upgrade head
uv run --directory apps/server orchmesh import-legacy
```

导入以只读方式读取 SQLite，使用官方 DSH cold reader 获取历史；在单个事务中保留账号 ID、密码散列、对话 ID 和目录绑定。目标应为未初始化账号的空业务库。发现冲突会中止，不覆盖新数据。旧会话只读，点击继续可创建带原历史和文件引用的分支。不要删除旧用户目录。

## 模型、网页与邀请

管理员「模型设置」支持模型名称、API 地址、密钥、接口协议、默认模型和 DSH 能力目录。密钥不回显，编辑时留空保持原值；测试连接发送独立短请求，不携带对话历史。页面保存后输入框模型列表同步更新，配置保存在仅服务账户可读写的 `.data/platform-models.json`，优先于环境变量，重启后保留。

思考能力优先读取 DSH 内置模型目录；高级选项可覆盖兼容网关的差异。仍使用环境变量配置时：

```dotenv
ORCHMESH_MODEL_REASONING_EFFORTS='{"off":null,"high":"high"}'
ORCHMESH_MODEL_THINKING_FORMAT=deepseek
```

网页读取复用官方 `dsh-tool-web` 和 HTTP provider。可选原生搜索需单独配置 `ORCHMESH_SEARCH_API_KEY`、`ORCHMESH_SEARCH_BASE_URL`、`ORCHMESH_SEARCH_MODEL`；未配置时不提供搜索工具。搜索端点必须支持 DeepSeek 原生搜索，普通兼容聊天端点不一定支持。当前按用户选择关闭搜索。

本机使用合成 DNS 地址的代理时，可配置 `ORCHMESH_HTTP_PROXY`，DSH 官方代理接口负责请求路由；不要通过关闭 URL 检查解决网络问题。`ORCHMESH_NO_PROXY` 控制直连目标，默认包含本机地址。

平台不开放自助注册。邀请账号：

```bash
uv run --directory apps/server orchmesh create-user friend@example.com
```

## Skills 与默认提示词

侧栏「Skill 库」提供在线导入、上传、文件查看/编辑、来源更新、替换包和停用新绑定。在线导入使用锁定的 skills CLI（1.7.4）；上传上限 10 MiB，解压后上限 25 MiB、1000 个文件，拒绝路径越界和符号链接。DSH 官方解析器与 Skill 工具负责元数据、调用策略和加载，不扫描执行目录里的未绑定 Skills。

在「智能体库 → 编辑草稿」选择 Skill 快照；库更新不会自动升级已有绑定。试运行通过后再发布。内容和资源保存在 PostgreSQL，不可变版本与任务引用同一快照；恢复时重新装配原内容。任务容器中的 `/skills` 只读，脚本输出应写到 `/workspace`。导入不自动安装脚本依赖；其他 Harness 的 hooks、fork 等配置会提示未映射。纯文本指令无需执行容器，文件与脚本仍需要相应执行能力。

Builder 继承当前用户权限：可查询并给自己的草稿绑定现有 Skill，只有管理员身份可通过管理工具导入和编辑库。普通执行 Agent 没有管理工具；本轮不额外限制 bash 与网络，不能把这项权限边界理解成禁止所有下载。

四份代码默认提示词在 `apps/server/src/orchmesh/prompts/`：`assistant.md`、`builder.md`、`platform.md`、`continuation.md`。管理员保存的覆盖仍优先，升级代码不会覆盖自定义内容；「恢复默认」读取上述文件。调用详情的「最终提示词」显示实际模型请求的分段来源、绑定 Skill 快照及已加载内容。

## 数据与部署边界

面向自己及少量可信用户。JWT 认证和所有权校验隔离账号；执行容器只挂载当前任务工作目录，不挂载账户资料、模型密钥或 Docker socket。官方网页抓取保留其公网目标校验；任务容器的网络出口尚未进一步隔离，不能作为公开的恶意代码托管平台。

重启恢复不是任意外部副作用的 exactly-once 保证。官方 DSH 对中断工具修复历史，Agent 检查已保存文件后继续；无法判断的外部操作不能宣称“未发生”。具体故障验收见[报告](docs/development/platform-acceptance.md)。

备份应同时覆盖 PostgreSQL、`.data/tasks/`、`.data/inputs/`、旧 `.data/users/` 和 JWT 密钥。日常日志见[日志说明](docs/development/logging.md)，架构见[智能体平台设计](docs/architecture/agent-platform-v1.md)。

多智能体观测的后端接口及前端接入契约见 [多智能体观测接口](docs/api/multi-agent-observation.md)：调用图、子任务详情、实时 SSE 和官方日志回放。

管理员可在侧栏「提示词设置」编辑内置 OrchMesh、Agent Builder、平台公共指令和任务恢复提示，或恢复默认后保存。配置仅保留当前值，存于 `.data/platform-prompts.json`；新任务读取设置，已接收任务使用冻结快照。提示词不会更改后端工具权限或发布确认规则。

在「协作 → 调用详情 → 最终提示词」只读查看自己任务最近一次 DSH 模型请求的系统分段、来源、完整系统消息、动态上下文、实际恢复消息和工具定义。记录来自 DSH 官方组装/请求事件，保存在任务私有目录，不是当前设置的推算预览；旧任务无记录时明确显示缺失，不补造历史。查看入口仅管理员可用，不包含供应商内部追加内容。
