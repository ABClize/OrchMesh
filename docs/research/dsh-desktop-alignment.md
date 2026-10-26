# DSH 桌面能力对齐审查

2026-10-26。目标已调整：保留 OrchMesh 当前页面设计，以官方 Workspace/Session 语义为准，撤销“仅移动显示分组”的旧约束，不整站替换成官方 Web UI。本文件只记录研究，不代表下列功能已经接入。

证据分两层：Context7 `/deepseek-ai/deepseek-harness` 用于检索；精确实现读取官方仓库 commit `22ddee3792402c3e70ec5f86a63c3e3e895a2f60`，并检查实际 `0.2.1-rc.3` 镜像内 npm 包。Context7 的文字示例可能跟随主分支，方法名和参数以锁定版本类型与代码为准。

## 结论与优先级

最小完整调整是让导航直接读取官方 Workspace 与 Session 投影，取消 SQL 中第二套项目名称、会话标题、置顶、归档和“显示项目”状态；平台只保留账号所有权、运行审计及受控物理目录定位。官方名称、成员、归档状态不需要同步回 SQL 后再读出来。优先把现有界面改为官方操作语义，再逐项接模型、队列、提问、审批和子任务 UI。引入整套客户端运行时只为几个导航控件并不划算。[Workspace Controller](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/api/workspace-controller/src/index.ts)、[Session Controller](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/api/session-controller/src/index.ts)

| 顺序 | 官方已有能力 | 当前项目适合的接法 |
|---|---|---|
| 1 | Workspace create/rename/delete；会话 pin/archive/unarchive；Workspace follow | 保留现有 Sidebar 和菜单，读官方 WorkspaceView/SessionSummary，删掉纯分组移动和项目归档 |
| 1 | Session create(workspaceId)、rename、fork、modelCatalog/selectModel | 用 native workspaceId 新建；增加官方语义的会话重命名/分支，不把旧会话随意转移到不同目录 |
| 2 | prompt(queue/steer)、updateQueue、cancel；page/follow/projections/control | 扩展已有输入框与流式通道，显示待发送队列、运行观察和会话详情 |
| 2 | ui-model-selection、ui-user-questions、ui-approval | 保留当前风格，借鉴官方交互和卡片状态机，走对应官方 Host 交互协议 |
| 3 | ui-subagent、ui-jobs、ui-plan、ui-goal、ui-schedule、ui-trajectory | 逐个以真实模型验证，并挂载对应 Host 插件；“包存在”不等于在当前 SDK profile 生效 |
| 3 | workspace-files、terminal-controller、文件/终端/文档预览 UI | 在账号与文件权限边界明确后复用；不能直接把宿主文件服务暴露出去 |

功能入口和插件组成以官方 [Web profile](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/bundle/web-app/cordis.patch.yml) 为基准。官方 Chat 支持历史图片、过程/思考展示、提交回显及滚动状态；子任务面板有本地子会话活动、用量、耗时和继续/停止；提问卡片支持选项、自由输入、超时、稍后作答和草稿。来源：[Chat](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/client/ui-chat/README.md)、[Subagent](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/client/ui-subagent/README.md)、[Questions](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/client/ui-user-questions/README.md)。

## Workspace 与 Session 的准确语义

