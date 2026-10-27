# 旧账号、会话与文件的离线迁移契约

日期：2026-10-27。范围：只读 SQLite、当前 DSH 数据与已安装官方 `0.2.1-rc.3` 的公开接口。未运行 Agent、容器、模型或迁移脚本；未改写用户数据。本文只记录结构与数量，不记录聊天正文、标题、账号或密钥。

## 1. 已验证的数据边界

| 对象 | 当前数量 | 导入规则 |
| --- | ---: | --- |
| User | 1 | 保留原 ID、密码哈希、激活/管理员状态 |
| Conversation | 14 | 原 ID 是不透明字符串，保持不变 |
| Project | 12 | 保留目录与所有者；不等同于导航里仍注册的项目 |
| Run | 32 | 27 completed、5 stopped；不能作为新任务重新执行 |
| DSH JSONL Session | 22 | 全部保留，包括子任务/派生历史；不全部显示为顶层会话 |
| 官方 workspace 注册 | 7 | 对应现有导航，不凭 SQL Project 数量重建 |
| 置顶 / 归档 Session | 2 / 0 | 按官方 workspace 状态导入 |

SQLite 通过 `mode=ro` 打开，读取 schema、数量和字段类型。会话 ID 中 7 个长度 36、7 个长度 44，后者包含 `session-` 前缀，禁止全部转换为 UUID。来源：[当前模型](../../apps/server/src/orchmesh/storage.py)、[导航适配](../../apps/server/src/orchmesh/dsh/navigation.py)。

## 2. 官方冷读接口：不需要启动旧容器

真实存储位置为：

```text
.data/users/<user UUID>/dsh/
  sessions/<encoded cwd>/<session ID>/session.v4.jsonl
  storages/workspace.json
  storages/session_projcache/sessions/<session ID>.json
```

JSONL 首行为 `type: session` 的 header，包含版本、ID、cwd、createdAt、isSeeded、delegationDepth，可含 parentSession/origin。后续事件为 `{seq,time,type,data}`，可附带 surfaceOp/sourceEventSeqs。不要手写拼接器、跳过校验或直接修改 cwd/header。

官方 `@deepseek-ai/dsh-session-persistence-jsonl` 提供 persistence 服务；官方 `@deepseek-ai/dsh-session-query` 导出的 `readColdSessionLog()` 只打开 read handle，验证连续日志后关闭，不夺取 writer lease、不迁移/截断日志。中断尾部补齐仅在返回的内存事件数组中发生。`foldSessionTitle()` 是官方公开导出，读取最新日志标题，不调用模型。[冷读实现](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/session-query/session-query/src/cold-read.ts)、[标题实现](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/session/session-title/src/index.ts)。

已使用当前发布包实际运行以下公开组合；22/22 日志读取成功，21 个存在日志标题。读取前后 DSH 目录全部 74 个文件的 SHA-256 完全一致。未加载完整 SDK profile 或 Workspace Controller。

```js
import { Context } from "@deepseek-ai/cordis";
import * as jsonl from "@deepseek-ai/dsh-session-persistence-jsonl";
import { readColdSessionLog } from "@deepseek-ai/dsh-session-query";
import { foldSessionTitle } from "@deepseek-ai/dsh-session-title";

const ctx = new Context();
await ctx.plugin(jsonl, { root: sessionRoot, compression: "none" }).await();
for (const row of await ctx.sessionPersistence.list()) {
  const cold = await readColdSessionLog(ctx.sessionPersistence, row.header.id);
  const title = foldSessionTitle(cold.events);
  // Feed validated data to the importer; do not log contents.
}
await ctx.fiber.dispose();
```

运行依赖应来自项目锁定的官方包；本次验证使用已有 `/tmp/orchmesh-dsh-runtime/node_modules`。正式导入应是单次受控命令，结果写入业务 PostgreSQL；不要在登录请求中重新遍历全部日志。需要常态查询时可用官方 SessionQuery 的 `readSession/readSurface/readTitleSnapshots`。`session_projcache` 是缓存，不是聊天或标题的权威源。

## 3. 项目、归档与置顶

`storages/workspace.json` 的已验证结构：

```text
unit: { name: "workspace", version: 2 }
global: { initialized, workspaceIds, archivedSessionIds, pinnedSessionIds }
tables.workspaces[workspaceId]: { path, title, sessionIds, createdAt, updatedAt }
```

官方 schema 还允许 `defaultWorkspaceId` 与 `pendingMutation`。导入必须检查版本、重复 ID、未完成 mutation；不能默默当成空列表。当前无 pendingMutation。仅注册的 workspace 属于现有导航；注册已移除的 SQL Project 仍承载文件所有权，应保留为历史目录绑定。[官方 Workspace 源码](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/workspace/workspace/src/index.ts)、[现有 Project 删除逻辑](../../apps/server/src/orchmesh/projects.py)。

不要为了读取导航启动完整 Workspace Registry：它会涉及初始化、路径验证与重整，旧容器内 `/workspaces/...` 不一定是宿主真实路径。一次性导入采用版本校验后的只读 JSON 快照，不实现新的常驻 Workspace Controller。注册表成员与 Session header.cwd、业务所有权做交叉校验；遇到不一致输出不含正文的异常计数，保留原数据等待处理。

