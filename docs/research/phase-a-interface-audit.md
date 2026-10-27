# 第一阶段：DSH SSH、问答与版本恢复验证

日期：2026-10-27。范围：官方源码核查 + 隔离实跑；不修改应用代码、配置、账号、用户文件或现有服务。原始开发证据在 `/tmp/orchmesh-phase-a-ssh-20261027/`，可复现的清洁脚本归档于 [phase-a-probes/ssh](phase-a-probes/ssh/README.md)。DBOS/A2A 总链路由主实验另行报告，本文件不把独立提供方测试称为平台迁移完成。

## 1. 实验环境与结果

实际安装官方 npm `0.2.1-rc.3`；宿主 Node `24.21.0`，测试镜像基于现有 `orchmesh-dsh:0.2.1-rc.3`，容器 Node `24.22.1`。新增 SSH 服务仅在一次性容器内运行，使用容器现有 `node` 非 root 用户；没有新增宿主用户。端口随机绑定 `127.0.0.1`，512 MiB / 1 CPU / 128 PID，未使用 privileged、宿主 Docker socket 或业务数据挂载。

| 场景 | 实测结果 | 证据 |
| --- | --- | --- |
| 普通阶段无容器 | 普通 Session 完成一轮时本实验容器为 0 | `session-plain.json`、`lifecycle-result.json` |
| 官方 SSH 文件接口 | 创建、版本冲突拒绝、原子编辑、只读拒绝均通过 | `result.json` |
| 官方 subprocess | 远端 Shell 与文件接口看到同一文件；输出和退出结果一致 | `result.json` |
| 官方 sandbox | 自动选择 `landlock-run`，报告 `enforcement: full`，远端命令 exit 0 | `result.json` |
| 官方 PTC | worker 在 `/workspace` 写文件，返回环境变量列表为空 | `result.json` |
| 原生模型工具 | 官方 `write` → `bash` → `read` → `grep`，四个 tool result 均非错误 | `session-native-aligned.json` |
| 进程取消 | `terminate()` 后结果 SIGTERM，`waitForExit()` 返回 true | `result.json` |
| 环境回收与重建 | 两个不同容器先后运行同一 `same-task-session`；公开 resume 保留上下文；导出的成果在容器删除后仍在 | `lifecycle-result.json` |
| 运行中移除容器 | 远端 Shell 的 handle 拒绝，明确 unknown outcome；无隐式重连或重放 | `loss-result.json` |
| timed 问答重启 | flush 后 SIGKILL，新 Node resume 后公开 answer 生效；重复队列答案报 REPLY_QUEUED；最终只有一条回复 | `question-result.json` |
| 发布版本重启 | v1 Session SIGKILL 后，在默认已变 v2 的新进程仍按原绑定运行 v1；新 Session 使用 v2 | `preset-result.json` |

模拟模型用于控制工具选择和故障时点，不证明真实模型天然能判断未知副作用。环境重建试验使用确定性输入重新建立工作文件，不恢复原 Shell 内存或所有任意临时文件。

完整归档 runner 已在全新 `/tmp/orchmesh-phase-a-ssh-ykk4urpc/` 复跑通过全部 10 组场景；清洁结果摘要见 [verified-results.json](phase-a-probes/ssh/verified-results.json)。该轮生成的容器、镜像和私钥已清理，原始证据保留。

## 2. 官方 SSH 最小组合

官方 `@deepseek-ai/dsh-ssh` 包导出 `./helper`，实际文件为 `lib/helper.js`。可以直接部署它及匹配 npm 依赖并使用 `node-script`，无须自行编译私有 executable carrier。实测 rc.3 握手 `protocol: 2`；当前检出的上游 HEAD 测试存在 protocol 3，必须匹配版本，不能把 HEAD helper 混入 rc.3 客户端。[官方连接文档](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/ssh/ssh/README.md)、[包导出](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/ssh/ssh/package.json)。

实验使用以下公开服务：

```js
ctx.plugin(SessionProjectionRegistry);
ctx.plugin(SandboxPolicyService, {
  mode: "workspace-write", workspaceRoot: "/workspace",
});
ctx.plugin(SshConnection, {
  host: "phase-a",
  launch: { kind: "node-script", node: "/usr/local/bin/node" },
  helper: "/opt/probe/node_modules/@deepseek-ai/dsh-ssh/lib/helper.js",
  helperHash, // SHA-256 of the actual deployed entry
  workspace: "/workspace",
});
ctx.plugin(SshFileSystem);
ctx.plugin(SshSubprocessRuntime);
ctx.plugin(SshSandboxProvider);
```

等待各 plugin readiness 和 `ctx.ssh.ready`。普通程序用 `ctx.subprocess.spawn({argv,cwd,stdio,graceMs})`，受限命令先 `ctx.sandbox.confine(argv, policy)`。`handle.done` 是退出结果，`waitForExit()` 额外确认托管执行范围退出；取消用 `terminate()`。按逆序 dispose plugin fibers，官方连接负责流、SSH 子进程和远端租约清理。[官方实时验收示例](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/ssh/ssh/tests/live.e2e.ts)。

PTC 再配置 `launch.bootstrapPath` 指向匹配的 `dsh-ptc-runtime-node/lib/process.js`、`bootstrapHash`，然后注册 `NodePtcRuntime({launch: ctx.ssh.ptcLaunch})`。普通 fs/Shell 不需要 PTC bootstrap。[官方 PTC 接入](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/ssh/ssh/README.md)。

