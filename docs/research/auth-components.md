# 认证组件调研与首版选型

> 历史调研资料（2026-10-26），保留当时的候选与验证范围，不作为当前部署或实现说明。当前选型、目录和验收请看 [项目结构](../architecture/project-blueprint.md) 与 [当前架构](../architecture/v0.1-simplified.md)。

> 历史调研：2026-10-26 用户已决定采用官方模板 Bearer JWT 方案。当前实现与验收见 `../development/implementation.md` 和根目录 README；本文保留当时的选型证据，不作为当前实现指令。
核查日期：2026-10-26。场景：FastAPI、SQLite、管理员为本人和少量熟人开通账号；同源 Web 页面和 API，需要可撤销的登录会话。本文是文档/源码核查，未安装或运行组件。

## 结论

首版建议 **FastAPI Users + SQLAlchemy adapter + CookieTransport + DatabaseStrategy**，复用其登录、退出、当前用户依赖和密码处理。接受其明确的维护模式，固定经测试版本；不要写成正在快速增加功能的项目。数据库模式的会话可删除撤销，比额外维护 JWT 撤销表更贴合需求。[项目声明](https://github.com/fastapi-users/fastapi-users)、[认证策略](https://fastapi-users.github.io/fastapi-users/latest/configuration/authentication/)

CSRF 与限流必须补充：CSRF 建议先验证 `starlette-csrf`，通过当前依赖组合测试后采用；登录限流复用 `limits` 的异步算法/存储，由应用依赖或中间件接入。组件不会替平台完成会话、文件和执行记录的 owner 授权。

## 候选比较

| 候选 | 第一方证据 | 对 OrchMesh 的判断 |
|---|---|---|
| FastAPI Users | 已进入 maintenance mode，继续安全与依赖维护、停止新增功能；最新发布 v15.0.5（2026-03-27）更新依赖 | 首版需求已由现成功能覆盖，可以采用；隔离在 auth 模块，未来替换不扩散 |
| Authlib | Python OAuth/OIDC 客户端与服务端工具库；最新发布 v1.9.1（2026-10-14） | 未来接现有身份提供商时适用；不能把它当成本地账号、密码和会话管理的现成全集 |
| Fief | 官方声明当前代码不再增加功能或修复 bug | 不作为新项目首选 |
| Keycloak | 独立身份服务，提供管理员创建账号、realm 等能力 | 若已有 Keycloak 可以复用；为几位熟人另加身份服务增加部署负担，首版不新增 |

来源：[FastAPI Users 发布](https://github.com/fastapi-users/fastapi-users/releases/tag/v15.0.5)、[Authlib](https://github.com/authlib/authlib)、[Authlib 发布](https://github.com/authlib/authlib/releases/tag/v1.9.1)、[Fief 停止维护声明](https://github.com/fief-dev/fief)、[Keycloak Docker 入门](https://www.keycloak.org/getting-started/getting-started-docker)。版本日期来自对应官方 GitHub Releases API；并非已安装版本。

## 直接复用的组合

- 使用 `fastapi-users[sqlalchemy]`，SQLite 通过 `aiosqlite` 驱动接入 async SQLAlchemy。官方数据库策略示例已经采用该组合。[DatabaseStrategy](https://fastapi-users.github.io/fastapi-users/latest/configuration/authentication/strategies/database/)
- `CookieTransport` 设置 HttpOnly、生产 Secure、明确 SameSite、Path 和有效期；应用保持同源。浏览器 EventSource 可以自然携带同源登录 Cookie。[Cookie 配置](https://fastapi-users.github.io/fastapi-users/latest/configuration/authentication/transports/cookie/)
- `DatabaseStrategy` 生成随机不透明 token，存储 token、用户 ID 和创建时间；退出通过删除 token 撤销。**默认实现保存原始 token，并非数据库内哈希 token**，平台数据库及备份必须保持私有，不能宣称自带 token 哈希保护。[数据库策略源码](https://github.com/fastapi-users/fastapi-users/blob/v15.0.5/fastapi_users/authentication/strategy/db/strategy.py)
- 密码处理复用默认 `pwdlib` 和 Argon2，并利用库的密码哈希升级机制；不自写哈希算法或登录 JWT。[密码文档](https://fastapi-users.github.io/fastapi-users/latest/configuration/password-hash/)
- 仅挂载登录/退出及必要的当前用户接口。管理员命令通过 `UserManager.create()` 创建账号，不暴露公开注册、邮件验证、忘记密码等首版不需要的路由。官方提供程序化创建用户示例。[创建用户](https://fastapi-users.github.io/fastapi-users/latest/cookbook/create-user-programmatically/)

数据库的 `login_sessions` 可以是平台对库 AccessToken 模型的名称，不再维护第二张重复的会话表。所有归属关系使用平台 user ID，业务模块通过一个当前用户依赖获取身份。

## CSRF 不能误认为已经内置

FastAPI Users 的认证说明明确提示 Cookie 方式仍需要 CSRF 保护。其 OAuth 流中的 CSRF 防护也不等于保护所有业务 POST 请求。[认证说明](https://fastapi-users.github.io/fastapi-users/latest/configuration/authentication/)

`starlette-csrf` 提供签名 Double Submit Cookie 的纯 ASGI 中间件，可配置 CSRF Cookie 与请求头、需要保护的 URL、Cookie 属性。它采用 MIT 许可；v3.0.0 的声明依赖为 Python >=3.8、Starlette >=0.14.2、itsdangerous >=2.0.1,<3.0.0。[源码及配置](https://github.com/frankie567/starlette-csrf)、[版本依赖](https://github.com/frankie567/starlette-csrf/blob/v3.0.0/pyproject.toml)、[许可证](https://github.com/frankie567/starlette-csrf/blob/v3.0.0/LICENSE)

维护边界：最新 release v3.0.0 是 **2023-07-24**，发布频率低；不能以版本约束宽松推断当前 FastAPI、Starlette、Python 3.12 已兼容。作为窄功能组件优先进行安装解析与行为验证，未通过则重新选择，不能静默降级为仅 SameSite。[发布页](https://github.com/frankie567/starlette-csrf/releases/tag/v3.0.0)

接入建议：初始化时通过安全 GET 建立 CSRF Cookie；客户端写请求带对应 header。认证 Cookie 为 HttpOnly，CSRF Cookie 按中间件设计供前端读取，二者用途不同。保护登录、退出、发送消息、取消执行等写操作，包括尚未登录的登录 POST；不要仅在已有认证 Cookie 时才校验。生产显式设 Secure/host-only Cookie；GET/SSE 只读。测试子域、缺失/错误 token 与跨站请求，不自写密码学签名。

## 平台仍需实现的少量规则

1. owner 检查：认证通过不意味着能读取他人的聊天、文件或控制他人的 Pi。
2. 登录限流：利用 `limits` async MemoryStorage 和算法，单应用进程内限制登录尝试；计数会在重启时清空，多进程部署必须更换共享存储。只信任配置过的代理地址头，避免客户端伪造 IP。具体限流参数在实现时配置。[limits 异步文档](https://limits.readthedocs.io/en/stable/async.html)
3. 会话过期与撤销：明确设置服务端 token lifetime；管理员禁用账号/改密时删除现有会话。不能假设改密码自动撤销所有 DatabaseStrategy token。
4. 已建立的 SSE：登录过期/撤销不会自动关掉已经通过鉴权的长连接；应用须定义过期检查或主动关闭行为。已启动 Pi 任务是否继续与登录撤销分开处理。
5. 避免输出密码、Cookie、token 或完整认证请求体到日志。

## 开工前验收

固定依赖组合后验证：管理员开账号、正确/错误密码、Cookie 属性、CSRF 缺失及伪造、退出后旧 token 不可用、禁用账号、过期会话、用户间越权、登录限流与同源 SSE。验证通过后锁定依赖，持续关注上游安全更新。

本轮没有运行密码验证、Cookie/CSRF 集成或真实浏览器测试；采用建议不等于认证方案已通过安全验收。