- Workspace 是一个规范化目录的登记，ID 与显示名称、路径分离。新建会话要传 `SessionController.create({workspaceId})`。只传 `cwd` 会创建会话，但 commands.create 仅在 workspaceId 分支显式 `attachSession`，不能假设它自动写入已有 Workspace 成员列表。[create 源码](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/api/session-controller/src/commands.ts#L104-L143)
- `workspace.attachSession` 要求会话已持久化的 cwd 规范化后等于该 Workspace 路径；`detachSession` 只移除成员登记。它们不是跨目录移动或文件搬迁接口。不要伪造 cwd，不要重写历史来迎合分组。[Workspace entity](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/workspace/workspace/src/entity.ts)
- 官方 `WorkspaceController.delete` 仅移除登记，保留文件与 Session；UI 中原会话进入 Ungrouped。不存在“项目归档/恢复”的同义接口。页面应明确叫“移除工作区”，避免用户以为删除文件。[Workspace UI 管理语义](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/client/ui-workspace/README.md)
- Session archive 会移除置顶；unarchive 不恢复置顶。运行时 archive 默认拒绝，支持 `stopActivity: true`，由官方枚举并停止 turn/subagent/job/schedule。界面可按官方模式显示停止并归档确认；不需要自己维护另一套 running-work 列表。[Workspace Controller 类型](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/api/workspace-controller/src/types.ts)
- 已有 `/workspace` 历史的 cwd 不能同时解释成多个新路径。保留原文件定位，以官方能验证的真实成员关系显示；不匹配的旧会话可作为 Ungrouped，取消旧显示分组没有必要丢数据。

## 当前 React 能直接复用什么

官方 Web/桌面业务 UI 也是 React。`apps/web` 是很薄的 Vite 入口，实际 UI 是 Cordis/Slot 插件树。保留现有页面不妨碍复用 Controller；但不要把官方 UI 插件误认为普通的 `<WorkspaceList />` npm 组件。[Web package](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/apps/web/package.json)、[ui-session](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/client/ui-session/README.md)

### ClientWorkspaceModel

发布的 `/client` 类型公开 `ClientWorkspaceModel`：构造参数是 `WorkspaceRemote`；`replaceBaseline({workspaces, archivedSessionIds, pinnedSessionIds})` 注入权威快照；`subscribe`/`getSnapshot` 可对应 React `useSyncExternalStore`。它维护不可变快照、mutation 回声、删除墓碑和乱序结果处理；mutation 返回官方 `RemoteResult`（`{ok:true,value}` 或失败）。这是一份可以借鉴的完整状态模型，不必另外写同类竞态修补。[model.ts](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/api/workspace-controller/src/client/model.ts)

**实际 rc3 发布限制**：在当前镜像执行普通 ESM `import {ClientWorkspaceModel} from '.../lib/client.js'` 失败，提示没有该导出。文件实际以 `window.__ModuleLoader__.load({id,factory})` 开头，依赖官方模块表提供 Gateway、client-store 和 Cordis；`.d.ts` 的导出不表示浏览器 bundle 是普通 ESM。不能通过私有 `lib/types/client/model.js` 深路径绕开公开边界后声称稳定接入。[构建契约](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/client/tsdown.client.ts)、[模块加载器](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/client/modules/src/client/index.ts)

当前取舍：本轮优先复用 Host Controller 和官方数据形状，不为单个类引入整套客户端载入协议。若决定借鉴源码，选纯逻辑模块，保留 MIT 版权、commit 与改动记录；需要同步维护其 `notifySubscribers` / `isRemoteFailure` 等依赖，不能只复制一个类却悄悄另造支持层。完整 Client Session 层还有 connection、fileUpload、Gateway、scope/ref 生命周期，更不适合宣称即插即用。

### UI 插件与纯控件

`ui-workspace`、`ui-chat`、`ui-sidebar-files` 发布 `/client` 主要导出 `apply/inject` 和类型，通过 slots 注册组件；它们需要官方 UI/session/locale/remote 服务。`ui-primitives` 是普通 ESM、纯 React controls/Markdown/JSON/Diff 等，但实际 npm rc3 artifact 的裸 import 依赖多数列在 devDependencies，脱离官方 shell 需要补齐依赖与 CSS/主题上下文。本次已用 npm tarball 核实其 ESM 入口，未改项目依赖。现有 shadcn 已满足的 Button/Dialog 等无需换库。[Primitives package](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/client/ui-primitives/package.json)、[导出列表](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/client/ui-primitives/src/index.ts)

## 必须保留的平台边界

官方桌面面向 Host 用户，不替代 OrchMesh 登录、账户隔离、容器生命周期与授权。目录选择器、Open in App、Electron Browser tabs、系统托盘和自动更新依赖原生 Host 能力，不应在 Web 页面中机械复制。官方 Web profile 会按运行环境禁用部分桌面入口。[Desktop 源码](https://github.com/deepseek-ai/deepseek-harness/tree/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/apps/desktop/src)、[Web profile](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/bundle/web-app/cordis.patch.yml)

尤其注意：官方 workspace-files 的 `read/readBytes/stat` 可以访问 Session 文件系统允许的工作区外文件，只有目录 list/watch 限制在工作区。当前容器 `/state/config` 存模型凭据；在 danger-full-access 下不能无条件将整个官方文件服务透传给网页。先配置官方 filesystem/sandbox policy 或保留平台受控下载边界，再替换文件实现。保留账号和文件授权不是重复造轮子。[文件服务边界](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/api/workspace-files/README.md)

官方源码采用 MIT；复制实质性代码须保留版权与许可。仅引用接口、读取运行时能力与照搬整套桌面行为是不同的工作量和责任范围。[LICENSE](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/LICENSE)