### 真实发现的部署问题：grep 二进制路径

只在远端安装 `/usr/bin/rg` 不足以让官方 `tool-fs-search` 工作。该工具在宿主解析 `@vscode/ripgrep` 的绝对二进制路径，然后把同一 argv 交给远端 subprocess。第一次原生 grep 真实失败，而 write/bash/read 成功。

修正是把同一个 package-owned rg 二进制以同一绝对路径只读部署到远端，之后官方 grep 找到两行匹配。没有改插件、替换搜索工具或退回宿主运行。正式部署应固定可信运行制品路径，避免使用随机安装目录作为永久约定。[官方搜索源码](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/fs/tool-fs-search/src/search-core.ts)。

### 同一 Session 按需进入远端阶段

实测路径是普通 composition 完成并 flush，结束该进程；需要代码时创建任务环境，在新 composition 注册远端 providers，再通过公开 `ctx.agents.resume({resumeSessionId,agentOptions})` 打开原 Session。恢复后的模拟模型上下文包含普通阶段内容，远端工具在同一 Session 中完成。再次回收重建后仍使用相同 Session ID。

这验证了阶段边界重建，不声称官方支持任意工具执行中热替换 provider。业务层仍要持久化“需要代码”与阶段身份，避免每次恢复都重新要求代码或重复投递输入。现有完整 SDK profile 不能直接搬到宿主，普通 composition 本次只加载白名单基础服务。

## 3. 问答无需另造持久问题日志

官方 `UserQuestionService` 的 projection 从 Session tool-call/result 和 admitted user messages 派生问题状态；timed 原生调用即使在进程中断后被修复成 `TOOL_OUTCOME_UNKNOWN`，仍可成为 continued 问题。`mode: legacy` 没有同等投影语义。[官方问答说明](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/interaction/user-questions/README.md)。

实测注册 `UserQuestionService` 和官方 `tool-ask-user` 的 `{mode: "timed", timeout: 1}`，模拟模型调用 `ask_user_question`；等待配置的 1 秒期限、收到 pending 并 flush 后 SIGKILL。新进程公开 resume 后：

```js
ctx.userQuestions.answer(agent, callId, {
  answers: [{ id: "format", selected: ["Markdown"] }],
});
```

首次返回 true，立即再次提交抛 `REPLY_QUEUED`；模型读取答案后再次提交返回 false。最终 Session 仅有一条 `source.kind = user-question-reply` 消息。该调用是 continued 问题的新用户输入，不伪造先前工具返回值，也不会恢复旧工具的 JS 栈。[官方 answer 源码](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/interaction/user-questions/src/index.ts)。

本次 kill 点是 timed 已返回 pending 且已 flush；未另外杀在倒计时中。平台仍需将 DBOS 持久答案与这个官方入口按 callId 对账，但无需重写问题 projection。

## 4. 发布版本冻结是平台绑定，不是 DSH 自动留档

通过官方 registry 分别注册不可变 ID `report-v1`、`report-v2`，插件用公开 `systemPrompt.section` 提供不同标记。v1 Session 初始通过公开 mount/select 绑定并 flush，SIGKILL 后新进程默认设为 v2；恢复旧任务时按保存绑定在 setup 中 mount v1，然后公开 resume。实际模型请求的 system message 仍为 v1，新 Session 默认使用 v2。

这确认平台可以使用公开接口做到版本冻结；前提是平台持久保存 ID 和完整不可变定义并在重启后重新注册，不能用同一个可变 preset ID 覆盖旧版本。[官方 registry](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/preset/agent-preset-registry/src/index.ts)、[官方 setup/mount 示例](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/preset/agent-preset-registry/tests/harness.ts)。

## 5. A2A 恢复后的公开写入接口

A2A Python SDK `1.2.3` 可不依赖原请求的内存 EventQueue：恢复器调用 `VersionedDatabaseTaskStore.get(task_id, context)` 取得 `StoredTask(task, version)`，构造新状态后调用公开 `save(task, event=event, prev=old_task, prev_version=version, context=context)`。官方实现将 CAS 状态和事件同事务写入；`DatabaseTaskEventStream` 从 SQL 读取，`publish()` 本身是 no-op，不需要平台另造 token 事件表。[官方 store](https://github.com/a2aproject/a2a-python/blob/v1.2.3/src/a2a/server/cluster/database_task_store.py)、[官方事件流](https://github.com/a2aproject/a2a-python/blob/v1.2.3/src/a2a/server/cluster/database_event_stream.py)。

必须恢复原 owner context、处理 `ConcurrentTaskModificationError`，查询现有终态后再决定是否写入。协议存储不是 durable execution，DBOS/DSH 接管仍由主实验验证。不能为了重启而调用 Handler 的私有 active-task 方法。

## 6. 证据与边界

一键复现命令及资源清理方式见[脚本说明](phase-a-probes/ssh/README.md)。归档只包含源码、锁文件和无凭据结果摘要；实验密钥、node_modules、Session 与实际运行文件不进入仓库。实验用真实 Docker/OpenSSH/DSH 发布包，模型选择使用确定性 adapter。

仍未证明：所有插件都能远端执行、后台任务租约失效窗口、PTC 原进程恢复、前端问答卡片交互、多用户授权、平台 DBOS/A2A 与这些接口的完整组合。SSH 断线会明确报告结果未知；后续重建是平台受控动作，不能包装为官方透明重连。npm 安装报告上游依赖漏洞，未运行自动修复或擅自升级；正式迁移前应单独审查锁定依赖。
