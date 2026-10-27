# 第一阶段验证：DBOS、A2A、DSH 恢复与按需沙盒

日期：2026-10-27。**结论：选定组合的第一阶段隔离接入验证通过，可以据此进入实现；现有应用尚未迁移。** 本轮新增可复现实验与文档，未修改业务代码、应用依赖、账号、聊天、数据库、用户文件或现有服务配置。

## 1. 验证方式与环境

- DBOS `3.3.0`、A2A Python SDK `1.2.3`、DSH npm `0.2.1-rc.3`、FastAPI `0.162.0`、Python `3.12.15`、PostgreSQL `16.10`。新 Python/npm 依赖仅安装在临时目录，另有实验锁文件，不改应用锁文件。
- 独立 PostgreSQL 容器、随机 loopback 端口、独立 Session/产物目录。SSH 使用临时密钥和任务容器内的 `node` 用户，未创建宿主 Linux 用户，不挂载业务文件或 Docker socket。
- 使用真实 SIGKILL 和新进程启动，不以同进程重建代替崩溃。测试器只终止自己启动的进程。
- 精准故障点使用确定性 DSH `LlmAdapter`；另用项目 `.env` 的真实模型凭据验证未知副作用恢复。只读取模型字段，没有登录管理员、创建账号或写入原应用；测试私有身份由独立 API 注入。
- 完整链路为 **FastAPI → 官方 DBOS 事务入队 → 官方 A2A Client/Handler → DSH Session → 官方 SSH 模型工具 → 临时 Docker**。不修改第三方包，不自写 Agent Loop、协议服务、任务队列或 SSH 提供方。

主套件在全新 `/tmp/orchmesh-phase-a-recovery-tngplpma/` 完成最终复验；11 项通过。独立 SSH/问答/版本套件在 `/tmp/orchmesh-phase-a-ssh-ykk4urpc/` 完成全新目录复验；10 组通过。原始尝试和失败日志保留于临时目录；下面摘要只标识最终通过结果。

## 2. 主链路实测结果：11 / 11

| 场景 | 真实故障与断言 |
| --- | --- |
| 原子受理 | Task insert 与官方 `enqueue_in_transaction` 同事务，主动 rollback 后两者都不存在；同请求再次提交返回原 task ID |
| 模型流中断、再次中断 | 强杀 Python，内核 parent-death signal 终止所属 Node；重启由 DBOS 自动接管原 Session，恢复中再杀一次，最终副作用计数仍为 1 |
| DSH 已完成、DBOS 未记录 | 在 DSH flush 后、step checkpoint 前强杀；重建读取已完成消息，模型调用总数仍为原两次，没有重新生成 |
| A2A 子任务结果通知丢失 | 子任务已通过官方 SQL store 保存结果，父级尚未完成 step 时强杀；父级恢复查询原 A2A task，子模型与工具不重跑 |
| 持久等待与回答 | DBOS recv 等待期间重启；两次发送相同 idempotency key 的答案，业务只消费一次 |
| Node 单独退出 | 只杀 DSH 子进程；官方 DBOS step 的限定重试重新接管原 Session，副作用计数 1 |
| 持久取消 | 官方 DBOS 取消使可抢占 step 清理 Node；重启仍为 CANCELLED，不恢复已取消工作 |
| 真实模型未知工具结果 | 工具写入一次后在返回前强杀；DSH 修复为 TOOL_OUTCOME_UNKNOWN；真实模型调用 inspect_effect 核对，再完成。实际写入仍为 1 |
| 完整沙盒链路 | A2A 子任务恢复同一 DSH Session，调用官方 write/bash/read/grep 生成 report.txt；文件导出且容器删除后、DBOS 记录 step 前强杀；重启校验 SHA-256 并复用产物，没有第二个容器或第二次工具执行 |
| A2A 冷订阅 | 原请求/执行进程已不存在，新进程通过官方 subscribe 收到工作快照与后续 completed；查询最终 Task 有一份成果 |
| A2A 投影未写的受理窗口 | 先事务入队，尚未写 A2A Task 就强杀；重启完成 DSH，再用公开 versioned store 的 MISSING 初始版本补建最终协议结果 |

真实模型用例不是预先给模型伪造“已成功”的结果：先执行实际计数工具，再强杀；恢复时由模型读取独立效果记录。测试断言只匹配 **assistant 的最终 text block**，不会把用户提示里的完成标记误判为任务已完成。

清洁证据：[主套件结果](phase-a-probes/recovery/verified-results.json)。复现入口：[主套件 README](phase-a-probes/recovery/README.md)。

## 3. 官方 SSH、提问与版本能力

独立套件还确认：

- 普通 Session 阶段没有执行容器；按需创建后通过公开 `agents.resume` 为同一 Session 装配官方远端服务。
- 官方文件版本冲突/只读限制、Shell 输出、取消、PTC、原生 write/bash/read/grep 均通过。容器内官方 sandbox 自动选择 Landlock；它的 full 表示文件效果约束，不能外推为任意敌对代码安全保证。
- 运行中删除容器得到明确 unknown outcome，没有自动重连/重放；用保存输入创建新环境后，Session 与导出的产物保留。
- 官方 timed `ask_user_question` 持久化后 SIGKILL，重新 resume 后通过 `userQuestions.answer` 作答；重复排队抛 REPLY_QUEUED，最终仅一条回复。
- 默认 preset 改为 v2 后，旧任务重启按保存的不可变 v1 ID 重建仍使用 v1；新任务使用 v2。平台必须保存旧定义，DSH 不会自动替平台保留全部发布版本。

