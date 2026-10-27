"""A2A official transport, durable task store and event stream."""

import uuid

import httpx
from a2a.auth.user import User as ProtocolUser
from a2a.client import ClientConfig, ClientFactory
from a2a.server.agent_execution import AgentExecutor
from a2a.server.cluster.database_event_stream import DatabaseTaskEventStream
from a2a.server.cluster.database_task_store import VersionedDatabaseTaskStore
from a2a.server.cluster.task_store import ConcurrentTaskModificationError
from a2a.server.cluster.version import TaskVersion
from a2a.server.context import ServerCallContext
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.routes import add_a2a_routes_to_fastapi, create_jsonrpc_routes
from a2a.server.routes.common import DefaultServerCallContextBuilder
from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentInterface,
    AgentSkill,
    Artifact,
    GetTaskRequest,
    Message,
    Part,
    Role,
    SendMessageConfiguration,
    SendMessageRequest,
    TaskState,
    TaskStatus,
)
from a2a.types import Task as ProtocolTask
from dbos import DBOS
from sqlalchemy import delete, select

from ..security import create_access_token
from ..storage import Task, TaskWait


class Identity(ProtocolUser):
    def __init__(self, owner):
        self.owner = str(owner)

    @property
    def is_authenticated(self):
        return True

    @property
    def user_name(self):
        return self.owner


class ContextBuilder(DefaultServerCallContextBuilder):
    def build_user(self, request):
        return Identity(request.state.a2a_owner)


