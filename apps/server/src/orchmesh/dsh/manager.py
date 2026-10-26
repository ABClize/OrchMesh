import asyncio
import time
import uuid
from collections import deque
from copy import deepcopy
from dataclasses import dataclass, field
from functools import wraps

from sqlalchemy import select, update

from ..config import Settings
from ..logging import failure, logger
from ..storage import Database, Run
from .containers import Containers
from .events import Adapter, history
from .messages import Messages
from .navigation import Navigation
from .rpc import RPC


class Busy(Exception):
    pass


def serialized_host(method):
    """Serialize host lifecycle operations without blocking live agent work."""

    @wraps(method)
    async def call(self, user_id, *args, **kwargs):
        async with self.host_locks.setdefault(user_id, asyncio.Lock()):
            return await method(self, user_id, *args, **kwargs)

    return call


@dataclass
class UserHost:
    rpc: RPC
    expires: float


@dataclass
class Execution:
    id: uuid.UUID
    user_id: uuid.UUID
    conversation_id: str
    projection: Messages = field(default_factory=Messages)
    adapter: Adapter = field(default_factory=Adapter)
    status: str = "running"
    error: str | None = None
    sequence: int = 0
    events: deque = field(default_factory=lambda: deque(maxlen=256))
    changed: asyncio.Event = field(default_factory=asyncio.Event)
    settled: asyncio.Event = field(default_factory=asyncio.Event)
    ready: asyncio.Event = field(default_factory=asyncio.Event)
    rpc: RPC | None = None
    task: asyncio.Task | None = None
    reasoning: str = "default"
    stopping: bool = False
    finished: bool = False
    review_tools: bool = False
    control_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    admissions: int = 0
    activity_state: dict | None = None

    def emit(self, data: dict):
        self.sequence += 1
        self.events.append((self.sequence, deepcopy(data)))
        self.changed.set()

    def accept(self, notification: dict):
        payload = notification.get("params", {})
        if payload.get("sessionId") != str(self.conversation_id):
            return
        for event in self.adapter.accept(notification):
            self.projection.accept(event)
            self.emit({"type": "agent", "event": event})

    def snapshot(self):
        return {
            "run_id": str(self.id),
            "status": self.status if self.finished else "running",
            "error": self.error,
            "messages": self.projection.messages,
            "cursor": self.sequence,
            "activity": self.activity_state,
        }