详细记录：[接口与沙盒实测](phase-a-interface-audit.md)，[可复现 SSH 套件](phase-a-probes/ssh/README.md)，[清洁结果摘要](phase-a-probes/ssh/verified-results.json)。

## 4. 实验发现的接入约束

### DBOS 使用当前公开 API

`Queue(...)` 直接构造已不能使用。FastAPI lifespan 中先 `DBOS.launch()`，再 `await DBOS.register_queue_async(...)`；异步上下文不调用同步 register_queue。普通异常默认不会自动重试，实验仅对已确认的 Node SIGKILL 配置官方 step retry，未知副作用仍先核对。使用 `preemptible=True` 配合取消清理；DBOS 本身不替平台杀外部进程。[官方升级说明](https://docs.dbos.dev/python/upgrading)、[steps](https://docs.dbos.dev/python/tutorials/step-tutorial)。

### A2A 不能先答复已受理再入队

Executor 先完成业务受理与 DBOS 入队事务，然后才发布协议事件。如果受理后、协议投影前崩溃，依据已保存的 task/context/owner 映射补投影。不要宣称官方 A2A SQL store 与 DBOS 的事务自动合并。

恢复后无需伪造旧内存 EventQueue：通过公开 `VersionedDatabaseTaskStore.get/save` 带前版本写入 Task 与事件，官方 SQL event stream 会读取新状态。正常更新须处理版本冲突和终态，不能覆盖取消结果。[官方 versioned store](https://github.com/a2aproject/a2a-python/blob/v1.2.3/src/a2a/server/cluster/database_task_store.py)。

自定义身份入口应继承 `DefaultServerCallContextBuilder.build_user` 等公开扩展点，保留默认 builder 的 headers/version 状态。实验早期完全替换 builder，丢掉 A2A-Version，导致被当成 0.3；恢复官方默认流程后通过，无 SDK 补丁。

**发现的上游限制：** A2A SDK 1.2.3 中，versioned store 与 event stream 同进程使用相同自定义 event table name 会重复注册 SQLAlchemy metadata；本实验使用官方默认表名解决。正式部署应优先保留官方表名，并验证受支持的 schema/search_path 隔离，不复制内部模型或 monkeypatch。

### SSH 是官方实现，部署坐标仍由平台负责

可用已发布 npm 包的 `node-script` helper，不必先编译私有 native carrier。rc.3 helper 协议为 2，与当前 HEAD 文档/源码存在差异，必须匹配客户端、helper、PTC 与依赖版本。

官方 grep 使用 package-owned rg 的绝对路径。实验首先复现了远端路径不存在的错误，随后把该制品以同一绝对路径只读部署到容器，原生工具通过；没有更改官方搜索工具，更没有回退宿主执行。

### 状态恢复不能靠字符串或进程是否存在猜测

DSH 完成判定读原 Session 的 assistant 最终块；工具结果未知必须核对。已有排队输入使用公开 inbox/发送接口重新驱动，并保持其消息身份。主探针未证明任何时间点的断电级原子写入，因此正式适配仍须测试所有输入交接窗口，不能把此处同步代码段等同于跨文件事务。

Linux parent-death signal 在独立 Python launcher 设置后 exec Node，不使用多线程 Python 中不安全的 preexec_fn。跨平台部署或独立 Worker 必须换成相应服务管理机制；本轮只验证 Linux 单实例。

## 5. 可以采用的决定与边界

可以进入正式实现：保留 DSH；DBOS 管持久执行；官方 A2A 管协议/状态流；官方 SSH provider 连接任务级 Docker；账号/记忆/版本/产物不依赖容器存活。无需自写恢复调度器或修改 DSH 源码。

以下仍属于迁移后的产品验收，而不是本次探针已经实现的功能：真实多用户鉴权、广场/发布流程、真实模型自主选择协作者、跨 A2A 子任务的完整取消传播、DBOS 与 DSH timed 问题到前端的完整答案链、并发重复请求竞争、服务多实例接管、长时孤儿租约回收、任意副作用对账、磁盘损坏/断电及浏览器交互。完整沙盒链路用确定性模型；真实模型恢复用例独立，不能合并宣称“真实模型跨多 Agent 沙盒恢复全验收”。

这些限制不取消首版恢复要求。迁移时复用本轮通过的公开接口和故障探针，并补上述产品级测试；不能因为基础组件通过就直接对旧数据运行迁移或删除旧环境。

## 6. 资源与数据处理

最终复验自动清理了自己的 PostgreSQL 容器/匿名卷、任务容器、临时 SSH 镜像与私钥；早期实验实例也已按准确名称清理。临时证据保留，仓库只保存源代码、锁文件、文档与无凭据摘要。不运行 Docker prune，不停止任何既有服务。

本轮没有修改应用或运行数据，因此未运行与改动无关的全套前后端测试，也没有宣称现有 UI 已升级。原应用仍按旧架构运行。
