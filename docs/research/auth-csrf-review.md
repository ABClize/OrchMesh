# OrchMesh 登录与 CSRF 审查

> 历史调研：2026-10-26 用户已决定采用官方模板 Bearer JWT 方案。当前实现与验收见 `../development/implementation.md` 和根目录 README；本文保留当时的选型证据，不作为当前实现指令。
日期：2026-10-26。范围：当前源码、已安装 FastAPI Users/starlette-csrf、官方资料与一个临时公共 API 验证。仅研究与审查，未修改运行代码、数据库、凭据或依赖锁文件，未重启服务。外部对照见 [一手资料](auth-csrf-primary-sources.md)。这不是完整的渗透测试或安全认证。

## 决策

**保留 FastAPI Users + CookieTransport + DatabaseStrategy；停止扩展 RefreshingCSRFMiddleware。下一次实现应统一认证边界，并用已验证的公开接口替换 CSRF 私有方法适配。** 不因本次问题迁移 Django、增加独立身份服务，或改为 localStorage JWT。

当前认证复用公开 API，已有密码哈希、独立多会话、服务端注销撤销以及 SSE 会话复查。FastAPI Users 处于维护模式，需跟进安全更新；这不是本次登录失败的原因。官方模板与 Django 的架构差异详见资料对照。

## 当前实现发现

| 优先级 | 证据 | 判断与处理方向 |
|---|---|---|
| 高 | `auth.py:18` 固定登录 Cookie；`main.py` 固定 CSRF Cookie；`tests/browser_app.py` 复用同一 app factory，但使用临时数据及另一个 secret | 同主机不同端口的实例可相互覆盖两类 Cookie。先定义环境级命名，或使用不同主机；不能只区分端口。开发前后端属于同一实例，应共享该实例命名。 |
| 高 | `csrf.py:22,29` 调用 `_csrf_tokens_match`、`_generate_csrf_token`，并接管响应钩子 | 私有 API 耦合，当前回归通过不代表升级契约稳定。应删除整个定制刷新子类，不继续增加分支。 |
| 中 | `apps/web/src/lib/api.ts:21` 登录前请求 health；同文件两套 Cookie 解析/请求头注入 | CSRF 初始化职责隐含在健康检查中，登录走独立 fetch 路径。统一前端认证客户端，提供显式、不可缓存的 token 获取入口。 |
| 中 | 当前签名 token 独立于登录会话，登录/退出不触发 CSRF 生命周期变化；没有 Origin/Referer 校验 | 不等于已证明可利用，但不能宣称符合 OWASP 推荐的会话绑定双重提交。下一方案需说明具体威胁模型与防线，不能只说“签名了就标准”。 |
| 保留 | 登录和业务写请求均受 CSRF 检查，CookieTransport 默认 HttpOnly、无 Domain、SameSite=Lax；退出删除当前 token | 不关闭登录 CSRF、不用 JWT 绕开现有会话需求。生产 HTTPS 使用 Secure；本机 HTTP 配置单独保留。 |

Cookie 不按端口隔离是协议行为，而非框架 bug。[RFC 6265 §8.5](https://www.rfc-editor.org/rfc/rfc6265#section-8.5)

此前实际浏览器故障已证实是 403 CSRF 校验失败；旧 token 恢复后同一输入登录成功。演示环境是可信的可能来源，但没有保存当时 token 的来源证据，不能断言它就是唯一来源。

## 公共 API 候选验证

### asgi-csrf：首选继续验证的窄范围候选

Datasette 发布标签有采用记录；其公开 `scope["csrftoken"]()` 能承担稳定 token 获取与坏签名恢复，不必覆盖内部方法。明确使用持久 secret、环境 Cookie 名、`always_protect` 登录路径和公开错误回调。响应 `Cache-Control: no-store`，由库处理 `Vary: Cookie`。[公开接口](https://github.com/simonw/asgi-csrf)

在临时 uv 环境执行 `asgi-csrf==0.11` + 当前 FastAPI/httpx 的最小应用，观察结果：

- 无 Cookie 的登录缺 token → 403。
- 已有坏签名 Cookie → 调用公开 token 端点后更新，合法请求成功。
- 再次读取 token 不轮换，避免普通多标签页请求互相失效。
- 带 Cookie 但缺 token 的登录 → 403。
- **加入任意 `Authorization: Bearer ...` 后无需 token 即放行。** 这是库的默认契约，`always_protect` 不关闭它。

因此不能直接替换后宣称它与现有中间件等价。目前无跨源 CORS 放行，攻击页面不能任意发送自定义授权头；上述结果并非已证明的浏览器攻击。若采用该库，应明确 Cookie-only API 对混合认证请求的处理，验证 CORS 和跨源边界，不靠新增私有方法补丁改变库语义。

### 其他方向

- `fastapi-csrf-protect` 有公开生成、设置、验证、清除函数，但示例的每次生成/清除模式不能照搬成 SPA 的每请求轮换；全局配置及多标签页并发仍需验证。本次只读源码，未安装验证。[官方示例](https://github.com/aekasitt/fastapi-csrf-protect)
- Datasette main 的 Fetch Metadata + Origin 方案体现另一条标准路线，但它是项目内部实现，不能直接复制成我们的“成熟依赖”。发布版与 main 不能混用作为依据。[当前源码](https://github.com/simonw/datasette/blob/main/datasette/csrf.py)
- Django 的会话、CSRF、Origin 校验和登录轮换更完整，可作为审查参照；为当前小范围问题整体迁移并不划算。[官方机制](https://docs.djangoproject.com/en/5.2/ref/csrf/)

## 下一次实现的验收契约

1. 正式/演示实例并行访问，不互相覆盖登录与 CSRF Cookie；同一真实实例的开发代理不被人为拆开。
2. 登录、退出、业务写操作都拒绝不合格 CSRF 请求，不能只保护业务路由。
3. 缺失/失效 token 能通过明确的安全读取恢复；获取响应不缓存，不向跨源页面公开 token；不要自动重放可能已执行的业务写请求。
4. 多标签页、多浏览器独立会话可用；登录身份切换、退出、稳定 secret 重启与显式 secret 轮换行为有测试。
5. 跨源表单、Origin/null Origin、Fetch Metadata 缺失、Bearer 与 Cookie 混合请求的允许/拒绝策略明确；不能靠 SameSite 单独代替 CSRF。
6. 保留 SSE 注销撤销检查，区分 401、403、429 和网络/服务器错误，前端集中处理。
7. 新实现全程只调用已记录的公开 API；通过实际浏览器及后端回归后，删除旧子类和旧依赖，而非让两套防护长期并存。

会话绑定、同源策略及现有实现优先原则参考 [OWASP CSRF Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)。这里只定义范围内的契约，没有把候选原型通过夸大为项目迁移完成。
