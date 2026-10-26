# OrchMesh 界面设计规范

## 方向与来源

以 [AffectUI](https://github.com/flohoeller/affectui) 的中性色、细边框、轻阴影和微动效为基准，直接使用它的开源组件。本文为 OrchMesh 的适配规范，并非 AffectUI 官方 DESIGN.md。参考过 [awesome-design-md](https://github.com/VoltAgent/awesome-design-md) 的规范形式，不混用其他品牌视觉。

## 组件职责

- AffectUI `button-clean`：登录、新建对话、开始对话；保留其加载、内容切换和焦点效果。
- AffectUI `profile-menu`：放在 shadcn Popover 中，由侧栏底部账户按钮打开；不常驻展示大卡片，不传入演示设置项。
- AffectUI `tool-call-card-clean`：真实工具运行、完成、错误、计时与详情展开；不接不存在的重试功能。审批与无法表达的中断状态回退原渲染器。
- AffectUI `text-reveal`：首页标题逐字入场，25ms 间隔、500ms 过渡；尊重 reduced-motion。
- AffectUI `thinking-loader`：连接和任务运行提示；由实际运行状态控制，不自动轮播虚构的工具步骤。
- shadcn/ui：表单、提示、对话列表与图标按钮。沿用现有 Radix 基础。
- assistant-ui：消息、输入框、流式渲染、工具展示、滚动、停止和复制。视觉适配在组件层，状态仍由原适配器负责。

## 基础规范

| 角色 | 规范 |
| --- | --- |
| 页面 | `--background: #fcfcfc` |
| 侧栏和外壳 | `--sidebar: #f5f5f5` |
| 浮起表面 | `--card` 白色，轻微阴影 |
| 边框 | `--border: #e7e7e7`，1px |
| 次要文字 | `--muted-foreground: #696969` |
| 主操作 | AffectUI Clean 黑色按钮；次操作白色，导航使用安静的灰色 |
| 字体 | 本地 Geist，中文依次回退 Noto Sans CJK SC、系统字体；AffectUI 继承同一字体 |
| 标题 | 24–32px，500 字重；正文与控件以 14–16px 为主 |
| 间距 | 4px 基础步长，主要区块 16–24px |
| 圆角 | 控件保持原组件尺度，输入区 16px，工作区面板 20px |
| 动效 | 只用于状态变化；遵循 reduced-motion，不添加循环装饰动画 |

主题颜色以 `apps/web/src/index.css` 为单一入口。保留已有深色 token 与 AffectUI 深色兼容；当前没有提供主题切换入口，不能据此宣称深色模式已验收。

## 布局与交互

桌面侧栏默认 244px，可通过官方 Resizable 拖动到 180px 至窗口宽度的 35%，品牌与新对话按钮都放在侧栏；内容区顶部只显示当前上下文。聊天内容限制为 44rem。首页直接复用 assistant-ui 输入框；首次发送时创建对话并提交任务，失败重试保留已创建的对话，登录状态改变后不继续提交。快捷提示只填入草稿，不直接执行。小于 768px 时通过顶部按钮在对话列表和聊天区之间切换；选中或新建对话后回到聊天区。长标题截断，但消息正文正常换行。所有操作具有可访问名称与可见焦点；运行时保留原有禁止切换对话规则。

## 来源与维护

组件于 2026-10-26 通过项目 shadcn CLI 从 `https://www.affectui.com/r/{name}.json` 引入，命名空间记录在 `apps/web/components.json`。许可证见 `docs/design/affectui-LICENSE.txt`。

本地适配：Prettier 格式化；ProfileMenu 使用 `Array.from` 读取 NodeList，以兼容项目当前 TypeScript DOM 配置；字体和账户卡颜色通过共享样式变量适配。其余组件代码保留来源结构。更新时先预览差异，不覆盖这些适配。

## 边界

AffectUI 的 Chat Composer 和完整应用页面属于 Pro，不在公开仓库中，本项目未引入。组件更新不能引入假的模型选择、附件、反馈、重试或其他尚未支持的操作。可读性、键盘操作和真实运行状态优先于展示效果。

## 本次验证（2026-10-26）

- 生产构建、ESLint、Prettier、`git diff --check` 通过。
- 第一轮：前端 10 项测试通过；后端 28 项通过、1 项 Docker 测试跳过。
- Codex 内置浏览器：管理员登录、账户退出、新建明确标记的验收对话、真实模型与 Shell 输出、运行提示随完成消失，均通过。
- 1280px 与 375px 页面宽度等于可滚动宽度，无横向溢出；窄屏列表切换和选中返回通过；控制台未发现 error。
- 截图位于忽略目录 `.data/acceptance/affectui-workspace.png` 与 `affectui-mobile.png`。
- 未重新验收停止、运行中刷新、深色模式；构建仍提示聊天 chunk 超过 500kB。


## 第二轮修订与验证（2026-10-26）

依据用户对布局、动画与组件组合的反馈，实际对照 AffectUI Assistant Home 公共演示，移除独立欢迎页和常驻账户卡。当前公开参考：https://www.affectui.com/screens/assistant-home 。只查看公开演示，未获取或仿称使用其 Pro 源码。

- 首页直接输入、提示填入草稿、首次发送自动创建对话、真实工具卡运行计时与完成展开已在内置浏览器验证。
- 账户弹层可打开，窄屏侧栏可开关；375px 无横向溢出。控制台无 error。
- 构建、ESLint 和 14 项前端测试通过，包括首条发送失败复用会话、创建失败不发起执行、登录改变阻止提交。
- 本轮停止验收发现异常：工具返回 `Command aborted`，但最终页面提示“模型调用失败”。该问题随后已在后端终态归并处修复并通过真实模型复测，详见 `docs/development/implementation.md` 的停止修复记录。
- 截图：`.data/acceptance/affectui-v2-home.png`、`affectui-v2-mobile.png`。深色与运行中刷新未在本轮验收；构建仍有共享聊天 chunk 超过 500kB 的提示。

## 工作台布局（2026-10-26）

桌面端使用 shadcn Resizable 分隔聊天与工作区，保持聊天组件挂载；工作区包含常驻目录区和 Radix Tabs 文件预览。文件完整路径作为标签身份，同名异目录文件不合并，重复打开定位已有标签。关闭当前文件选中相邻标签；收起面板保留标签与目录，账户界面卸载时清空，刷新不持久恢复。

768–1199px 打开工作区时自动收起会话导航，可用聊天顶部按钮展开。小于 768px 用 Sheet 展示同一工作区组件。下载、文件归属、预览策略、DSH 交付协议均保持不变。


## 侧栏项目与会话操作

项目/会话行使用统一“⋯”菜单，复用 shadcn DropdownMenu。项目重命名及会话移动使用 Dialog，移动目标排除归档项目并提供默认工作区。对话框明确移动只改变分组，不搬迁文件；当前会话所属项目与工作目录不同时在聊天顶部提示原目录。归档项目有独立列表与恢复入口，不删除项目或改写子会话自己的归档状态。
