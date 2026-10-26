# 文件交付、工作区预览与模型思考设置建议

> 2026-10-26 后续修订：本文保留早期调研记录。新交付已改用官方 present，旧自定义工具已移除；当前实现以 [DSH 执行层](../architecture/dsh-runtime.md) 和 [复用审查](dsh-official-reuse-audit.md) 为准。

调研日期：2026-10-26。仅调研和方案，不修改应用代码、不安装依赖。
DSH 固定版本的能力核查见 [DSH 模型与文件能力](dsh-model-and-delivery.md)。

## 结论

保留 FastAPI + React + assistant-ui + 每用户 Docker。复用上游工具注册、消息渲染、文件响应及 UI 基础组件，平台只补模型偏好、文件归属和交付协议。无需迁移到另一个聊天框架或新增文件服务器。

## 可复用方案及边界

| 领域 | 复用 | 项目仍需实现 |
|---|---|---|
| 交互参照 | Open WebUI File Browser：目录、预览、下载、聊天交付卡片共用文件访问 | 当前 React UI 与鉴权集成，不能把完整 Open WebUI 当 React 组件安装 |
| 工具卡片 | 已安装 assistant-ui GroupedParts 的 `tools.by_name` / 现有 tool-call 展示分支 | 为拟新增 `present_files` 渲染文件卡片，执行仍由 DSH 完成 |
| 文件列表 | shadcn 官方 File Tree 的 Collapsible + Button 示例；面板用 Resizable/Sheet | 按需加载目录、选中状态、空态/错误态与刷新 |
| 文件下载 | FastAPI/Starlette FileResponse 的 filename、attachment、Range/ETag | 用户归属、路径约束、鉴权、配额/大小限制 |
| Markdown/代码 | 已有 @assistant-ui/react-markdown 与代码展示组件 | 文件内容接口与本地图片/链接解析；不要自动启用原始 HTML |
| HTML | Open WebUI 的 sandbox iframe 模式 | 受限 CSP、禁用同源权限，默认静态预览 |
| PDF/图片 | 浏览器原生显示；需要统一分页时再考虑 PDF.js | 带鉴权获取 Blob、大小限制与资源释放 |

来源：
- [Open WebUI File Browser](https://docs.openwebui.com/features/open-terminal/file-browser/)：文件卡片共用预览/下载与用户访问权限，引用的是文件而非公共链接。
- [assistant-ui MessagePrimitive](https://www.assistant-ui.com/docs/api-reference/primitives/message)、[工具渲染](https://www.assistant-ui.com/docs/api-reference/tools/rendering)：最新文档已弃用 makeAssistantToolUI；当前项目本地 `@assistant-ui/react/dist/primitives/message/MessagePartsGrouped.d.ts` 已支持 `tools.by_name`。因此可用现有渲染入口，不必为此迁移全部工具至新 Toolkit。
- [shadcn File Tree](https://ui.shadcn.com/docs/ai-elements/radix/file-tree)、[Resizable](https://ui.shadcn.com/docs/components/radix/resizable)：文件树是基于基础组件的官方组合示例，不是附带后端的文件管理器。
- [Starlette FileResponse](https://www.starlette.io/responses/#fileresponse)：负责标准文件传输，不负责业务权限。
- [Open WebUI Artifacts](https://docs.openwebui.com/features/chat-conversations/chat-features/code-execution/artifacts/)：sandbox 与额外 CSP 的职责独立。

## 建议的数据流

1. DSH 在 `/workspace` 生成文件，调用拟新增的 `present_files({files:[{path,label?}],summary?})。只返回受约束的相对路径和显示元数据，不把整个文件/base64 塞入模型上下文。
2. 工具的 `output.render` 必须把结构化文件描述写入可恢复的 Session 内容；仅从 execute 返回对象并不足够。前端按工具名显示交付卡片。历史重放同样能恢复卡片，无需单独发一种脆弱的临时 SSE 消息。
3. 文件列表和卡片都调用同一文件访问模块。列表按用户共享工作区组织，不假装每个对话已有独立工作区。
4. 打开文件 → 同一预览面板；下载 → 同一鉴权文件接口。任务结束容器被移除后，FastAPI 仍可读取宿主机持久化的用户 work 目录，不必启动 DSH 才能查看报告。

第一版交付是“当前文件的引用”，不是不可变附件快照。文件被修改后卡片显示最新内容，被删除后显示不存在；UI 要明确这一点。暂不增加 artifact 表、对象存储或版本系统；未来需要固定交付版本再引入快照。

## 必须在适配层处理的细节

- 当前 API 使用 Bearer JWT。普通 a/img/iframe URL 不会自动带 Authorization。有限大小文件先通过现有鉴权客户端取得 Blob，再用 object URL 展示/下载，关闭时 revoke；不把 JWT 放 query string，也不重新引入 Cookie 登录。
- 预览设置大小上限，文本只读且可截断，超限给下载。大文件避免一次性 Blob；确有需求再增加短时、单文件授权的下载机制，第一版明确限制。
- 用户根目录只能由登录身份计算，路径限定在 work 内；文件名不视为可信。防止 `..`、绝对路径、符号链接越界，以及 Agent 在检查后替换路径的竞态。实现时用可靠的目录句柄/禁止跟随符号链接方式访问，不仅检查字符串前缀。
- HTML 默认禁脚本、表单和网络，允许受限的内联样式和图片；不授予 allow-same-origin。自包含报告优先。需要 JS 图表时再单独开放受隔离脚本预览。CSP 不用 `connect-src` 一项冒充所有网络限制。
- 本地 Markdown 图片、链接必须重新走同一鉴权文件接口；不能直接让模型提供的路径或远程 URL 获得平台身份。
- 列表初版按目录加载，工具结束/任务结束使 TanStack Query 缓存失效，另有手动刷新；Shell 也能创建文件，不能只监听 write 工具。确有持续同步需求再加有界轮询或文件监听。

## 暂不引入的方案

- assistant-ui [safe-content-frame](https://www.assistant-ui.com/safe-content-frame) 提供每次渲染独立 origin，默认依赖 `*.scf.auiusercontent.com`。它是可选方案，但当前本机自包含报告只需标准 sandbox，暂不增加外部预览域依赖。
- 不嵌入 DSH 全套 Web UI，不增加第二套认证；DSH 的 SDK 插件能力与现有 FastAPI 权限边界配合即可。
- 不引入 Monaco、在线 Office、完整文件管理器。第一版支持文本/代码、Markdown、图片、HTML、PDF，其他类型下载；CSV 可先查看源码，表格预览随后复用成熟解析器。

## 落地顺序与验收

1. 文件模块 + 用户归属和路径边界测试；复用 FastAPI 当前 JWT。
2. 工作区列表 + 共用预览/下载，直接用复杂任务产出的 CSV/HTML/README 验收。
3. DSH `present_files` + assistant-ui 卡片；验证生成、刷新后历史重放、停容器仍可下载、文件失效提示。
4. 模型能力元数据 + 会话级思考设置；依据 DSH 支持的 effort 显示选项，并验证恢复历史后配置仍正确。未知网关不显示未经验证的关闭开关。

验收还应覆盖：另一用户不可读取、路径逃逸和符号链接、HTML 无法访问父页面或任意联网、JWT 失效、超大文件、Unicode 文件名、思考关闭的真实请求参数。以上是建议，尚未实现或动态验证这些新能力。
