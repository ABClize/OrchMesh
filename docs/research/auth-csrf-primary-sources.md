# 认证与 CSRF：官方及成熟项目对照

> 历史调研资料（2026-10-26），保留当时的候选与验证范围，不作为当前部署或实现说明。当前选型、目录和验收请看 [项目结构](../architecture/project-blueprint.md) 与 [当前架构](../architecture/v0.1-simplified.md)。

> 历史调研：2026-10-26 用户已决定采用官方模板 Bearer JWT 方案。当前实现与验收见 `../development/implementation.md` 和根目录 README；本文保留当时的选型证据，不作为当前实现指令。
调研日期：2026-10-26。范围：同源 React + FastAPI、少量受邀用户、服务端可撤销会话。本文只记录来源与适用性判断，不改变代码、依赖或运行服务。`main/master/latest/stable` 是当日页面快照；有标签的证据单独注明，不能把开发分支等同于已发布行为。

## 结论

**保留 CookieTransport + DatabaseStrategy 的方向合理；CSRF 生命周期应选择组件的公开入口，不继续调用下划线内部方法。** “官方模板”也不是唯一认证架构。先固定本项目的浏览器会话、注销撤销、登录 CSRF 和环境隔离要求，再评估方案；不因一次 Cookie 故障改成 JWT 或迁移整个框架。

## 对照结果

| 方案 | 一手证据 | 对 OrchMesh 的意义 |
|---|---|---|
| FastAPI Users | 文档明确拆分 Transport 与 Strategy；Cookie 面向 Web，Database 支持服务端删除令牌撤销。 | 现有选择符合公开组合方式，不必自写密码、会话签发或注销。 |
| FastAPI 官方 full-stack 模板 | 当前前端把 access token 放入 localStorage；后端使用 OAuth2PasswordBearer 及 JWT。 | 是另一种完整取舍，不是当前 Cookie 架构缺少的 CSRF 模块；搬过来会改变令牌存储、撤销与 SSE 认证。 |
| Django 5.2 | 默认数据库会话；内置 CSRF middleware、公开 token/ensure-cookie 接口、Origin/HTTPS Referer 校验，登录轮换 CSRF secret。 | 可作为生命周期完整性的对照，但仅为修复 CSRF 换整个后端成本不成比例。 |
| Datasette 0.65.1 | 标签源码导入 asgi-csrf；stable 文档描述 cookie/header 双重提交。 | 证明 ASGI 独立组件有成熟项目使用，但必须读其默认放行规则。 |
| Datasette 当前 main | 已换成自身的 CrossOriginProtectionMiddleware，采用 Sec-Fetch-Site + Origin，并指向 Go 1.25 标准库方案。 | 是值得评估的无 token 路径，但不能把项目内部模块当成稳定 Python 公共库，也不能说 stable 文档已经采用它。 |

来源：
- [FastAPI Users 认证组合](https://fastapi-users.github.io/fastapi-users/latest/configuration/authentication/)、[Cookie 配置](https://fastapi-users.github.io/fastapi-users/latest/configuration/authentication/transports/cookie/)、[Database 策略](https://fastapi-users.github.io/fastapi-users/latest/configuration/authentication/strategies/database/)。
- [官方模板前端 useAuth](https://github.com/fastapi/full-stack-fastapi-template/blob/master/frontend/src/hooks/useAuth.ts)、[后端依赖](https://github.com/fastapi/full-stack-fastapi-template/blob/master/backend/app/api/deps.py)。
- [Django 5.2 会话](https://docs.djangoproject.com/en/5.2/topics/http/sessions/)、[CSRF 机制](https://docs.djangoproject.com/en/5.2/ref/csrf/)、[AJAX 与公开接口](https://docs.djangoproject.com/en/5.2/howto/csrf/)。
- [Datasette 0.65.1 app.py](https://github.com/simonw/datasette/blob/0.65.1/datasette/app.py)、[stable CSRF 文档](https://docs.datasette.io/en/stable/internals.html#csrf-protection)、[main CSRF 实现](https://github.com/simonw/datasette/blob/main/datasette/csrf.py)、[Go CrossOriginProtection](https://pkg.go.dev/net/http#CrossOriginProtection)。

## FastAPI Users 的维护边界

官网明确标记 **maintenance mode**：继续安全更新和依赖维护，不再增加新功能，并提到未来替代工具。这不等于停止维护，也不构成当前迁移的充分理由；但初次选型说明应披露，升级与安全跟进不能省略。以上是维护者声明，不是本次独立安全审计结论。[官方首页](https://fastapi-users.github.io/fastapi-users/latest/)

## asgi-csrf 的公开接口及限制

公开入口包括 `asgi_csrf(...)`、`scope["csrftoken"]()`、`always_protect`、Cookie 属性以及 `send_csrf_failed` 回调。调用 token 函数会让响应按需设置 Cookie 并增加 `Vary: Cookie`；可以用一个明确的同源 token 获取端点承接 SPA 初始化，而不是由 health 请求隐式承担。[README](https://github.com/simonw/asgi-csrf/blob/main/README.md)

当前源码在签名无效时生成新 token，调用公开 scope 函数后才标记写回。因此 **`always_set_cookie=True` 单独不能保证修复已有的坏签名 Cookie**。库还默认放行无 Cookie 请求，以及带 `Authorization: Bearer ...` 的请求；登录需放入 `always_protect`，后者不会关闭 Bearer 豁免。对 Cookie-only API，必须理解浏览器自定义请求头/CORS 的边界，不可把“没有通过 token 校验就绝不放行”当作库的真实契约。[源码](https://github.com/simonw/asgi-csrf/blob/main/asgi_csrf.py)

这使它成为值得做小范围契约验证的候选，而非可以直接替换并宣称更安全的答案。迁移前必须检查实际发布版，而非只依赖 main。主任务随后通过临时 uv 环境验证了发布版 0.11 的上述行为，未写入项目依赖；结果见 [本地审查](auth-csrf-review.md)。

## 共同的标准边界

- Cookie **不按端口隔离**；同主机的演示、测试与真实实例应当有明确的 Cookie 命名/主机隔离策略。端口不同不是认证环境隔离。[RFC 6265 §8.5](https://www.rfc-editor.org/rfc/rfc6265#section-8.5)
- OWASP 优先建议使用框架已有 CSRF 实现；有状态应用可用同步 token，双重提交应选签名方案，并注意与会话绑定。SameSite 是额外防线，不能直接代替整个 CSRF 设计；登录本身也可能有 CSRF 风险。[OWASP CSRF Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- 同源 SPA 应统一注入安全头，只向可信同源地址发送；不能因为某个请求“是 API”就整体豁免。Django 官方 AJAX 示例明确采用同源请求模式。[Django AJAX](https://docs.djangoproject.com/en/5.2/howto/csrf/#setting-the-token-on-the-ajax-request)

## 建议的决策顺序

1. 保持现有用户数据库与 Cookie 会话；把新建会话、注销撤销、多设备、SSE 会话复查列为不变契约。
2. 明确开发/演示与真实实例的 Cookie 隔离、稳定 secret 和 token 获取入口；先处理归属与生命周期。
3. 对候选 CSRF 公共 API 做短小契约验证：缺失/坏签名、多个标签页、重启、注销、跨源表单、自定义 Bearer 头及缓存行为。
4. 只有候选在这些边界通过后，才替换现有私有方法适配；否则记录缺口并向上游寻求公开扩展点，而不是再增加一层中间件补丁。