class Protocol:
    def __init__(self, engine, auth, app):
        self.engine, self.auth = engine, auth
        self.store = VersionedDatabaseTaskStore(engine.db.engine)
        self.events = DatabaseTaskEventStream(engine.db.engine, poll_interval_s=0.2)
        self.card = AgentCard(
            name="OrchMesh collaboration",
            description="Published agent delegation",
            version="1",
            supported_interfaces=[
                AgentInterface(
                    url=f"http://127.0.0.1:{engine.settings.port}/a2a",
                    protocol_binding="JSONRPC",
                    protocol_version="1.0",
                )
            ],
            capabilities=AgentCapabilities(streaming=True),
            default_input_modes=["text/plain"],
            default_output_modes=["text/plain"],
            skills=[
                AgentSkill(
                    id="delegate",
                    name="Delegate",
                    description="Execute a distinct published agent task",
                    tags=["agents"],
                )
            ],
        )
        protocol = self

        class Executor(AgentExecutor):
            async def execute(self, context, event_queue):
                import json

                value = json.loads(context.get_user_input())
                owner = uuid.UUID(context.call_context.user.user_name)
                async with engine.db.sessions() as session:
                    parent = await session.get(Task, value["parent"])
                    if not parent or parent.owner_id != owner:
                        raise ValueError("Invalid parent task")
                request_id = f"a2a:{parent.root_id}:{value['work_key']}"
                task_id = await engine.admit(
                    owner,
                    parent.conversation_id,
                    value["task"],
                    request_id,
                    agent_id=value["agent_id"],
                    parent=parent,
                    a2a_id=context.task_id,
                    a2a_context=context.context_id,
                )
                async with engine.db.sessions() as session:
                    saved = await session.get(Task, task_id)
                    if saved.a2a_id != context.task_id:
                        # A retried message projects its original durable identity.
                        await protocol.project(task_id)
                        existing = await protocol.store.get(
                            saved.a2a_id, ServerCallContext(user=Identity(owner))
                        )
                        if existing:
                            await event_queue.enqueue_event(existing.task)
                        return
                await event_queue.enqueue_event(
                    ProtocolTask(
                        id=context.task_id,
                        context_id=context.context_id,
                        status=TaskStatus(state=TaskState.TASK_STATE_WORKING),
                        history=[context.message] if context.message else [],
                    )
                )

            async def cancel(self, context, event_queue):
                raise ValueError("Cancel the owning root task through the platform API")

        handler = DefaultRequestHandler(
            Executor(), self.store, self.card, event_stream=self.events
        )
        add_a2a_routes_to_fastapi(
            app,
            jsonrpc_routes=create_jsonrpc_routes(
                handler, "/a2a", context_builder=ContextBuilder()
            ),
        )

        @app.middleware("http")
        async def authenticate(request, call_next):
            if request.url.path == "/a2a":
                token = request.headers.get("authorization", "").removeprefix("Bearer ")
                async with engine.db.sessions() as session:
                    user = await auth.resolve(token, session)
                if user is None:
                    from fastapi.responses import JSONResponse

                    return JSONResponse(
                        status_code=401, content={"detail": "Authentication required"}
                    )
                request.state.a2a_owner = user.id
            return await call_next(request)

    async def initialize(self):
        await self.store.initialize()
        await self.events.initialize()

    async def project(self, task_id):
        async with self.engine.db.sessions() as session:
            task = await session.get(Task, task_id)
        if not task.a2a_id:
            return
        state = {
            "completed": TaskState.TASK_STATE_COMPLETED,
            "failed": TaskState.TASK_STATE_FAILED,
            "stopped": TaskState.TASK_STATE_CANCELED,
            "waiting": TaskState.TASK_STATE_INPUT_REQUIRED,
        }.get(task.status, TaskState.TASK_STATE_WORKING)
        context = ServerCallContext(user=Identity(task.owner_id))
        value = ProtocolTask(
            id=task.a2a_id, context_id=task.a2a_context, status=TaskStatus(state=state)
        )
        if task.status == "completed":
            # Publish final assistant text only; histories remain in DSH logs.
            final = next(
                (
                    m
                    for m in reversed(task.messages)
                    if m.get("role") == "assistant"
                    and any(p.get("type") == "text" for p in m.get("content", []))
                ),
                {},
            )
            value.artifacts.append(
                Artifact(
                    artifact_id=task.id,
                    name="result",
                    parts=[
                        Part(text=p["text"])
                        for p in final.get("content", [])
                        if p.get("type") == "text"
                    ],
                )
            )
        for attempt in range(3):
            old = await self.store.get(task.a2a_id, context)
            if (
                old
                and old.task.status == value.status
                and old.task.artifacts == value.artifacts
            ):
                return
            try:
                await self.store.save(
                    value,
                    event=value,
                    prev=old.task if old else None,
                    prev_version=old.version if old else TaskVersion.MISSING,
                    context=context,
                )
                return
            except ConcurrentTaskModificationError:
                if attempt == 2:
                    raise

    async def attach_wait(self, parent, dependency):
        await self.attach_waits(parent, [dependency])

    async def attach_waits(self, parent, identifiers, mode="all"):
        if (
            not isinstance(identifiers, list)
            or not identifiers
            or any(
                not isinstance(identifier, str) or not identifier
                for identifier in identifiers
            )
        ):
            raise ValueError("Provide a non-empty list of task IDs")
        identifiers = list(dict.fromkeys(identifiers))
        async with self.engine.db.sessions.begin() as session:
            await session.scalar(
                select(Task).where(Task.id == parent.root_id).with_for_update()
            )
            edges = (
                await session.scalars(
                    select(TaskWait).where(TaskWait.root_id == parent.root_id)
                )
            ).all()
            graph = {}
            for edge in edges:
                graph.setdefault(edge.waiter_id, []).append(edge.dependency_id)
            ancestors = {parent.id}
            cursor = parent
            while cursor.parent_id:
                ancestors.add(cursor.parent_id)
                cursor = await session.get(Task, cursor.parent_id)
                if cursor is None:
                    break
            # Validate the whole batch before inserting any wait relationship.
            for dependency in identifiers:
                target = await session.get(Task, dependency)
                if (
                    target is None
                    or target.owner_id != parent.owner_id
                    or target.root_id != parent.root_id
                ):
                    raise ValueError("Task is not in this owned collaboration")
                if dependency in ancestors:
                    raise ValueError(
                        "Collaboration wait cycle rejected: ancestor or self"
                    )
                pending, visited = [dependency], set()
                while pending:
                    current = pending.pop()
                    if current == parent.id:
                        raise ValueError("Collaboration wait cycle rejected")
                    if current not in visited:
                        visited.add(current)
                        pending.extend(graph.get(current, []))
            for dependency in identifiers:
                edge = await session.get(TaskWait, (parent.id, dependency))
                if edge is not None:
                    edge.mode = mode
                else:
                    session.add(
                        TaskWait(
                            waiter_id=parent.id,
                            dependency_id=dependency,
                            root_id=parent.root_id,
                            mode=mode,
                        )
                    )

    async def statuses(self, parent, identifiers=None):
        async with self.engine.db.sessions() as session:
            rows = list(
                await session.scalars(
                    select(Task).where(
                        Task.root_id == parent.root_id, Task.owner_id == parent.owner_id
                    )
                )
            )
        by_id = {row.id: row for row in rows}
        if identifiers is not None and any(i not in by_id for i in identifiers):
            raise ValueError("Task is not in this owned collaboration")
        selected = rows if identifiers is None else [by_id[i] for i in identifiers]
        return [
            {
                "task_id": row.id,
                "agent_id": row.agent_id,
                "name": row.definition.get("name", "Agent"),
                "status": row.status,
            }
            for row in selected
        ]

    async def collect(self, parent, identifiers, mode="all"):
        if mode not in ("any", "all"):
            raise ValueError("Wait mode must be any or all")
        await self.attach_waits(parent, identifiers, mode)
        identifiers = list(dict.fromkeys(identifiers))
        states = await self.statuses(parent, identifiers)
        terminal = {"completed", "failed", "stopped"}
        if mode == "any":
            if not any(s["status"] in terminal for s in states):
                handles = [await DBOS.retrieve_workflow_async(i) for i in identifiers]
                await DBOS.wait_first_async(handles)
        else:
            for identifier in identifiers:
                await self.wait_status(identifier, parent.owner_id)
        result = {"mode": mode, "tasks": await self.statuses(parent, identifiers)}
        # Keep pending edges on interruption so recovery preserves any/all.
        async with self.engine.db.sessions.begin() as session:
            await session.execute(
                delete(TaskWait).where(
                    TaskWait.waiter_id == parent.id,
                    TaskWait.dependency_id.in_(identifiers),
                )
            )
        return result

    async def read_result(self, parent, identifier):
        state = (await self.statuses(parent, [identifier]))[0]
        if state["status"] not in ("completed", "failed", "stopped"):
            return state
        return await self.result(identifier, parent.owner_id)

    async def delegate(self, parent, arguments):
        accepted = await self.start(parent, arguments)
        await self.attach_wait(parent, accepted["task_id"])
        return await self.wait_result(accepted["task_id"], parent.owner_id)

    async def start(self, parent, arguments):
        import json

        work_key = arguments["work_key"].strip()
        if not work_key or len(work_key) > 70:
            raise ValueError("A short stable work key is required")
        key = f"a2a:{parent.root_id}:{work_key}"
        async with self.engine.db.sessions() as session:
            old = await session.scalar(
                select(Task).where(
                    Task.owner_id == parent.owner_id, Task.request_id == key
                )
            )
            cursor = parent
            while old and cursor:
                if cursor.id == old.id:
                    raise ValueError("Delegation cannot wait on an ancestor")
                cursor = (
                    await session.get(Task, cursor.parent_id)
                    if cursor.parent_id
                    else None
                )
        token = create_access_token(parent.owner_id, self.auth.secret, 60)
        async with httpx.AsyncClient(
            timeout=30, headers={"Authorization": f"Bearer {token}"}
        ) as http:
            client = ClientFactory(
                ClientConfig(streaming=False, httpx_client=http)
            ).create(self.card)
            if old is None:
                request = SendMessageRequest(
                    message=Message(
                        message_id=str(uuid.uuid5(uuid.NAMESPACE_URL, key)),
                        role=Role.ROLE_USER,
                        parts=[
                            Part(text=json.dumps({**arguments, "parent": parent.id}))
                        ],
                    ),
                    configuration=SendMessageConfiguration(return_immediately=True),
                )
                async for _ in client.send_message(request):
                    pass
            async with self.engine.db.sessions() as session:
                child = await session.scalar(
                    select(Task).where(
                        Task.owner_id == parent.owner_id, Task.request_id == key
                    )
                )
            if child is None:
                raise RuntimeError("Accepted delegation has no durable task")
            if (
                child.agent_id != arguments["agent_id"]
                or child.prompt != arguments["task"]
            ):
                raise ValueError("Work key already identifies a different assignment")
            return {"task_id": child.id, "status": child.status, "accepted": True}

    async def wait_status(self, task_id, owner):
        # DBOS owns the wait and workflow recovery; A2A owns the result protocol.
        try:
            await DBOS.get_result_async(task_id)
        except Exception:
            async with self.engine.db.sessions() as session:
                failed = await session.get(Task, task_id)
                if not failed or failed.status not in ("failed", "stopped"):
                    raise
        async with self.engine.db.sessions() as session:
            child = await session.get(Task, task_id)
            if not child or child.owner_id != owner:
                raise ValueError("Delegation ownership mismatch")
        return {"task_id": child.id, "status": child.status}

    async def wait_result(self, task_id, owner):
        await self.wait_status(task_id, owner)
        return await self.result(task_id, owner)

    async def result(self, task_id, owner):
        async with self.engine.db.sessions() as session:
            child = await session.get(Task, task_id)
            if not child or child.owner_id != owner:
                raise ValueError("Delegation ownership mismatch")
        await self.project(child.id)
        token = create_access_token(owner, self.auth.secret, 60)
        async with httpx.AsyncClient(
            timeout=30, headers={"Authorization": f"Bearer {token}"}
        ) as http:
            client = ClientFactory(
                ClientConfig(streaming=False, httpx_client=http)
            ).create(self.card)
            value = await client.get_task(GetTaskRequest(id=child.a2a_id))
        return {
            "task_id": child.id,
            "status": child.status,
            "result": [p.text for a in value.artifacts for p in a.parts],
        }

    async def recover_dependencies(self, task, *, include_children=True):
        async with self.engine.db.sessions() as session:
            dependencies = set(
                (
                    await session.scalars(
                        select(TaskWait.dependency_id).where(
                            TaskWait.waiter_id == task.id
                        )
                    )
                ).all()
            )
            # Admission commits before the A2A acknowledgement and wait edge.
            # Include direct children to close that crash window too.
            if include_children:
                dependencies.update(
                    (
                        await session.scalars(
                            select(Task.id).where(
                                Task.parent_id == task.id,
                                Task.owner_id == task.owner_id,
                            )
                        )
                    ).all()
                )
        if not dependencies:
            return []
        async with self.engine.db.sessions() as session:
            modes = list(
                await session.scalars(
                    select(TaskWait.mode).where(TaskWait.waiter_id == task.id)
                )
            )
        result = await self.collect(
            task, sorted(dependencies), "any" if "any" in modes else "all"
        )
        return result["tasks"]
