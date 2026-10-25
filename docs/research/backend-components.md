# 后端基础组件调研

日期：2026-10-26。范围：单机、一个 FastAPI 应用进程、SQLite、Pi RPC、少量熟人。以下为官方文档/源码核查与选型建议，未安装依赖或完成集成测试。

## 推荐组件

| 能力 | 推荐 | 复用边界 |
|---|---|---|
| HTTP、校验、页面托管 | FastAPI + Uvicorn + Pydantic | 用框架路由、依赖、响应与错误校验 |
| 配置 | pydantic-settings | 环境变量/配置加载和类型验证 |
| SSE 编码 | FastAPI 原生 `fastapi.sse` | EventSourceResponse、ServerSentEvent；锁定具备该接口的版本 |
| ORM/驱动 | SQLAlchemy 2.x async + aiosqlite | SQLite 短事务；每个并发任务独立 Session |
| 迁移 | Alembic | SQLite batch migration，生产启动前单独执行迁移 |
| 登录限流 | limits 的 async 内存后端 | 算法和计数复用库；平台补路由绑定、key、429 响应 |
| 进程与并发 | Python asyncio | create_subprocess_exec、Queue、Semaphore、任务取消 |
| 容器执行 | Docker CLI `exec -i` | 复用引擎而非自研 sandbox；不分配 TTY |
| API 类型与客户端 | FastAPI OpenAPI → openapi-typescript + openapi-fetch | 生成 REST 类型，避免手写两套请求模型 |
| 运维日志 | logging + journald/容器日志 | 标准日志和轮转，不新增日志平台 |

## SSE：优先内置能力，明确没有自动解决什么

FastAPI 文档标注 SSE 在 0.135.0 加入，支持事件 data/event/id/retry/comment；本项目优先使用该接口，不默认再加 sse-starlette。实现时锁定并验证兼容版本。现有基础代码已经不存在，因此没有维持旧版接口的包袱。[官方 SSE 教程](https://fastapi.tiangolo.com/tutorial/server-sent-events/)

该响应类型并不等于完整事件基础设施：平台仍负责空闲心跳、有界缓冲、Last-Event-ID 对齐、慢客户端处理、鉴权和退出后的连接关闭。SSE 连接关闭只能释放订阅，不取消 Pi 任务。需要在实现验证中确认写入超时/慢客户端行为；仅当原生响应确实缺少所需能力时再评估 sse-starlette，不并用两套。[FastAPI SSE 源码](https://github.com/fastapi/fastapi/blob/master/fastapi/sse.py)、[sse-starlette](https://github.com/sysid/sse-starlette)

使用 FastAPI lifespan 创建并关闭 Pi 管理器、数据库引擎和订阅资源。不要将长期执行所有权放在某个请求中，也不要用 BackgroundTasks 冒充可靠队列。[lifespan](https://fastapi.tiangolo.com/advanced/events/)

## 数据库与认证组合

SQLAlchemy async 提供 AsyncSession，但同一个 Session 不能被多个并发任务共享。每次操作创建短生命周期 Session；不要把数据库事务挂在整段模型执行或 SSE 流上。[SQLAlchemy async](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html)

aiosqlite 使用线程包装 SQLite 操作，不会让 SQLite 变成多写者数据库。仍需短事务、合理 busy timeout、外键启用和写入冲突测试。[SQLite dialect](https://docs.sqlalchemy.org/en/21/dialects/sqlite.html)

调研时 SQLAlchemy 官方已将 2.1 列为当前版本、2.0 列为维护版本；不要把“SQLAlchemy 2”误解为固定旧 2.0。选择与认证适配器兼容、实际通过验证的 2.x 版本，不在文档阶段宣称已通过兼容验证。[发布状态](https://www.sqlalchemy.org/download.html)

SQLite 某些 schema 修改需要重建表，Alembic batch 模式用于处理这种迁移；自动生成后仍需检查约束、数据保留和回滚边界。[Alembic batch](https://alembic.sqlalchemy.org/en/latest/batch.html)

## 限流、进程与容器

limits 有 async 内存、Redis 等存储。首版使用内存后端，进程重启计数会丢失，多个实例也不会共享。它只负责请求频率；每用户一个活动执行和全局并发上限由执行管理器负责。登录建议同时考虑 IP 和账号维度，代理地址仅信任已配置入口。[limits async](https://limits.readthedocs.io/en/stable/async.html)

SlowAPI 是 limits 的 FastAPI/Starlette 包装，要求 endpoint request 参数等绑定规则。这里选择直接用 limits 配一个小的 dependency/middleware，便于覆盖认证库生成路由；不自己编写限流算法。[SlowAPI README](https://github.com/laurentS/slowapi)

Python 标准库已经能异步启动进程、读写管道；按参数数组调用 `docker exec -i <server-mapped-container> pi --mode rpc ...`。JSONL 使用非 TTY 管道，持续读取 stdout/stderr，处理大小限制、期限与退出。不要引入同步 Docker SDK 阻塞事件循环，也不要为了少量 exec 操作自研 Docker Engine 协议。[Python 3.12 subprocess](https://docs.python.org/3.12/library/asyncio-subprocess.html)、[Docker exec](https://docs.docker.com/reference/cli/docker/container/exec/)

停止本地 docker CLI 子进程不等于容器内的 Pi/派生 Shell 已停止；异常回收需要检查并停止实际容器内执行，首版一用户一活动执行使必要时重启用户容器可行。此行为需要真实容器实验，不能从文档推断为已经可靠。

## API 契约

openapi-typescript 生成类型，openapi-fetch 消费这些类型发请求；与 TanStack Query 配合即可，无需再叠 Axios 或手写 HTTP SDK。生成的 TypeScript 类型不执行运行时校验，也不自动解释 SSE：事件应有 Pydantic 契约、明确输出为可生成的 JSON Schema/OpenAPI 定义，并通过契约测试验证适配器。[openapi-fetch](https://openapi-ts.dev/openapi-fetch/)

本次不新增通用 Repository 框架、全局重试中间件或事件总线。特别是不自动重试创建执行、写文件等可能产生副作用的业务操作。

## 合并前验证

依赖解析与锁定；Cookie 登录/退出及 CSRF；数据库迁移；SSE 心跳/重连/慢消费者；两用户归属和容器隔离；取消后无遗留进程；服务重启中断态；生成客户端与真实 API 契约。HTTPX ASGI 测试与 Playwright 浏览器验收分开记录，真实流式/进程行为不能仅凭内存 ASGI 测试通过就算完成。