class Manager:
    def __init__(self, db: Database, settings: Settings, containers=None):
        self.db, self.settings = db, settings
        self.containers = containers or Containers(settings)
        self.active: dict[uuid.UUID, Execution] = {}
        self.reading: set[uuid.UUID] = set()
        self.host_locks: dict[uuid.UUID, asyncio.Lock] = {}
        self.navigation = Navigation(self)
        self.hosts: dict[uuid.UUID, UserHost] = {}
        self.host_reaper: asyncio.Task | None = None
        self.host_allocation = asyncio.Lock()
        self.warming: dict[uuid.UUID, asyncio.Task] = {}
        self.closing = False

    def prewarm(self, user_id):
        """Login returns immediately; subsequent requests share the same startup."""
        if self.closing or user_id in self.warming:
            return

        async def warm():
            try:
                async with self.host_locks.setdefault(user_id, asyncio.Lock()):
                    await self.get_host(user_id)
            except Exception as exc:
                failure("runtime.warm_failure", exc, user_id=user_id)
            finally:
                self.warming.pop(user_id, None)

        self.warming[user_id] = asyncio.create_task(warm())

    @serialized_host
    async def control(
        self, user_id, method, *, conversation_id=None, workspace_id=None, **params
    ):
        return await self._control(
            user_id,
            method,
            conversation_id=conversation_id,
            workspace_id=workspace_id,
            **params,
        )

    async def _control(
        self, user_id, method, *, conversation_id=None, workspace_id=None, **params
    ):
        run = self.active.get(user_id)
        if run and method not in (
            "navigation/list",
            "navigation/update",
            "project/rename",
            "orchmesh/model",
        ):
            raise Busy("请等待当前任务结束后操作工作区")
        if user_id in self.reading:
            raise Busy("工作区状态正在读取，请重试")
        self.reading.add(user_id)
        try:
            host = await self.get_host(user_id)
            result = await host.rpc.call(method, **params)
            self.touch_host(user_id)
            return result
        except BaseException:
            # Do not replay commands after a disconnect or unknown mutation result.
            if not run:
                await self.release_host(user_id)
            raise
        finally:
            self.reading.discard(user_id)

    def touch_host(self, user_id):
        host = self.hosts.get(user_id)
        if host:
            host.expires = time.monotonic() + self.settings.runtime_idle_seconds

    async def get_host(self, user_id):
        """Caller holds user lock; serialize allocation across users."""
        async with self.host_allocation:
            return await self._get_host(user_id)

    async def _get_host(self, user_id):
        self.containers.prepare_workspaces(user_id)
        host = self.hosts.get(user_id)
        if host and host.rpc.closed.is_set():
            if user_id in self.active:
                raise RuntimeError("Active DSH Host exited")
            await self.release_host(user_id)
            host = None
        if host:
            self.touch_host(user_id)
            return host
        # Bound the number of user containers. Only evict genuinely idle Hosts.
        while len(self.hosts) >= self.settings.max_active_runs:
            reclaimed = False
            for other, candidate in sorted(
                self.hosts.items(), key=lambda item: item[1].expires
            ):
                lock = self.host_locks.setdefault(other, asyncio.Lock())
                if other in self.active or other in self.reading or lock.locked():
                    continue
                async with lock:
                    if (
                        candidate.rpc.closed.is_set()
                        or not (await candidate.rpc.call("orchmesh/busy"))["busy"]
                    ):
                        await self.release_host(other)
                        reclaimed = True
                        break
            if not reclaimed:
                raise Busy("运行容量已满，请稍后再试")

        def notify(record):
            run = self.active.get(user_id)
            if run:
                run.accept(record)

        rpc = RPC(
            self.containers.command(user_id, None), notify, context_id=str(user_id)
        )
        host = UserHost(rpc, time.monotonic() + self.settings.runtime_idle_seconds)
        self.hosts[user_id] = host
        try:
            await rpc.start()
            await rpc.call("initialize")
        except BaseException:
            await self.release_host(user_id)
            raise
        if self.host_reaper is None:
            self.host_reaper = asyncio.create_task(self.reap_hosts())
        return host

    async def release_host(self, user_id):
        """Removal must succeed before another container can use this user's state."""
        host = self.hosts.get(user_id)
        if host:
            await self.containers.kill(user_id)
            await host.rpc.close()
            self.hosts.pop(user_id, None)

    async def reap_hosts(self):
        while True:
            await asyncio.sleep(min(15, self.settings.runtime_idle_seconds))
            await self.expire_hosts()

    async def expire_hosts(self):
        for user_id in list(self.hosts):
            async with self.host_locks.setdefault(user_id, asyncio.Lock()):
                host = self.hosts.get(user_id)
                if not host or user_id in self.active or user_id in self.reading:
                    continue
                if host.expires > time.monotonic():
                    continue
                try:
                    if (
                        host.rpc.closed.is_set()
                        or not (await host.rpc.call("orchmesh/busy"))["busy"]
                    ):
                        await self.release_host(user_id)
                    else:
                        self.touch_host(user_id)
                except Exception as exc:
                    failure("runtime.cleanup_failure", exc)

    async def recover(self):
        # The process lock makes cleanup exclusive, including orphan history readers.
        from ..storage import User

        async with self.db.sessions() as session:
            users = (await session.scalars(select(User.__table__.c.id))).all()
            for user_id in set(users):
                await self.containers.kill(user_id)
            await session.execute(
                update(Run).where(Run.status == "running").values(status="interrupted")
            )
            await session.commit()

    @serialized_host
    async def start(
        self,
        user_id,
        conversation_id,
        prompt: str,
        reasoning: str = "default",
        review_tools: bool = False,
    ) -> Execution:
        if user_id in self.active or user_id in self.reading:
            raise Busy("该用户已有任务正在运行")
        if len(self.active) + len(self.reading) >= self.settings.max_active_runs:
            raise Busy("运行容量已满，请稍后再试")
        host = await self.get_host(user_id)
        if (await host.rpc.call("orchmesh/busy"))["busy"]:
            raise Busy("后台任务仍在运行，请等待结束后再发送")
        run = Execution(
            uuid.uuid4(),
            user_id,
            conversation_id,
            reasoning=reasoning,
            review_tools=review_tools,
        )
        run.rpc = host.rpc
        self.active[user_id] = run
        try:
            async with self.db.sessions() as session:
                session.add(Run(id=run.id, conversation_id=conversation_id))
                await session.commit()
            run.task = asyncio.create_task(self._execute(run, prompt))
        except BaseException:
            self.active.pop(user_id, None)
            raise
        return run

    async def _execute(self, run: Execution, prompt: str):
        rpc = None
        stage = "start"
        recycle = False
        logger.info(
            "run.start run_id=%s user_id=%s conversation_id=%s",
            run.id,
            run.user_id,
            run.conversation_id,
        )
        try:
            rpc = run.rpc
            assert rpc is not None
            stage = "history"
            result = await rpc.call(
                "orchmesh/open",
                sessionId=str(run.conversation_id),
                reviewTools=run.review_tools,
                reasoningEffort=run.reasoning,
            )
            messages, _ = history(result["events"])
            run.projection = Messages(messages)
            run.emit({"type": "snapshot", **run.snapshot()})
            stage = "prompt"
            await rpc.call(
                "session/prompt",
                sessionId=str(run.conversation_id),
                contentBlocks=[{"type": "text", "text": prompt}],
            )
            stage = "generation"
            run.ready.set()
            while True:
                admitted = run.admissions
                await rpc.call(
                    "orchmesh/wait",
                    timeout=self.settings.run_timeout,
                    sessionId=str(run.conversation_id),
                )
                async with run.control_lock:
                    if admitted != run.admissions:
                        continue
                    run.settled.set()
                    break
            stage = "history"
            result = await rpc.call(
                "orchmesh/history", sessionId=str(run.conversation_id)
            )
            run.activity_state = result.get("activity")
            messages, reason = history(result["events"])
            run.projection = Messages(messages)
            failed = reason in ("error", "blocked", "max-tokens", "interrupted")
            # A provider may encode an abort as stopReason="error". The
            # platform's stop request owns the terminal outcome: derive status
            # and error together, rather than publishing stopped + model error.
            # Cleanup failures below still override this outcome and lock capacity.
            if run.stopping:
                run.status, run.error = "stopped", None
            elif failed:
                run.status = "failed"
                run.error = "模型调用失败，请检查该用户的 DSH 模型配置与凭据。"
            else:
                run.status, run.error = "completed", None
        except asyncio.CancelledError:
            recycle = True
            run.status = "stopped" if run.stopping else "interrupted"
        except Exception as exc:
            recycle = True
            failure("run.failure", exc, run_id=run.id, stage=stage)
            run.status = "stopped" if run.stopping else "failed"
            run.error = (
                None
                if run.stopping
                else ("DSH 未能完成请求。请检查执行镜像、用户配置与模型凭据。")
            )
        finally:
            run.ready.set()
            # Normal completion and cooperative stop keep the official Host alive.
            # Timeout, transport failure or shutdown still tear down the entire tree.
            cleanup_ok = True
            try:
                if recycle:
                    async with self.host_locks.setdefault(run.user_id, asyncio.Lock()):
                        await self.release_host(run.user_id)
                else:
                    self.touch_host(run.user_id)
            except Exception as exc:
                failure("run.cleanup_failure", exc, run_id=run.id)
                cleanup_ok = False
                run.status = "interrupted"
                run.error = (
                    "执行环境清理失败，已锁定此用户的运行容量；"
                    "请检查 Docker 后重启服务。"
                )
            finally:
                async with self.db.sessions() as session:
                    await session.execute(
                        update(Run)
                        .where(Run.id == run.id)
                        .values(status=run.status if cleanup_ok else "running")
                    )
                    await session.commit()
                logger.info(
                    "run.end run_id=%s status=%s cleanup_ok=%s",
                    run.id,
                    run.status,
                    cleanup_ok,
                )
                run.finished = True
                run.emit({"type": "snapshot", **run.snapshot()})
                if cleanup_ok:
                    self.active.pop(run.user_id, None)

    async def stop(self, run: Execution):
        run.stopping = True
        try:
            await asyncio.wait_for(run.ready.wait(), 10)
            if run.rpc and run.status == "running":
                await run.rpc.call(
                    "orchmesh/stop", timeout=10, sessionId=str(run.conversation_id)
                )
            if run.task:
                await asyncio.wait_for(asyncio.shield(run.task), 10)
        except (TimeoutError, RuntimeError, BrokenPipeError):
            if run.task:
                run.task.cancel()
                await run.task

    @serialized_host
    async def history(self, user_id, conversation_id):
        run = self.active.get(user_id)
        if run:
            if run.conversation_id != conversation_id:
                raise Busy("请等待当前任务结束后再打开其他对话")
            return run.snapshot()
        data = await self._control(
            user_id, "orchmesh/history", sessionId=str(conversation_id)
        )
        messages, _ = history(data["events"])
        return {
            "messages": messages,
            "read_only": data.get("archived", False),
            "activity": data.get("activity"),
            "status": "idle",
            "run_id": None,
            "cursor": 0,
            "error": None,
        }

    async def activity(
        self, user_id, conversation_id, method, *, mutate=False, **params
    ):
        run = self.active.get(user_id)
        if not run:
            if mutate:
                raise Busy("任务已结束，请发送新消息")
            return await self.control(
                user_id,
                method,
                conversation_id=conversation_id,
                sessionId=conversation_id,
                **params,
            )
        if run.conversation_id != conversation_id:
            raise Busy("请等待当前任务结束后查看其他对话")
        await asyncio.wait_for(run.ready.wait(), 30)
        async with run.control_lock:
            if not run.rpc or run.finished or run.stopping or run.settled.is_set():
                raise Busy("任务正在结束，请稍后刷新")
            value = await run.rpc.call(method, sessionId=conversation_id, **params)
            if mutate:
                run.admissions += 1
            return value

    @serialized_host
    async def model_info(self, user_id):
        run = self.active.get(user_id)
        if run:
            if not run.ready.is_set() or not run.rpc or run.finished:
                raise Busy("模型正在初始化，请稍后")
            return await run.rpc.call("orchmesh/model")
        return await self._control(user_id, "orchmesh/model")

    async def close(self):
        self.closing = True
        warming = list(self.warming.values())
        for task in warming:
            task.cancel()
        await asyncio.gather(*warming, return_exceptions=True)
        if self.host_reaper:
            self.host_reaper.cancel()
            await asyncio.gather(self.host_reaper, return_exceptions=True)
            self.host_reaper = None
        tasks = [run.task for run in self.active.values() if run.task]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        for user_id in list(self.hosts):
            async with self.host_locks.setdefault(user_id, asyncio.Lock()):
                await self.release_host(user_id)
