import asyncio
import uuid
from collections import deque
from copy import deepcopy
from dataclasses import dataclass, field

from sqlalchemy import update

from ..config import Settings
from ..storage import Database, Run
from .containers import Containers
from .events import Messages
from .rpc import RPC


class Busy(Exception):
    pass


@dataclass
class Execution:
    id: uuid.UUID
    user_id: uuid.UUID
    conversation_id: uuid.UUID
    projection: Messages = field(default_factory=Messages)
    status: str = "running"
    error: str | None = None
    sequence: int = 0
    events: deque = field(default_factory=lambda: deque(maxlen=256))
    changed: asyncio.Event = field(default_factory=asyncio.Event)
    settled: asyncio.Event = field(default_factory=asyncio.Event)
    ready: asyncio.Event = field(default_factory=asyncio.Event)
    rpc: RPC | None = None
    task: asyncio.Task | None = None
    stopping: bool = False
    finished: bool = False

    def emit(self, data: dict):
        self.sequence += 1
        self.events.append((self.sequence, deepcopy(data)))
        self.changed.set()

    def accept(self, event: dict):
        self.projection.accept(event)
        # Whitelist events: extension UI payloads are not exposed as arbitrary UI.
        if event.get("type") in {
            "message_start",
            "message_update",
            "message_end",
            "tool_execution_start",
            "tool_execution_update",
            "tool_execution_end",
            "agent_start",
            "agent_end",
            "agent_settled",
        }:
            self.emit({"type": "pi", "event": event})
        if event.get("type") == "agent_settled":
            self.settled.set()

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

    async def recover(self):
        # The process lock makes cleanup exclusive, including orphan history readers.
        from sqlalchemy import select

        from ..storage import User

        async with self.db.sessions() as session:
            users = (await session.scalars(select(User.__table__.c.id))).all()
            for user_id in set(users):
                await self.containers.kill(user_id)
            await session.execute(
                update(Run).where(Run.status == "running").values(status="interrupted")
            )
            await session.commit()

    async def start(self, user_id, conversation_id, prompt: str) -> Execution:
        if user_id in self.active or user_id in self.reading:
            raise Busy("该用户已有任务正在运行")
        if len(self.active) + len(self.reading) >= self.settings.max_active_runs:
            raise Busy("运行容量已满，请稍后再试")
        run = Execution(uuid.uuid4(), user_id, conversation_id)
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
        waiters = []
        try:
            rpc = RPC(
                self.containers.command(run.user_id, run.conversation_id), run.accept
            )
            run.rpc = rpc
            await rpc.start()
            history = await rpc.call("get_messages")
            run.projection = Messages(history.get("messages", []))
            run.emit({"type": "snapshot", **run.snapshot()})
            response = await rpc.call("prompt", message=prompt)
            run.ready.set()
            if response.get("disposition") != "handled":
                waiters = [
                    asyncio.create_task(run.settled.wait()),
                    asyncio.create_task(rpc.closed.wait()),
                ]
                done, _ = await asyncio.wait(
                    waiters,
                    timeout=self.settings.run_timeout,
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if not done:
                    raise TimeoutError
                if not run.settled.is_set():
                    raise RuntimeError("Pi exited before settling")
            history = await rpc.call("get_messages")
            run.projection = Messages(history.get("messages", []))
            failed = any(
                m.get("stopReason") == "error" for m in run.projection.messages[-1:]
            )
            run.status = (
                "stopped" if run.stopping else "failed" if failed else "completed"
            )
            if failed:
                run.error = "模型调用失败，请检查该用户的 Pi 模型配置与凭据。"
        except asyncio.CancelledError:
            run.status = "stopped" if run.stopping else "interrupted"
        except Exception:
            run.status = "stopped" if run.stopping else "failed"
            run.error = (
                None
                if run.stopping
                else ("Pi 未能完成请求。请检查执行镜像、用户配置与模型凭据。")
            )
        finally:
            run.ready.set()
            for waiter in waiters:
                waiter.cancel()
            await asyncio.gather(*waiters, return_exceptions=True)
            # Always remove the container: EOF alone may leave Shell descendants.
            cleanup_ok = True
            try:
                await self.containers.kill(run.user_id)
            except Exception:
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
                run.finished = True
                run.emit({"type": "snapshot", **run.snapshot()})
                if cleanup_ok:
                    self.active.pop(run.user_id, None)

    async def stop(self, run: Execution):
        run.stopping = True
        try:
            await asyncio.wait_for(run.ready.wait(), 10)
            if run.rpc and run.status == "running":
                await run.rpc.call("clear_queue", timeout=5)
                await run.rpc.call("abort", timeout=10)
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
        if not (
            self.containers.user_dir(user_id) / "sessions" / f"{conversation_id}.jsonl"
        ).exists():
            return {
                "messages": [],
                "status": "idle",
                "run_id": None,
                "cursor": 0,
                "error": None,
            }
        self.reading.add(user_id)
        rpc = RPC(self.containers.command(user_id, conversation_id), lambda _: None)
        try:
            await rpc.start()
            data = await rpc.call("get_messages")
            return {
                "messages": data.get("messages", []),
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

    async def close(self):
        tasks = [run.task for run in self.active.values() if run.task]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