## 4. 文件引用不可跟随新分组重新解释

`Conversation.directory_id` 是原物理工作目录绑定，不是可以随导航改变的展示分组：

| 原绑定 | 宿主数据位置 |
| --- | --- |
| null/default | `.data/users/<user UUID>/work` |
| Project UUID | `.data/users/<user UUID>/projects/<project UUID>/work` |

已有文件卡片可能是官方 `kind: dsh.deliverables`（files[].path 绝对路径），也可能是旧 `kind: orchmesh.files.v1`（相对 path/name/size）。现有前端识别 `/project-workspaces/<UUID>/work/`、`/workspaces/<UUID 或 default>/` 与 `/workspace/` 前缀。迁移后必须用卡片所属原会话的 directory_id 和 owner 解析；禁止用当前选中 Agent、任务沙盒或新项目解析旧 `/workspace/report.html`。[路径映射](../../apps/web/src/features/workspace/files.ts)、[受限文件访问](../../apps/server/src/orchmesh/workspace.py)。

保留旧目录和会话引用；新产物建立独立 artifact ID 与归属关系。继续复用现有文件访问中的所有权检查、目录 fd 固定、O_NOFOLLOW、普通文件/硬链接限制以及下载大小限制。不要让模型提供任意宿主路径。不重命名旧数据目录，不在 JSONL 中批量替换路径。

## 5. SQLite → PostgreSQL

- User、Project、Run UUID 以及 Conversation.user_id/directory_id 在 SQLite 是 `CHAR(32)` 无横线 hex；按 UUID 语义转换为 PostgreSQL UUID，外部字符串与目录名仍采用原 UUID 身份，不生成新 ID。
- Conversation.id 保留字符串类型；DSH session ID、A2A task ID、DBOS workflow ID 分列，禁止互相强制转换。
- 当前密码为 Argon2id。哈希逐字节保留，不能重新哈希已有哈希或用初始化管理员配置覆盖；布尔 integer 显式转 boolean，ISO 日期字符串遵循目标 schema 转换规则。
- 账号迁移不要求轮换 JWT secret；保留现有 secret 文件。密钥、哈希、聊天正文不出现在迁移报告、SQL 日志或版本控制里。
- 现有外键约束刻意不启用；不要在导入时擅自改变该约定。先检查 owner/引用有效性并在业务层保持校验。
- 导入前后比较行数、ID 集合、密码哈希相等性、归属关系、文件大小/摘要。过程可重跑且冲突时拒绝覆盖，旧 SQLite/JSONL 保持只读；记录成功 checkpoint 后才切换读路径。

## 6. 新任务独立持久化与会话上下文

官方公开 `ctx.agents.create({sessionId,seed,meta,inheritedEventCount,...})` 和 `ctx.agents.resume({resumeSessionId,...})` 已支持种子历史与恢复。`SessionStore.fork()` 要求 live source；离线场景不要把字符串 ID 当成可直接跨 root fork 的接口。公开 `buildForkSeed(events,boundary)` 可从验证过的连续事件前缀生成 fork seed，处理继承边界与未闭合尾部。Agent 创建由官方 factory 管理，不能手工 SessionStore.create 后另启 Loop。[Agent API](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/core/agent/src/index.ts)、[fork seed](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/core/session/src/fork.ts)。

建议正式契约：一个任务绑定一个稳定 Session ID 和持久 root；恢复始终 resume 原任务 Session，不重新创建/重复发送原输入。新用户轮次可创建新任务 Session，以最近完成任务的官方 fork seed 继承上下文，并保存 parentSession、继承边界及原始会话 ID。需要完整消息解释时注册原事件所需的官方 message projections，不能假设任意自定义事件都能在裸 Session 中派生为模型消息。旧会话只读历史同样可作为第一次新任务的 seed 来源。

Session 根目录持久于宿主受控数据区；临时代码沙盒只提供工具执行环境，回收不能删除 Session 或交付文件。新任务 root 不必等于代码 cwd，header.cwd 必须保持稳定的执行逻辑路径。若每任务独立 root，父 Session 在另一 root 中，parentSession 只是血缘引用；平台保留 parent→storage locator，不能假定官方单 root query 自动发现所有祖先。多轮同一 conversation 的头指针更新需串行或 CAS，避免并发任务静默覆盖上下文。

官方 `ctx.sessions.flush(session)` 是持久屏障，返回是否存在持久 listener；正式 runtime 需要确认 listener 已加载且 flush 成功，不能把内存 append 当作磁盘 checkpoint。冷读补齐只证明 transcript 可展示，不证明工具副作用重放安全、Shell 进程恢复或 DBOS/A2A exactly-once。参见已验证的[重启实验](dsh-restart-experiments.md)与[第一阶段 SSH/恢复验证](phase-a-interface-audit.md)。

本次确证了旧数据离线读取；新任务跨 root fork 创建、前端导入后展示和 PostgreSQL 实际迁移还需主线集成验收，不以源码审查代替运行验收。
