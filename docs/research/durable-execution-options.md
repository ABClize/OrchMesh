# 持久执行组件选型：DBOS Python 与 Temporal Python

核查日期：2026-10-27。范围：官方最新文档、官方仓库及 PyPI；未安装组件、运行候选或修改应用、依赖、服务与数据。本文是选型建议，不是集成验收。

## 建议

**首版优先验证 DBOS Python，使用官方持久队列及工作流恢复；正式部署采用 Postgres system database。** 目前单 API 实例、少量用户、FastAPI 为业务入口，嵌入式库比新增完整 Temporal Service 更贴合。技术上可保留现有 SQLite；进一步核查官方原子入队接口后，更推荐将平台元数据迁入同一 Postgres database 的独立业务 schema，原 SQLite 保留备份，以直接获得 Task 创建与入队的原子事务。此为待批准/实施的设计建议，并未迁移数据。DBOS 支持 SQLite，但官方将其定位为原型/测试的方便选择，生产推荐 Postgres。[数据库支持](https://docs.dbos.dev/python/tutorials/database-connection)、[架构](https://docs.dbos.dev/architecture)。

这里的 workflow 是后端执行机制，不是恢复已取消的“用户预编排”产品功能。DSH 继续负责模型循环、工具、inbox、Session 与本地子智能体；DBOS 负责业务任务的持久入口、等待与进程重启后的再次接管。**不要将全部 DSH 工具逐个重新包装成另一套 Agent Loop，也不要把整个 Agent 从头运行当作恢复。** DSH 已实测的恢复边界见[断进程报告](dsh-restart-experiments.md)。

核查时 PyPI 发布版本为 [`dbos 3.3.0`](https://pypi.org/project/dbos/) 与 [`temporalio 1.34.0`](https://pypi.org/project/temporalio/)，均要求 Python >=3.10。项目尚未锁定这两个包。DBOS 3.x 已调整队列与 FastAPI 接入方式，应按当前文档接入，不能复制旧版 `DBOS(fastapi=app)` 示例。[3.0 迁移说明](https://docs.dbos.dev/python/upgrading)。

## 对比

| 需求 | DBOS Python | Temporal Python |
| --- | --- | --- |
| 持久流程与恢复 | workflow 重入时读取已完成 step 的持久结果，执行尚未完成的 step；单机进程重新启动自动恢复 PENDING | Service 保存事件历史，Worker 重放确定性 Workflow；已记录 Activity 结果复用，未完成 Activity 依策略再次执行 |
| 队列与并发 | 内建数据库持久队列，可由多个执行者消费；支持队列并发配置和重复入队处理 | Service 自带 Task Queue，Worker 拉取任务；支持独立扩展 Workflow/Activity Workers |
| 接管边界 | 单机自动恢复；分布式需要 executor 身份与恢复协调，官方建议 Conductor。内建所有权 token 防旧执行者提交检查点，但不强杀已经发出的外部操作 | Service 调度与超时重试承担分布式接管。Activity 超时并不保证旧 Worker 的外部操作已停止，仍可能并行产生效果 |
| `task_id` 防重复 | 固定 workflow ID，重复 enqueue 可返回现有 handle；队列 deduplication ID 可表达进行中工作的去重 | 固定 Workflow ID，并明确运行中 conflict policy 与已完成 reuse policy；不能只依赖默认值或把业务去重等同于历史保留期内的执行去重 |
| 等待用户输入 | `send/recv` 持久消息，events 可供客户端观察；async API 适合长等待 | Signal、Update、Query 与 `wait_condition`；Signal/Update 可唤醒业务状态机，Query 仅观察 |
| 动态子任务 | workflow 可按已记录输入/step结果创建子 workflow 并收集结果 | 动态 Child Workflow、父关闭策略及取消语义成熟 |
| 动态 Agent 规划 | 非确定性 DSH 调用留在 step，已决定的委派要有稳定任务标识。step 内不能直接 start/enqueue DBOS workflow；需把委派意图返回 workflow 或经外部幂等入口处理 | 非确定性 DSH 调用留在 Activity，通过结果或消息把委派意图交给 Workflow；不能在 replay 中重新让模型规划 |
| 自托管部署 | Python 库 + system database，无需独立编排服务器；单实例可与 FastAPI 同进程启动 | Python Worker + Temporal Service + 持久/Visibility 存储，Web UI 可选；需维护 Service/schema/Worker 的兼容升级 |
| SQLite 现状 | 可保留业务 SQLite，但推荐迁入与 DBOS 同一 Postgres database、分 schema，从而使用官方事务入队。无需把 DSH JSONL 移入 DBOS | 可保留业务 SQLite；另设 Temporal 存储。CLI dev server 的便利性不能代替生产部署设计 |

表中能力依据：[DBOS workflows](https://docs.dbos.dev/python/tutorials/workflow-tutorial)、[queues](https://docs.dbos.dev/python/tutorials/queue-tutorial)、[recovery](https://docs.dbos.dev/production/workflow-recovery)、[ownership](https://docs.dbos.dev/explanations/concurrent-executions)、[client 去重](https://docs.dbos.dev/python/reference/client)、[steps 限制](https://docs.dbos.dev/python/tutorials/step-tutorial)、[消息](https://docs.dbos.dev/python/tutorials/workflow-communication)、[子流程](https://docs.dbos.dev/faq)；[Temporal Tasks](https://docs.temporal.io/tasks)、[确定性](https://docs.temporal.io/workflow-definition)、[消息](https://docs.temporal.io/develop/python/workflows/message-passing)、[子流程](https://docs.temporal.io/develop/python/workflows/child-workflows)、[ID 定义](https://docs.temporal.io/glossary)。

两个方案均有 MIT 许可的官方开源核心，可自托管，不要求购买云服务：[DBOS Python](https://github.com/dbos-inc/dbos-transact-py)、[Temporal Service](https://github.com/temporalio/temporal)。本建议不将托管 Conductor 视为首版必要依赖，也未核查其商业/自托管授权；未来多机高可用须单独选官方协调部署方案，不能悄悄假定基础库已包办。

Temporal 开发环境可用单二进制 `start-dev`，并非必须一开始部署 Kubernetes；正式自托管仍需独立 Service 和持久存储。官方支持 PostgreSQL Visibility，因此不能说 Elasticsearch 必需。更强的运维能力伴随更多组件，但没有进行资源基准测试，不声称具体内存或启动速度。[自托管指南](https://docs.temporal.io/self-hosted-guide)、[部署](https://docs.temporal.io/self-hosted-guide/deployment)、[Visibility](https://docs.temporal.io/self-hosted-guide/visibility)。

## DSH 桥接的最小职责

以下是项目设计推断，不是任一候选内建的 DSH 插件。

1. **稳定身份。** `task_id` 映射到 durable workflow ID；任务记录保存用户、Agent 发布版本、原始目标、DSH Session 与根/父任务。固定发布版本是业务要求，不等同于 DBOS application version 或 Temporal Worker 版本。
2. **恢复入口是“查状态并接管”。** 每次 step/Activity 重试先读 DSH Session 和成果：已完成直接返回；进行中检查原 Host 是否仍活着；中断则按官方 resume 与公开驱动接口继续原 Session。不能重新提交原提示并创建新会话。
3. **Node 生命周期。** Python 崩溃时 Node 可能仍运行；Node 崩溃时 Python 也可能继续活着。需要进程归属、存活检查、停止/附着与超时契约。使用服务管理器/受控子进程生命周期和官方 DSH 会话写锁；工作流组件不自动杀孤儿 Node，也不隔离代码执行。不能把“step 可重试”当作允许两个 Host 同时接管。
4. **输入与委派对账。** 官方 workflow 消息负责跨进程等待；DSH inbox 负责模型输入。桥接保存稳定输入/委派 ID，解决“送达 DSH、但 workflow 尚未记录成功”窗口。DSH 原生子任务保持官方 catalog/sendMessage；独立平台协作者才按任务 ID 建 durable 子任务。两者不应无区别地复制为两套调度器。
5. **未知副作用。** DSH 的 `TOOL_OUTCOME_UNKNOWN` 必须先核对外部结果；已完成工具不重放。恢复重试仅发生在幂等“检查并接管”边界，不是对整个代码执行块盲重试。
6. **原子提交边界。** 优先使用下述官方事务入队，在同一 Postgres transaction 内创建 Task 并 enqueue。DSH 文件和外部操作不属于该事务，仍按稳定 ID 对账；不要把同库事务扩大为跨 Node/文件系统的恰好一次。

DBOS step 与 Temporal Activity 都存在“效果已发生，完成结果尚未落盘”的重执行窗口；两者都不能保证任意外部工具恰好执行一次。DBOS 所有权 token 检查在检查点发生，不能拦住已经运行的 Shell；Temporal 心跳/超时也不能自动取消已发往外部服务的请求。[DBOS 并发保证](https://docs.dbos.dev/explanations/concurrent-executions)、[Temporal 官方工具集成的副作用警告](https://docs.temporal.io/develop/python/integrations/mcp)。

## 原子受理与数据库拓扑补充

官方 **`DBOSClient.enqueue_in_transaction`** 可把入队写入调用者已有的 SQLAlchemy `Connection` 或 ORM `Session` 事务。应用在同一事务写 Task/输入事件并调用该接口，随后统一 commit；失败统一 rollback。它不替调用者提交/重试，也不能跨数据库。返回的 handle 在事务提交后才可等待结果。async 服务可用 `AsyncConnection.run_sync` 传递同一事务底层连接。[官方 Client API](https://docs.dbos.dev/python/reference/client)。本次额外核对 [3.3.0 发布标签源码](https://github.com/dbos-inc/dbos-transact-py/blob/3.3.0/dbos/_client.py)，该方法确已存在，不只是未发布文档。

推荐拓扑：**一个 Postgres server → 一个 database `orchmesh` → 业务 schema `orchmesh` + 官方 schema `dbos`**。`dbos_system_schema` 可配置；DBOS 不要求 system database 内只能有系统表，官方原子入队示例本就将应用写入与系统入队置于同库事务。不要手工改 DBOS 内部表，使用公开 API 或官方 `dbos.enqueue_workflow` 函数。仅“同一服务器、两个 database”仍不能达成这个单连接事务。[配置](https://docs.dbos.dev/python/reference/configuration)、[官方 Transactional Outbox 替代示例](https://docs.dbos.dev/python/examples/outbox)。

这比自己创建 outbox 表和轮询消费者更直接。采用 ORM transaction 接口优先于复制内部 SQL；原子入口应结合稳定 workflow ID、业务唯一键与身份校验，网络响应丢失后读取既有任务，不能接受同 ID 不同用户/参数。该事务 API 不支持 `duplication_policy="return-existing"`；重复受理处理需按真实 API 行为测试，不能与普通 enqueue 的参数支持混淆。[Client 限制](https://docs.dbos.dev/python/reference/client)。

若暂不迁 SQLite，也可用固定 workflow ID 的 durable enqueue 作为唯一权威受理，然后在 workflow 内通过官方 datasource transaction 建立业务记录。这不需要自写 outbox，但受理后业务列表可能短暂尚无投影，API 查询需从 workflow 状态补齐；不能先写 SQLite Task 后普通 enqueue 并声称原子。官方 SQLAlchemy datasource 会把事务输出与应用数据库写入一起记录，重放读取既有结果；支持 SQLite/Postgres，但不会把两个数据库的独立事务自动合成一个。[Datasources](https://docs.dbos.dev/python/reference/datasources)、[事务教程](https://docs.dbos.dev/python/tutorials/transaction-tutorial)。

因此本轮进一步建议直接统一平台元数据到 Postgres，避免长期维护 SQLite↔system DB 的受理投影复杂性；迁移保留账号、ID、文件引用及 SQLite 原始备份并另做校验。A2A 持久任务流也更容易与平台状态同事务维护，但 **DSH JSONL 和外部 A2A 网络投递仍是另一个边界**，不能由此宣称端到端原子。数据库迁移与 A2A 协议具体持久接口不在本次文档选型验证范围内。

## 首版接入形态与验收门槛

建议一个 API 进程内通过 FastAPI lifespan 启停 DBOS，注册异步 durable workflow 和队列；后续有独立扩缩容需要时再拆 Worker。建议一个 Postgres database 同时容纳 DBOS system schema 与 OrchMesh 业务 schema，SQLite 迁移前备份保留。无需引入 Redis、另造租约表或自写数据库轮询任务队列。[官方 FastAPI 生命周期](https://docs.dbos.dev/python/upgrading)、[独立 Worker 示例](https://docs.dbos.dev/python/examples/queue-worker)。

首版是单实例重启恢复，不冒称多机高可用。进程退出后仍需部署系统重新启动应用，DBOS 在启动后恢复任务；Node 单独退出则由桥接向 durable step 报告可恢复故障。异常重试策略须明确配置，因为 DBOS step 的普通异常自动重试默认关闭；崩溃后恢复与捕获到普通异常后的重试是不同路径。[Steps](https://docs.dbos.dev/python/tutorials/step-tutorial)、[恢复部署](https://docs.dbos.dev/production/workflow-recovery)。

实施前的小型集成实验至少通过：

- API/worker SIGKILL 后原任务 ID 自动继续，已完成 DSH 工具不再调用。
- Node 单独退出、Python 单独退出但 Node 存活，两种情况均不重复启动同一会话。
- 已入队但响应丢失、输入已送达但确认丢失、成果已完成但 workflow checkpoint 未写，均可用固定 ID 对账。
- 待答问题跨重启继续等待，回答只进入 DSH 一次；原生子级已完成成果复用。
- 更新 Agent 发布版本后旧任务仍使用原版本；workflow 代码升级遵守官方版本兼容机制。

当前只完成文档选型；DBOS/Temporal 均未在项目中运行。推荐 DBOS 是基于当前单实例、小规模与 Python 入口的工程判断。若将来明确要求跨多机失效自动接管、复杂长时父子任务运维及完善工作流控制面，Temporal 的额外部署成本更容易成立，再重新评估。
