"""Durable task orchestration; DBOS owns scheduling, recovery and waiting."""

import asyncio
import copy
import json
import os
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

from dbos import DBOS, DBOSClient
from fastapi import HTTPException
from sqlalchemy import delete, or_, select

from ..config import Settings
from ..dsh.events import Adapter, history
from ..dsh.messages import Messages
from ..logging import logger
from ..prompt_settings import DEFAULTS, read_prompts
from ..storage import (
    AgentDefinition,
    AgentVersion,
    Answer,
    Artifact,
    Conversation,
    Database,
    Memory,
    Preference,
    Task,
    TaskWait,
    User,
    require_record,
)
from .sandbox import Sandboxes

if TYPE_CHECKING:
    from .protocol import Protocol

ACTIVE = ("queued", "running", "waiting")
_engine = None


def engine():
    if _engine is None:
        raise RuntimeError("Task engine is not initialized")
    return _engine


@DBOS.step(
    retries_allowed=True,
    max_attempts=3,
    interval_seconds=1,
    should_retry=lambda error: isinstance(error, ChildProcessError),
    preemptible=True,
)
async def run_session(task_id: str, continuation: bool, answer: dict | None) -> dict:
    return await engine().run(task_id, continuation, answer)


@DBOS.step()
async def publish(task_id: str, result: dict) -> None:
    async with engine().db.sessions.begin() as session:
        task = await require_record(session, Task, task_id)
        if task.status != "stopped":
            task.status = (
                result["phase"]
                if result["phase"] in ("failed", "completed")
                else "waiting"
            )
            from .artifacts import capture

            if result["events"]:
                task.messages = await capture(
                    engine(), session, task, history(result["events"])[0]
                )
            task.questions = result.get("questions", [])
            task.error = result.get("error")
            task.revision += 1
            if task.status in ("completed", "failed"):
                task.finished_at = task.finished_at or datetime.now(UTC).isoformat()
                await session.execute(
                    delete(TaskWait).where(TaskWait.waiter_id == task.id)
                )
    protocol = engine().protocol
    if protocol is not None:
        await protocol.project(task_id)


@DBOS.step()
async def mark_failed(task_id: str):
    async with engine().db.sessions.begin() as session:
        task = await require_record(session, Task, task_id)
        if task.status != "stopped":
            task.status = "failed"
            task.finished_at = task.finished_at or datetime.now(UTC).isoformat()
            task.error = "Task execution failed. Saved session and files are retained."
    protocol = engine().protocol
    if protocol is not None:
        await protocol.project(task_id)


@DBOS.workflow()
async def execute_task(task_id: str):
    continuation, answer = False, None
    while True:
        try:
            result = await run_session(task_id, continuation, answer)
            await publish(task_id, result)
        except Exception:
            await mark_failed(task_id)
            raise
        if result["phase"] in ("completed", "failed", "stopped"):
            return
        if result["phase"] == "question":
            answer = None
            while answer is None:
                answer = await DBOS.recv_async(topic="answer", timeout_seconds=86400)
        else:
            answer = None
        continuation = True


