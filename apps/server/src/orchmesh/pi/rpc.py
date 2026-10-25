import asyncio
import contextlib
import json
import uuid
from collections.abc import Callable
from typing import Any

from ..logging import failure, logger


class RPC:
    """One Pi process. The reader never waits for an HTTP subscriber."""

    def __init__(
        self,
        command: list[str],
        on_event: Callable[[dict], None],
        *,
        context_id: str = "unknown",
    ):
        self.context_id = context_id
        self.command = command
        self.on_event = on_event
        self.pending: dict[str, asyncio.Future] = {}
        self.process: asyncio.subprocess.Process | None = None
        self.tasks: list[asyncio.Task] = []
        self.closed = asyncio.Event()
        self.error: Exception | None = None
        self.stderr_bytes = 0

    async def start(self):
        self.process = await asyncio.create_subprocess_exec(
            *self.command,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            limit=8 * 1024 * 1024,
        )
        self.tasks = [
            asyncio.create_task(self._read()),
            asyncio.create_task(self._drain_stderr()),
        ]

    async def _drain_stderr(self):
        assert self.process and self.process.stderr
        # Drain but never log provider diagnostics that could contain credentials.
        while chunk := await self.process.stderr.read(65536):
            self.stderr_bytes += len(chunk)

    async def _read(self):
        assert self.process and self.process.stdout
        try:
            while line := await self.process.stdout.readline():
                record = json.loads(line)
                if record.get("type") == "response":
                    future = self.pending.get(record.get("id"))
                    if future and not future.done():
                        if record.get("success"):
                            future.set_result(record.get("data", {}))
                        else:
                            future.set_exception(RuntimeError("Pi command failed"))
                else:
                    self.on_event(record)
        except Exception as exc:
            self.error = exc
            failure("rpc.read_failure", exc, context_id=self.context_id)
        finally:
            self.closed.set()
            for future in self.pending.values():
                if not future.done():
                    future.set_exception(RuntimeError("Pi process exited"))

    async def call(self, method: str, timeout: float = 30, **params) -> Any:
        assert self.process and self.process.stdin
        if self.closed.is_set():
            raise RuntimeError("Pi process exited")
        key = str(uuid.uuid4())
        future = asyncio.get_running_loop().create_future()
        self.pending[key] = future
        try:
            self.process.stdin.write(
                (json.dumps({"id": key, "type": method, **params}) + "\n").encode()
            )
            await self.process.stdin.drain()
            return await asyncio.wait_for(future, timeout)
        finally:
            self.pending.pop(key, None)

    async def close(self):
        if self.process:
            if self.process.stdin:
                self.process.stdin.close()
            try:
                await asyncio.wait_for(self.process.wait(), 5)
            except TimeoutError:
                with contextlib.suppress(ProcessLookupError):
                    self.process.kill()
                await self.process.wait()
        if self.process:
            logger.info(
                "rpc.exit context_id=%s returncode=%s stderr_bytes=%s",
                self.context_id,
                self.process.returncode,
                self.stderr_bytes,
            )
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
