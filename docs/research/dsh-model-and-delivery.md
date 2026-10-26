# DSH 模型思考与文件交付能力调研

> 2026-10-26 后续修订：本文保留早期调研记录。新交付已改用官方 present，旧自定义工具已移除；当前实现以 [DSH 执行层](../architecture/dsh-runtime.md) 和 [复用审查](dsh-official-reuse-audit.md) 为准。

日期：2026-10-26。本文保留实施前的源码调研建议。源码 commit `22ddee3792402c3e70ec5f86a63c3e3e895a2f60` 虽声明相同版本，却晚于实际 npm `0.2.1-rc.3` 包，不能视为发布 API 的准确快照。

**实施核对修正：** npm 包没有下文提及的 `agent.model.select`；已改用包根公开导出的 `installModelSelection(agent.ctx, ref)`，配合 `resolveModelInfo`。真实容器测试验证 off/high/default 的模型请求字段及恢复行为。实际工具签名为 `present_files({paths: string[]})`，结果持久化为 `orchmesh.files.v1`。当前实现见 [DSH 执行层](../architecture/dsh-runtime.md)。

## 结论

- 复用 DSH 的模型能力元数据、`reasoningEffort`、工具注册与持久工具结果；平台仅补会话设置和文件交付的产品接口。
- DSH 已有完整文件浏览/预览能力，但依赖其 Cordis/Typert、Session 资源地址和客户端 slot 系统，不能作为独立 React 文件预览组件直接插入现有界面。
- 当前多用户 Docker 的工作区归属由 FastAPI 掌握，文件读取直接复用现有用户目录与标准文件响应更合适，不必为了下载再启动 DSH 进程或搬入整套上游 Web。

## 思考设置：必须按模型能力提供选项

`InitializeParams.reasoningEffort` 已是官方 SDK 参数，省略表示保留模型默认；SDK 服务初始化会校验确切 provider/model/effort。标准 SDK RPC 当前没有模型目录查询或 `session/model/set`，它们不是可以直接调用的现成 SDK 方法。[协议类型](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/sdk/protocol/src/types.ts#L16-L32)、[RPC 分派](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/sdk/server/src/server.ts#L425-L458)

可通过现有小桥接调用公开 `ctx.llm.listModels` / `resolveModelInfo`，取得 `reasoning.efforts` 和 `defaultEffort`，以及 `agent.model.select`。DSH 自己的 Web 模型目录就是如此构造；应复用这些能力而不是在前端硬编码所有模型都有 low/medium/high/off。[官方目录实现](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/api/session-controller/src/catalog.ts#L20-L49)

**当前项目的实际缺口**：`apps/runtime/launch.mjs` 只声明 `models: [{ id: defaults.defaultModel }]`，没有显式的 `reasoningEfforts` 或网关兼容选项。无法仅凭现有 API 地址和模型名保证“关闭思考”生效。上游源码特意不向无推理元数据的手填模型展示 off：因为省略请求参数可能仍使用供应商默认思考。[适配器解释与能力投影](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/llm/llm-pi-ai/src/adapter.ts#L184-L217)

`llm-pi-ai` 支持每模型 `reasoningEfforts` 字典，键是 UI 等级、值是协议值；只有 off 可为空。空 off 通常省略参数，并不普遍意味着关闭。DeepSeek 风格的 OpenAI 兼容网关需要 `compat.thinkingFormat: deepseek` 才把 off 映射为 `thinking: {type: disabled}`。不应在平台统一拼接某个供应商字段。[官方配置规则与示例](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/docs/user/guide/providers.md#L134-L179)

还有一个恢复陷阱：SDK resume 在相同 provider/model 下，如果本次初始化省略 effort，会继承旧会话保存的 effort。所以“默认”不能简单实现为删除本次请求字段，否则用户可能仍在 high 上运行。需明确“保留会话选择”与“恢复供应商默认”，并通过公开模型选择 API 显式处理，先做协议回归验证。[resume 实现](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/sdk/server/src/server.ts#L481-L509)

建议第一版：聊天级选择 `默认 / 当前模型支持的等级`；无能力元数据时只显示默认和原因。下一轮生效，运行中不改变已发出的请求。模型执行配置与“是否显示推理文本”分别保存，后者只是前端展示偏好。

## 文件交付：注册一个薄工具，保留原生事件

在已检索的 pinned 源码与文档中，没有找到可直接启用的通用 `present_file` / `deliver_file` / `send_file` 工具。不要将“上游有文件读取工具/附件存储”等同于“已有文件交付给用户的产品能力”。

官方支持 `ctx.tools.register(defineTool({...}))`：schema 自动进入模型工具集，参数校验、执行和结果持久化由框架负责。`output.render` 定义记录到 Session 的内容；canonical JSON 值并不等同于持久历史，不能只从 execute 返回对象就假设前端刷新还能拿到它。[官方注册示例与语义](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/core/tools/README.md#L32-L65)

建议 `present_files({files:[{path,label?}],summary?})`：只接受工作区相对路径，验证为可交付的普通文件；结果持久记录结构化相对路径、名称、大小、MIME，前端按工具名渲染交付卡片。鉴权下载 URL 由前端/后端生成，不让模型输出宿主路径、凭据或任意下载 URL。现有 `dsh/events.py` 主要保留 toolResult content，需要确保交付描述经 `output.render` 可恢复，或显式扩展保留公开 presentation metadata；不要靠正则抓回答里的 Markdown 文件链接。

第一版可明确交付的是工作区文件引用：文件后来改变，预览也随之改变；删除则显示不存在。需要“交付版本永远不变”时再引入快照/内容哈希存储，不先做对象存储系统。

## 文件浏览与预览：借鉴上游，不直接移植访问边界

DSH `workspace-files` 已有 `stat/read/readBytes/list/changes`，支持文本分页、字节范围、大小限制与变更订阅。但它是 Typert Remote 服务，读取权限交给所组合的文件系统；**read/stat/readBytes 可读取工作区之外，目录 list 才限制工作区**。这与 OrchMesh 下载只允许本用户 work 目录的边界不同，不能直接把此接口透传给浏览器。[接口与权限说明](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/api/workspace-files/README.md#L27-L58)

官方 documentpreview 提供 Markdown、代码、图片、PDF、HTML、表格和本地 Office 转 PDF，依赖文件资源系统、远程读取、sidebar slots 和 renderer registry。对本项目适合复用其分层思路和具体渲染库，而非直接装一包就声称可工作。[官方预览组件职责](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/client/ui-sidebar-documentpreview/README.md#L10-L40)

建议先实现：只读文件列表 + 有界文本/Markdown/代码预览 + 图片 + PDF + 自包含 HTML 隔离预览 + 任意普通文件下载。Office 和复杂关联资源 HTML 延后。列表、预览和交付卡片共用文件定位与鉴权；前端不暴露宿主路径，后端独立验证越界路径、符号链接及文件类型。由模型可写的文件不能仅凭后缀信任 MIME 或当应用页面直接执行。

## 落地验证边界

以上是源码核对，不是当前模型供应商的 wire-level 验收。思考开关实施后要检查 off/on 的实际请求字段与模型响应，不能以推理区是否隐藏作证。文件功能至少覆盖跨用户访问、路径穿越/链接、缺失文件、过大文件、下载鉴权和 HTML 隔离，以及刷新后交付卡片恢复。此文不主张更换现有认证、前端框架或 Agent Loop。
