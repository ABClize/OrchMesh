import asyncio
import uuid
from collections import deque
from copy import deepcopy
from dataclasses import dataclass, field

from sqlalchemy import select, update

from ..config import Settings
from ..logging import failure, logger
from ..storage import Conversation, Database, Run
from .containers import Containers
from .events import Adapter, history
from .messages import Messages
from .navigation import Navigation
from .rpc import RPC


class Busy(Exception):
    pass


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
        }


class Manager:
    def __init__(self, db: Database, settings: Settings, containers=None):
        self.db, self.settings = db, settings
        self.containers = containers or Containers(settings)
        self.active: dict[uuid.UUID, Execution] = {}
        self.reading: set[uuid.UUID] = set()
        self.navigation = Navigation(self)

    async def control(
        self, user_id, method, *, conversation_id=None, workspace_id=None, **params
    ):
        run = self.active.get(user_id)
        if run:
            if method not in ("navigation/list", "navigation/update", "project/rename"):
                raise Busy("请等待当前任务结束后操作工作区")
            await asyncio.wait_for(run.ready.wait(), 30)
            if not run.rpc or run.finished:
                raise Busy("任务正在结束，请重试")
            return await run.rpc.call(method, **params)
        if user_id in self.reading:
            raise Busy("工作区状态正在读取，请重试")
        if len(self.active) + len(self.reading) >= self.settings.max_active_runs:
            raise Busy("运行容量已满，请稍后再试")
        self.reading.add(user_id)
        rpc = None
        try:
            if workspace_id is not None:
                command = self.containers.command(
                    user_id, conversation_id, workspace_id, control=True
                )
            else:
                command = (
                    await self.command(user_id, conversation_id, control=True)
                    if conversation_id
                    else self.containers.command(user_id, None)
                )
            rpc = RPC(command, lambda _: None)
            await rpc.start()
            await rpc.call("initialize")
            return await rpc.call(method, **params)
        finally:
            cleanup_ok = False
            try:
                await self.containers.kill(user_id)
                cleanup_ok = True
            finally:
                if rpc:
                    await rpc.close()
                if cleanup_ok:
                    self.reading.discard(user_id)

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

    async def command(self, user_id, conversation_id, *, control=False):
        async with self.db.sessions() as session:
            conversation = await session.get(Conversation, conversation_id)
            project_id = conversation.directory_id if conversation else None
        return self.containers.command(
            user_id, conversation_id, project_id, control=control
        )

    async def start(
        self, user_id, conversation_id, prompt: str, reasoning: str = "default"
    ) -> Execution:
        if user_id in self.active or user_id in self.reading:
            raise Busy("该用户已有任务正在运行")
        if len(self.active) + len(self.reading) >= self.settings.max_active_runs:
            raise Busy("运行容量已满，请稍后再试")
        run = Execution(uuid.uuid4(), user_id, conversation_id, reasoning=reasoning)
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
        logger.info(
            "run.start run_id=%s user_id=%s conversation_id=%s",
            run.id,
            run.user_id,
            run.conversation_id,
        )
        try:
            rpc = RPC(
                await self.command(run.user_id, run.conversation_id),
                run.accept,
                context_id=str(run.id),
            )
            run.rpc = rpc
            await rpc.start()
            stage = "initialize"
            if run.reasoning == "default":
                await rpc.call("initialize")
            else:
                await rpc.call("initialize", reasoningEffort=run.reasoning)
            stage = "history"
            result = await rpc.call(
                "orchmesh/open",
                sessionId=str(run.conversation_id),
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
            await rpc.call(
                "session/wait",
                timeout=self.settings.run_timeout,
                sessionId=str(run.conversation_id),
            )
            run.settled.set()
            stage = "history"
            result = await rpc.call(
                "orchmesh/history", sessionId=str(run.conversation_id)
            )
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
            run.status = "stopped" if run.stopping else "interrupted"
        except Exception as exc:
            failure("run.failure", exc, run_id=run.id, stage=stage)
            run.status = "stopped" if run.stopping else "failed"
            run.error = (
                None
                if run.stopping
                else ("DSH 未能完成请求。请检查执行镜像、用户配置与模型凭据。")
            )
        finally:
            run.ready.set()
            # Always remove the container: EOF alone may leave Shell descendants.
            cleanup_ok = True
            try:
                await self.containers.kill(run.user_id)
            except Exception as exc:
                failure("run.cleanup_failure", exc, run_id=run.id)
                cleanup_ok = False
                run.status = "interrupted"
                run.error = (
                    "执行环境清理失败，已锁定此用户的运行容量；"
                    "请检查 Docker 后重启服务。"
                )
            finally:
                if rpc:
                    await rpc.close()
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

    async def history(self, user_id, conversation_id):
        run = self.active.get(user_id)
        if run:
            if run.conversation_id != conversation_id:
                raise Busy("请等待当前任务结束后再打开其他对话")
            return run.snapshot()
        if user_id in self.reading:
            raise Busy("正在读取历史，请稍后")
        if len(self.active) + len(self.reading) >= self.settings.max_active_runs:
            raise Busy("运行容量已满，请稍后再试")
        self.reading.add(user_id)
        rpc = RPC(
            await self.command(user_id, conversation_id, control=True),
            lambda _: None,
            context_id=str(conversation_id),
        )
        try:
            await rpc.start()
            await rpc.call("initialize")
            data = await rpc.call("orchmesh/history", sessionId=str(conversation_id))
            messages, _ = history(data["events"])
            return {
                "messages": messages,
                "read_only": data.get("archived", False),
                "status": "idle",
                "run_id": None,
                "cursor": 0,
                "error": None,
            }
        finally:
            try:
                await self.containers.kill(user_id)
            finally:
                await rpc.close()
                self.reading.discard(user_id)

    async def model_info(self, user_id):
        run = self.active.get(user_id)
        if run:
            if not run.ready.is_set() or not run.rpc or run.finished:
                raise Busy("模型正在初始化，请稍后")
            return await run.rpc.call("orchmesh/model")
        if (
            user_id in self.reading
            or len(self.active) + len(self.reading) >= self.settings.max_active_runs
        ):
            raise Busy("执行环境繁忙，请稍后")
        self.reading.add(user_id)
        rpc = RPC(self.containers.command(user_id, None), lambda _: None)
        try:
            await rpc.start()
            await rpc.call("initialize")
            return await rpc.call("orchmesh/model")
        finally:
            try:
                await self.containers.kill(user_id)
            finally:
                await rpc.close()
                self.reading.discard(user_id)

    async def close(self):
        tasks = [run.task for run in self.active.values() if run.task]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
