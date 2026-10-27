# DSH 持久化与重启恢复核查

核查日期：2026-10-27。范围：官方文档、源码、npm 元数据，以及本项目锁定的发布包；仅研究，不改代码、依赖、运行环境或用户数据，初稿未进行杀进程实验；后续已完成 rc.3 六项真实 SIGKILL/重建实验，见[断进程实验报告](dsh-restart-experiments.md)。仍未进行断电实验。

## 结论

**DSH 确实有持久化和恢复能力，且不只保存聊天文本；但现有证据不支持把它等同于完整任务自动续跑引擎。** 可直接复用 Session 事件存储、投影、崩溃尾部修复、Agent 重建、持久 inbox、本地子智能体冷恢复。平台仍需决定重启后哪些任务应被重新接管、何时唤醒、如何核对已发生的工具副作用，以及如何恢复父子任务的业务完成状态。

“恢复历史”“重建 Agent”“重新发起一轮以完成原目标”“恢复一个正在执行的 Shell 进程”是四种不同承诺。DSH 提供前两项的明确接口，为第三项提供基础；默认进程内作业不提供第四项。[Agent 工厂与恢复](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/core/agent-loop/src/index.ts#L753-L826)、[jobs-local 约束](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/jobs/jobs-local/README.zh.md#L30-L67)。

## 版本与证据等级

- 本项目 `apps/runtime/package.json` 锁定 `0.2.1-rc.3`；本机已有的对应发布包中核对到 `interruptedTurnClosers`、持久 inbox、子智能体、schedule 与 user-questions 的相关实现。
- 本次 `git ls-remote` 核验官方 HEAD 仍为 **`22ddee3792402c3e70ec5f86a63c3e3e895a2f60`**，与本机只读审计副本一致。下文源码链接固定到该提交，不使用漂移的 master 链接。
- 直接查询[官方 npm 元数据](https://registry.npmjs.org/@deepseek-ai%2Fdsh)：`latest = 0.2.1-rc.2`，`next = 0.2.1-rc.4`；rc.3 发布于 2026-10-23，rc.4 发布于 2026-10-26。因此不能将项目 rc.3 笼统称为“最新”。本轮没有安装或完整审计 rc.4，也没有证明所有 rc.3 文件与当前源码逐字一致。
- 下文“已核验”指文档/源码或本地发布包可见事实；“推断”指由生命周期代码推导的集成结论；均不冒充当前 OrchMesh 的端到端重启验收。

## 能力边界

| 对象 | 官方已有能力（已核验） | 重启后仍需处理的边界 |
| --- | --- | --- |
| Session 历史 | JSONL 后端持久化事件批次；已提交前缀保留，支持尾部物理损坏恢复与 flush | 内存事件不等于已落盘；突然退出的最后批次需要实测。持久化目录必须独立于临时沙盒。[S1] |
| Agent | `ctx.agents.resume` / `SessionController.resolveAgent` 重建会话及运行对象；同会话写所有权排他 | 重建对象不等于恢复原调用栈；平台还需决定继续哪个任务、用哪个发布版本。[S2] |
| 崩溃中的 turn / tool | resume 追加修复结果与 interrupted 终止事件；区分工具未开始与结果未知 | 未知结果不能盲目重新执行；模型重新规划也不能代替业务侧结果核对。[S3] |
| inbox | 插入、编辑、取消、领取都由事件投影重建；未领取输入可以保留 | 已领取消息已从待处理列表删除。不能把所有中断工作视为“仍在队列里”，也不能据此承诺启动后全部自动唤醒。[S4] |
| 本地子智能体 | 持久子会话、descriptor、父级 catalog；可继续子级支持冷恢复及后续消息 | catalog 主要记录成员关系，不是完整运行调度表；进程内 activation、result Promise、父级通知投递需要重启后协调。[S5] |
| 子智能体配置 | 保存子级 persona/工具限制等恢复材料，并能根据 preset 恢复组装 | 独立 preset 的冷恢复采用当前注册定义，不保留跨重启的旧代际；平台的“任务固定发布版本”需要额外版本映射。一次 activation 的结构化输出约束也不保证随冷恢复保留。[S5] |
| jobs / Shell | 作业生命周期事件可保存，模型可查看运行期作业并取消 | `jobs-local` 记录和输出环在内存中，Host/owner 结束时作业终止，不恢复正在执行的进程；持久执行需另一个实现相同 seam 的后端。[S6] |
| schedule | 持久提醒可跨 Host 重启，时间到后恢复原 Session 并投递 followup | 这是提醒投递，不是恢复任意中断步骤；会话入队与 schedule 存储非原子，可能重复投递，投递回执不证明模型任务完成。[S7] |
| 人机问题 | 官方 timed 问题投影可将中断调用变为 continued；之后回答经新消息进入恢复后的 Agent | **blocking legacy schema 不被此投影跟踪**；不能将 timed 的恢复能力套到当前平台所有问题。恢复回复不会复活原工具调用。[S8] |
| 审批/其他等待 | 原有审计及工具历史可保留 | 不能据此推导进程内 waiter、回调或审批 Promise 能跨重启继续。未核验完整审批恢复路径，应作为独立验收项。 |

### 官方来源

- **S1**：[JSONL 存储崩溃语义](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/session/session-persistence-jsonl/README.zh.md#L75-L81)。批次 append 完成前同步存储；普通 Session.append 到后端批次存在路由/缓冲边界，需使用公开 flush 屏障。
- **S2**：[Agent resume 取得写句柄并重建](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/core/agent-loop/src/index.ts#L753-L826)、[Controller 去重并发 resolve](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/api/session-controller/src/agent.ts#L155-L219)。配置型 Agent 也支持指定稳定 sessionId 在挂载时恢复，但这不是扫描平台未完成任务的通用调度器。
- **S3**：[崩溃修复及结果未知语义](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/core/session/src/repair.ts#L14-L51)、[恢复后追加 closers](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/core/agent-loop/src/index.ts#L795-L825)。`TOOL_NOT_STARTED` 与 `TOOL_OUTCOME_UNKNOWN` 是不同事实；后者可能已经发生副作用。
- **S4**：[inbox 持久投影](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/core/agent-loop/src/inbox.ts#L19-L64)、[领取是删除队列项](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/core/agent-loop/src/inbox.ts#L95-L112)、[恢复实例初始 idle 与显式唤醒](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/core/agent-loop/src/agent.ts#L129-L169)。具体组合中的恢复唤醒行为仍须对锁定版本实测。
- **S5**：[子级冷恢复与发现](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/subagent/subagent/README.zh.md#L61-L73)、[结果交付、目录与配置恢复限制](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/subagent/subagent/README.zh.md#L111-L130)。
- **S6**：[jobs-local 生命周期与不恢复说明](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/jobs/jobs-local/README.zh.md#L30-L67)。
- **S7**：[schedule 恢复、flush 及投递顺序](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/schedule/schedule/README.zh.md#L63-L73)、[重复投递及恢复失败边界](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/schedule/schedule/README.zh.md#L153-L162)。
- **S8**：[user-questions 重连与进程结束后的回答](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/interaction/user-questions/README.zh.md#L27-L40)、[投影明确排除 blocking legacy schema](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/interaction/user-questions/src/projection.ts#L220-L291)。

## 对 OrchMesh 的含义

以下为源码审查后的设计建议，尚未实施：

1. **保留官方事件存储和恢复链路。** 平台保存任务身份、智能体发布版本、目标、父子委派和执行归属；DSH 保持会话事件及 Agent 运行语义。不要复制一套模型消息日志、inbox 或 Agent Loop。
2. **把重启接管作为平台能力。** 用持久业务记录判断哪些任务需人工重试或自动接管，通过公开 Controller / Agent / Subagent 接口重建，核对已有成果后再继续。接管应避免多个执行者重复领取同一工作。具体租约、事务和调度实现留到技术设计阶段。
3. **临时沙盒与恢复输入分开。** 保存的工具结果、输入文件、交付成果可以为新沙盒提供恢复材料；原 Shell 的内存、进程、未导出的中间文件不因 Session resume 自动恢复。临时文件若是继续任务的必要材料，就需要明确保存策略。
4. **首版必须自动接管并继续未完成任务。** 用户后续已明确恢复不是可延期项；官方基础能力已完成六项断进程验证，但 OrchMesh 的启动接管、版本固定、父子对账和未知副作用核对尚未实现，不能把组件实验通过等同于产品验收。

当前实现证据：`apps/server/src/orchmesh/dsh/manager.py::recover` 清理用户容器并将 running 标为 interrupted；没有自动续跑。`apps/runtime/bridge.mjs` 已使用公开 Controller 和 Agent/Subagent 等待接口，属于可复用基础。`apps/runtime/interactions.mjs` 的 pending Map 不持久，且当前阻塞式提问不直接享有官方 timed/continued 恢复能力。以上是集成差距，并非证明 DSH 没有相应基础能力。

## 尚未验证与建议验收

| 故障点 | 必须核对的结果 |
| --- | --- |
| 输入已接纳、尚未领取时杀 Host | 重建后待处理输入存在且身份稳定；确认是否需显式唤醒，不重复投递 |
| 模型流式输出中杀 Host | 已落盘前缀可读、中断可见，后续请求历史配对正确，不声称恢复原网络流 |
| 工具开始前 / 开始后但结果落盘前退出 | 分别标为未开始/结果未知；对后者先核对产物，避免盲目重做 |
| 子级已完成、父级尚未收到通知时退出 | 能找回子级成果，父级不重复派发同一工作；结果消费与委派账本一致 |
| 有待答问题时退出 | 分别测试 blocking 与官方 timed 模式，恢复后的回复只被处理一次 |
| 创建新版智能体后恢复旧任务 | 恢复采用原任务版本，不被当前 preset 静默替换 |
| 沙盒被回收后恢复任务 | 必要输入和已有交付物可重新取得；缺失中间材料明确报告 |
| 两个接管者同时恢复同一任务 | 单一任务所有者，不能靠模型提示词避免并发重复执行 |
| 已完成结果刚落盘、平台状态尚未更新时退出 | 重启对账后确认完成，不重新执行已完成任务 |

后续已使用隔离数据、可计数工具和真实 SIGKILL 完成其中六类基础场景，详见[实验与未测边界](dsh-restart-experiments.md)。尤其确认纯 resume 不自动驱动、未完成流式 delta 不持久；父级通知丢失、timed 提问、版本固定及平台端到端仍未验证。
