# 聊天展示组件选型

> 历史调研资料（2026-10-26），保留当时的候选与验证范围，不作为当前部署或实现说明。当前选型、目录和验收请看 [项目结构](../architecture/project-blueprint.md) 与 [当前架构](../architecture/v0.1-simplified.md)。

核查日期：2026-10-26。面向 React + Vite、FastAPI 自有 HTTP/SSE、Pi 执行工具的 OrchMesh。本文是文档与源码层面选型，未安装依赖、启动浏览器或完成 Pi 端到端验证。

## 结论

建议首版使用 **assistant-ui + ExternalStoreRuntime + 其现成 Thread/Composer/ToolFallback/MarkdownText**，代码高亮按需加 Shiki。继续用 shadcn/ui 做应用外壳、登录、菜单等通用界面。

复用的是聊天交互和渲染，不是新增 Agent Runtime。后端仍是 Pi；不接 assistant-cloud，不引入 Vercel AI SDK 的模型执行层，也不增加 Next.js 服务。`ExternalStoreRuntime` 官方支持外部 Zustand、Redux、Query 等状态与自定义消息转换，组件功能由提供的回调启用。[ExternalStoreRuntime](https://www.assistant-ui.com/docs/runtimes/custom/external-store)

## 候选比较

| 候选 | 可复用内容 | 对本项目的代价 | 判断 |
|---|---|---|---|
| assistant-ui | 聊天线程、输入器、消息操作、滚动、工具卡片、Markdown；可接自有状态和后端 | 需要一个 Pi/Web 事件到消息模型的适配器；高级 API 有 unstable 字段 | 首选，集中处理协议适配，避免散落自研 UI 状态 |
| 新 shadcn/ui AI Elements + Streamdown | 消息、输入器、滚动、Tool/Terminal 等可复制源码，流式 Markdown | 需自己组合会话状态、发送取消、错误与重连协调 | 有效备选，适合高度定制界面 |
| react-markdown + 自组聊天 UI | 成熟 Markdown 渲染，remark/rehype 扩展 | 它不提供会话、工具状态、输入器、滚动或执行生命周期 | 适合简单展示，不作为本项目整套聊天方案 |

assistant-ui 文档区分 `LocalRuntime`（库管理状态）与 `ExternalStoreRuntime`（应用拥有状态）；前者可接一个自定义 run 函数，后者更适合既有服务器持久会话和状态同步约束。[自定义 Runtime 比较](https://www.assistant-ui.com/docs/runtimes/custom/overview)

**维护变化：旧 AI Elements 官网已公告迁移到 shadcn/ui，计划 2026 年 11 月底废弃旧项目。**新项目不要从旧 registry 起步。新的 shadcn AI Elements 是可复制的组件组合，不是必须安装的一整个运行时，也不是必须使用其 Next.js 示例应用。[旧项目公告](https://elements.ai-sdk.dev/)、[新组件与迁移说明](https://ui.shadcn.com/docs/ai-elements)

## 推荐接线方式

```text
Pi 原生事件 → FastAPI 平台事件 → SSE
                                  ↓
                      conversation/run 事件处理模块
                                  ↓
                    当前聊天 Zustand store（唯一活动视图）
                                  ↓
                         ExternalStoreRuntime
                                  ↓
                Thread / Composer / ToolFallback / MarkdownText
```

- TanStack Query：会话列表、用户信息、历史快照与请求缓存。
- Zustand：当前活动消息视图、流式增量、连接状态和应用 UI。历史加载后构建活动视图，Query 缓存只作为快照，不再逐 token 同步两份消息。按会话/运行 ID 路由，切换时丢弃过期事件；结束后刷新快照并对齐活动视图。
- assistant-ui：消费消息与回调，不再创建另一套独立聊天持久化，不把 Pi JSONL 分支复制成独立的前端权威记录。

适配器至少提供稳定 message ID、`isRunning`、`onNew`、`onCancel` 和消息转换；工具通过 `toolCallId` 关联调用与结果。首版不提供 edit/regenerate/branch/queue 回调，从而不暴露后端尚未实现的能力。状态恢复不等于可恢复运行检查点，不能为了出现 Resume 按钮虚报 `canResume`。[外部状态契约](https://www.assistant-ui.com/docs/runtimes/custom/external-store)

工具仍完全由 Pi 执行。保持外部 Runtime 的客户端工具执行选项关闭，避免同一工具在 Pi 和浏览器重复执行。审批控件不是权限系统，未实现服务端审批协议时不开放相应回调。[客户端工具执行默认与限制](https://www.assistant-ui.com/docs/api-reference/external-store/runtime)

ToolFallback 已能展示工具名、参数、结果、运行/失败/取消等状态。工具输出增量可映射成临时结果；Shell 特化视图后续再加，不需要先实现浏览器交互终端。`onCancel` 必须调用后端停止接口，而不是仅断开 EventSource。[ToolFallback](https://www.assistant-ui.com/elements/tool-fallback)

## Markdown：首版复用同一组件体系

assistant-ui 的 Thread 已组合 MarkdownText，支持 GFM、代码块与复制按钮，代码高亮按需接官方 Shiki 组件。它具备随流式消息更新的渲染能力，因此首版不叠加另一套 Streamdown 渲染路径。模型输出图片默认可能请求外部地址，需要配置 URL 策略；不启用不可信原始 HTML。[MarkdownText](https://www.assistant-ui.com/elements/markdown-text)

Streamdown 是流式 Markdown 的成熟候选，提供未闭合 Markdown 处理、代码高亮、CJK/数学/图表插件；可独立消费文本，不意味着必须使用示例中的 AI SDK。若实测 assistant-ui 默认渲染对长代码、中文或半截 Markdown 不理想，再替换 Text renderer，避免同时维护两套。[Streamdown](https://streamdown.ai/)

react-markdown 自身适合安全的 Markdown → React 渲染；其插件、URL 转换和组件覆盖仍会影响安全性，并不等于整套聊天 UI。[react-markdown](https://github.com/remarkjs/react-markdown)

## 许可与版本管理

- assistant-ui：MIT，官方文档与发布记录仍在更新；存在明确标记 unstable 的接口，首版优先用稳定适配器字段并锁版本。[许可证](https://raw.githubusercontent.com/assistant-ui/assistant-ui/main/LICENSE)、[发布记录](https://github.com/assistant-ui/assistant-ui/releases)
- 旧 AI Elements、Streamdown：Apache-2.0；不能因同属 shadcn 生态就一概写成 MIT。[AI Elements 许可证](https://raw.githubusercontent.com/vercel/ai-elements/main/LICENSE)、[Streamdown 许可证](https://raw.githubusercontent.com/vercel/streamdown/main/LICENSE)
- react-markdown：MIT。[许可证](https://raw.githubusercontent.com/remarkjs/react-markdown/main/license)

不按星数宣布生产适配已经完成。实际版本在脚手架时锁定，检查 React/Vite/Tailwind peer dependency，并保留复制组件的许可说明。

## 首个接入验证范围

使用同一套消息样本验证：中文文本分片、未闭合代码块、长 Shell 输出、工具开始/增量/结束、失败/取消、历史加载、切换会话时迟到事件、断线重连、停止后界面状态。再接一次真实 Pi 工具调用，确认前端只展示、不会执行第二遍工具。

验证通过前不宣称现成组件已经解决聊天重连、历史去重、取消或跨用户隔离；这些仍依赖 OrchMesh 后端及适配层。