class Engine:
    def __init__(self, db: Database, settings: Settings):
        self.db, self.settings = db, settings
        self.sandboxes = Sandboxes(settings)
        self.client: DBOSClient | None = None
        self.protocol: Protocol | None = None
        self.live = {}

    async def start(self):
        global _engine
        _engine = self
        DBOS(
            config={
                "name": "orchmesh",
                "system_database_url": self.settings.database_url,
                "application_version": "agent-platform-v1",
                "enable_otlp": False,
            }
        )
        DBOS.launch()
        await DBOS.register_queue_async("agent-tasks", polling_interval_sec=0.2)
        self.client = DBOSClient(
            system_database_url=self.settings.database_url, application_name="orchmesh"
        )

    async def close(self):
        await asyncio.to_thread(DBOS.destroy, workflow_completion_timeout_sec=0)
        if self.client:
            self.client.destroy()

    async def admit(
        self,
        owner: uuid.UUID,
        conversation_id: str,
        prompt: str,
        request_id: str,
        *,
        agent_id: str | None = None,
        parent: Task | None = None,
        a2a_id: str | None = None,
        a2a_context: str | None = None,
    ) -> str:
        async with self.settings._model_lock, self.db.sessions.begin() as session:
            # Conversation row lock also serializes identical request
            # IDs and history heads.
            conversation = await session.scalar(
                select(Conversation)
                .where(
                    Conversation.id == conversation_id, Conversation.user_id == owner
                )
                .with_for_update()
            )
            if conversation is None:
                raise HTTPException(404, "Conversation not found")
            if conversation.archived or conversation.legacy:
                raise HTTPException(409, "Conversation is read-only")
            if parent:
                current_parent = await require_record(session, Task, parent.id)
                if (
                    current_parent.owner_id != owner
                    or current_parent.status not in ACTIVE
                ):
                    raise HTTPException(409, "Parent task is no longer active")
            existing = await session.scalar(
                select(Task).where(
                    Task.owner_id == owner, Task.request_id == request_id
                )
            )
            if existing:
                if (
                    existing.prompt != prompt
                    or existing.conversation_id != conversation_id
                ):
                    raise HTTPException(409, "Request identity conflict")
                return existing.id
            if not parent and await session.scalar(
                select(Task.id).where(
                    Task.conversation_id == conversation_id,
                    Task.parent_id.is_(None),
                    Task.status.in_(ACTIVE),
                )
            ):
                raise HTTPException(
                    409, "A task is already active in this conversation"
                )
            prompts = read_prompts(self.settings)
            version_id, definition = (
                "assistant-v1",
                {"name": "OrchMesh", "instructions": prompts.assistant},
            )
            selected = agent_id or conversation.agent_id
            if selected:
                from .catalog import freeze_definition

                trial = selected.startswith("draft:")
                identifier = selected.removeprefix("draft:")
                agent = await session.get(AgentDefinition, identifier)
                if not agent or agent.archived:
                    raise HTTPException(404, "Agent not found")
                if trial:
                    if agent.owner_id != owner:
                        raise HTTPException(404, "Draft not found")
                    definition = await freeze_definition(session, agent)
                    version_id = str(uuid.uuid4())
                    session.add(
                        AgentVersion(
                            id=version_id, agent_id=agent.id, definition=definition
                        )
                    )
                else:
                    if not agent.published_version:
                        raise HTTPException(404, "Published agent not found")
                    version = await require_record(
                        session, AgentVersion, agent.published_version
                    )
                    version_id, definition = version.id, version.definition
            if conversation.creator:
                definition = {"name": "Agent Builder", "instructions": prompts.builder}
                version_id = "builder-v1"
            previous = list(
                (
                    await session.scalars(
                        select(Task)
                        .where(
                            Task.conversation_id == conversation_id,
                            Task.parent_id.is_(None),
                            Task.status == "completed",
                        )
                        .order_by(Task.created_at)
                    )
                ).all()
            )
            context = conversation.legacy_messages + [
                message for task in previous for message in task.messages
            ]
            inputs = (
                await session.scalars(
                    select(Artifact).where(
                        Artifact.owner_id == owner,
                        Artifact.conversation_id == conversation_id,
                        Artifact.task_id == "input",
                    )
                )
            ).all()
            if inputs:
                context += [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": json.dumps(
                                    {
                                        "uploaded_inputs": [
                                            {
                                                "id": item.id,
                                                "name": item.name,
                                                "path": (
                                                    f"/workspace/inputs/{item.id}/"
                                                    f"{item.name}"
                                                ),
                                            }
                                            for item in inputs
                                        ]
                                    }
                                ),
                            }
                        ],
                    }
                ]
            try:
                if parent:
                    model_snapshot = dict(parent.model)
                else:
                    profile = self.settings.resolve_model(conversation.model_id)
                    if (
                        conversation.reasoning != "default"
                        and conversation.reasoning not in profile.effort_ids
                    ):
                        raise ValueError(
                            "Selected reasoning level is no longer supported"
                        )
                    model_snapshot = profile.snapshot(conversation.reasoning)
            except ValueError as error:
                raise HTTPException(422, str(error)) from error
            task_id = str(uuid.uuid4())
            task = Task(
                id=task_id,
                owner_id=owner,
                request_id=request_id,
                conversation_id=conversation_id,
                root_id=parent.root_id if parent else task_id,
                parent_id=parent.id if parent else None,
                agent_id=selected,
                version_id=version_id,
                definition=definition,
                platform_prompt=prompts.platform,
                continuation_prompt=prompts.continuation,
                prompt=prompt,
                context=context,
                model=model_snapshot,
                a2a_id=a2a_id,
                a2a_context=a2a_context,
            )
            session.add(task)
            await session.flush()
            assert self.client is not None
            client = self.client
            connection = await session.connection()
            await connection.run_sync(
                lambda conn: client.enqueue_in_transaction(
                    conn,
                    {
                        "workflow_name": "execute_task",
                        "queue_name": "agent-tasks",
                        "workflow_id": task_id,
                    },
                    task_id,
                )
            )
            return task_id

    async def run(self, task_id: str, continuation: bool, answer: dict | None) -> dict:
        from .tools import definitions, invoke

        async with self.db.sessions.begin() as session:
            task = await require_record(session, Task, task_id)
            if task.status == "stopped":
                return {"phase": "stopped", "events": []}
            task.status = "running"
            conversation = await require_record(
                session, Conversation, task.conversation_id
            )
            memories = list(
                (
                    await session.scalars(
                        select(Memory).where(
                            Memory.owner_id == task.owner_id,
                            Memory.enabled.is_(True),
                            or_(
                                Memory.agent_id.is_(None),
                                Memory.agent_id == task.agent_id,
                            ),
                        )
                    )
                ).all()
            )
            preference = await session.get(Preference, task.owner_id)
            memory_enabled = preference.memory_enabled if preference else True
            if not memory_enabled:
                memories = []
            peers = list(
                (
                    await session.scalars(
                        select(Task).where(Task.root_id == task.root_id)
                    )
                ).all()
            )
        recovered = (
            await self.protocol.recover_dependencies(task, include_children=False)
            if self.protocol
            else []
        )
        async with self.db.sessions() as session:
            current = await require_record(session, Task, task_id)
            if current.status == "stopped":
                return {"phase": "stopped", "events": []}
        root = self.sandboxes.root(task_id)
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        environment = {
            key: value
            for key, value in os.environ.items()
            if not key.startswith("ORCHMESH_")
        }
        if self.settings.http_proxy.get_secret_value():
            environment.update(
                {
                    "HTTP_PROXY": self.settings.http_proxy.get_secret_value(),
                    "HTTPS_PROXY": self.settings.http_proxy.get_secret_value(),
                    "NO_PROXY": self.settings.no_proxy,
                }
            )
        from .skills import task_skills

        async with self.db.sessions() as session:
            skills = await task_skills(session, task.definition.get("skills", []), root)
            owner = await session.get(User, task.owner_id)
            skill_admin = bool(owner and owner.is_superuser)
        remote = None
        if task.sandbox:
            # Inputs are immutable, owner-authorized snapshots. Only task-local
            # copies are exposed to the official SSH tools.
            import shutil

            async with self.db.sessions() as session:
                inputs = (
                    await session.scalars(
                        select(Artifact).where(
                            Artifact.owner_id == task.owner_id,
                            Artifact.conversation_id == task.conversation_id,
                            Artifact.task_id == "input",
                        )
                    )
                ).all()
            for item in inputs:
                target = root / "work" / "inputs" / item.id / item.name
                if not target.exists():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(item.path, target)
            remote, overrides = await self.sandboxes.start(task_id)
            environment.update(overrides)
        system_data = {
            "definition": task.definition,
            "task_prompt": task.prompt,
            "conversation_history": task.context,
            "user_memory": [m.content for m in memories],
            "collaboration": [
                {
                    "id": t.id,
                    "parent": t.parent_id,
                    "agent": t.agent_id,
                    "task": t.prompt,
                    "status": t.status,
                }
                for t in peers
            ],
        }
        prompt_parts = [
            {
                "name": "orchmesh-" + key,
                "text": json.dumps({key: value}, ensure_ascii=False),
            }
            for key, value in system_data.items()
        ]
        prompt_parts.append(
            {
                "name": "orchmesh-platform",
                "text": task.platform_prompt
                if task.platform_prompt is not None
                else DEFAULTS.platform,
            }
        )
        specs = definitions(conversation.creator, skill_admin)
        if not memory_enabled:
            specs = [spec for spec in specs if spec["name"] != "remember_preference"]
        permissions = task.definition.get("tools", ["execution", "collaboration"])
        specs = [
            spec
            for spec in specs
            if not (
                spec["name"] == "request_execution"
                and "execution" not in permissions
                or spec["name"]
                in (
                    "delegate_task",
                    "start_agent_task",
                    "wait_for_tasks",
                    "get_task_result",
                    "list_agent_tasks",
                )
                and "collaboration" not in permissions
            )
        ]
        config = {
            "task": task_id,
            "skills": skills,
            "root": str(root),
            "version": task.version_id,
            "promptParts": prompt_parts,
            "continuationPrompt": task.continuation_prompt
            if task.continuation_prompt is not None
            else DEFAULTS.continuation,
            "model": task.model,
            "key": self.settings.resolve_model(
                task.model.get("key")
            ).api_key.get_secret_value(),
            "web": "web" in task.definition.get("tools", ["web"]),
            "search": {
                "key": self.settings.search_api_key.get_secret_value(),
                "baseURL": self.settings.search_base_url,
                "model": self.settings.search_model,
            },
            "prompt": task.prompt,
            "reasoning": task.model.get("reasoning", conversation.reasoning),
            "tools": specs,
            "remote": remote,
            "continue": continuation,
            "answer": answer,
            "recovered": recovered,
        }
        adapter, projection = Adapter(), Messages()
        projection.messages = task.messages
        self.live[task_id] = projection
        result = None
        proc = await asyncio.create_subprocess_exec(
            sys.executable,
            str(Path(__file__).with_name("launch_child.py")),
            str(self.settings.runtime_dir / "task-worker.mjs"),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=environment,
            limit=16 * 1024 * 1024,
        )

        async def drain_stderr():
            total = 0
            assert proc.stderr is not None
            while chunk := await proc.stderr.read(65536):
                total += len(chunk)
            return total

        stderr_task = asyncio.create_task(drain_stderr())
        handlers: set[asyncio.Task] = set()

        async def handle_tool(packet):
            assert proc.stdin is not None
            try:
                if packet["name"] == "user_question":
                    response = await self.wait_question(task, packet, proc)
                else:
                    response = await invoke(
                        self, task, packet["name"], packet["args"], packet["id"]
                    )
                reply = {"id": packet["id"], "result": response}
            except Exception:
                reply = {
                    "id": packet["id"],
                    "error": (
                        "Platform operation failed; inspect state before retrying"
                    ),
                }
            if proc.returncode is None:
                try:
                    proc.stdin.write((json.dumps(reply) + "\n").encode())
                    await proc.stdin.drain()
                except (BrokenPipeError, ConnectionResetError):
                    pass

        assert proc.stdin is not None and proc.stdout is not None
        try:
            proc.stdin.write((json.dumps({"config": config}) + "\n").encode())
            await proc.stdin.drain()
            async for line in proc.stdout:
                packet = json.loads(line)
                kind = packet.get("type")
                if kind == "tool":
                    handler = asyncio.create_task(handle_tool(packet))
                    handlers.add(handler)
                    handler.add_done_callback(handlers.discard)
                elif kind in ("stream", "event"):
                    notification = {
                        "method": "orchmesh.stream"
                        if kind == "stream"
                        else "session.event",
                        "params": {"frame": packet["frame"]}
                        if kind == "stream"
                        else {"event": packet["event"]},
                    }
                    for event in adapter.accept(notification):
                        projection.accept(event)
                elif kind == "result":
                    result = packet
                elif kind == "failure":
                    # Provider diagnostics can contain credentials or request
                    # bodies. Persist only a fixed, actionable failure summary.
                    result = {
                        "phase": "failed",
                        "events": [],
                        "error": "DSH execution failed; saved session is retained.",
                    }
            code = await proc.wait()
            if code == -9:
                raise ChildProcessError("DSH worker was interrupted")
            if result is None:
                raise RuntimeError(
                    "DSH worker failed; task log requires local inspection"
                )
            if result.get("reason") in ("error", "aborted", "max-tokens"):
                result["phase"] = "failed"
            if result["phase"] == "completed":
                async with self.db.sessions() as session:
                    pending = list(
                        await session.scalars(
                            select(Task.id).where(
                                Task.owner_id == task.owner_id,
                                Task.status.in_(ACTIVE),
                                or_(
                                    Task.parent_id == task.id,
                                    Task.id.in_(
                                        select(TaskWait.dependency_id).where(
                                            TaskWait.waiter_id == task.id
                                        )
                                    ),
                                ),
                            )
                        )
                    )
                if pending:
                    if self.protocol is None:
                        raise RuntimeError("A2A service unavailable")
                    await self.protocol.attach_waits(task, pending)
                    result["phase"] = "dependencies"
            return result
        finally:
            pending_handlers = list(handlers)
            for handler in pending_handlers:
                handler.cancel()
            if pending_handlers:
                await asyncio.gather(*pending_handlers, return_exceptions=True)
            if proc.returncode is None:
                proc.kill()
                await proc.wait()
            self.live.pop(task_id, None)
            stderr_bytes = await stderr_task
            logger.info(
                "task.worker_exit task_id=%s code=%s stderr_bytes=%s",
                task_id,
                proc.returncode,
                stderr_bytes,
            )
            await self.sandboxes.release(task_id)

    async def wait_question(self, task, packet, process):
        async with self.db.sessions.begin() as session:
            saved = await require_record(session, Task, task.id)
            if saved.status == "stopped":
                raise asyncio.CancelledError()
            saved.questions = [
                q for q in saved.questions if q["callId"] != packet["id"]
            ] + [{"callId": packet["id"], "questions": packet["args"]["questions"]}]
            saved.status = "waiting"
        while process.returncode is None:
            async with self.db.sessions() as session:
                answer = await session.get(Answer, f"{task.id}:{packet['id']}")
                if answer:
                    async with self.db.sessions.begin() as update:
                        saved = await require_record(update, Task, task.id)
                        if saved.status == "stopped":
                            raise asyncio.CancelledError()
                        saved.status = "running"
                        saved.questions = []
                    return answer.answer
            await asyncio.sleep(0.2)
        return {"answers": []}

    async def stop(self, owner: uuid.UUID, conversation_id: str):
        async with self.db.sessions.begin() as session:
            await session.scalar(
                select(Conversation)
                .where(
                    Conversation.id == conversation_id, Conversation.user_id == owner
                )
                .with_for_update()
            )
            tasks = list(
                (
                    await session.scalars(
                        select(Task).where(
                            Task.owner_id == owner,
                            Task.conversation_id == conversation_id,
                            Task.status.in_(ACTIVE),
                        )
                    )
                ).all()
            )
            for task in tasks:
                task.status = "stopped"
                task.finished_at = task.finished_at or datetime.now(UTC).isoformat()
                task.questions = []
                if task.id in self.live:
                    task.messages = copy.deepcopy(self.live[task.id].messages)
        for task in tasks:
            await DBOS.cancel_workflow_async(task.id)
            await self.sandboxes.release(task.id)
