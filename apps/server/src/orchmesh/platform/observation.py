"""Owner-scoped read models over platform tasks and official DSH logs."""

import asyncio
import copy
import json
from collections import Counter
from collections.abc import AsyncIterable
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel
from sqlalchemy import select

from ..auth import bearer
from ..storage import Artifact, Conversation, Task, TaskWait, User
from .engine import ACTIVE


class TaskNode(BaseModel):
    id: str
    root_id: str
    parent_id: str | None
    conversation_id: str
    agent_id: str | None
    version_id: str | None
    name: str
    prompt: str
    status: str
    activity: str
    worker_attached: bool
    created_at: str
    finished_at: str | None = None
    error: str | None
    sandbox_requested: bool
    revision: int


class AgentNode(BaseModel):
    id: str
    agent_id: str | None
    name: str
    version_ids: list[str]
    task_ids: list[str]
    call_count: int
    active_count: int
    status_counts: dict[str, int]
    activity_counts: dict[str, int]


class AgentCallEdge(BaseModel):
    id: str
    source: str
    target: str
    kind: Literal["call"] = "call"
    task_ids: list[str]
    call_count: int
    active_count: int
    status_counts: dict[str, int]


class AgentGraph(BaseModel):
    nodes: list[AgentNode]
    edges: list[AgentCallEdge]
    calls: list[TaskNode]


def agent_key(task: Task) -> str:
    if task.agent_id:
        return "agent:" + task.agent_id.removeprefix("draft:")
    if task.version_id in ("assistant-v1", "builder-v1"):
        return "builtin:" + task.version_id.removesuffix("-v1")
    # Unknown historical identity must not merge unrelated agents by display name.
    return "unknown:" + task.id


def aggregate_graph(tasks: list[Task], calls: list[TaskNode]) -> AgentGraph:
    identities = {t.id: agent_key(t) for t in tasks}
    groups: dict[str, list[TaskNode]] = {}
    pairs: dict[tuple[str, str], list[TaskNode]] = {}
    for call in calls:
        key = identities[call.id]
        groups.setdefault(key, []).append(call)
        if call.parent_id in identities:
            pair = (identities[call.parent_id], key)
            pairs.setdefault(pair, []).append(call)
    nodes = []
    for key, items in sorted(groups.items()):
        latest = items[-1]
        nodes.append(
            AgentNode(
                id=key,
                agent_id=latest.agent_id.removeprefix("draft:")
                if latest.agent_id
                else None,
                name=latest.name,
                version_ids=sorted({c.version_id for c in items if c.version_id}),
                task_ids=[c.id for c in items],
                call_count=len(items),
                active_count=sum(c.status in ACTIVE for c in items),
                status_counts=dict(Counter(c.status for c in items)),
                activity_counts=dict(Counter(c.activity for c in items)),
            )
        )
    edges = [
        AgentCallEdge(
            id="call:" + json.dumps([source, target], separators=(",", ":")),
            source=source,
            target=target,
            task_ids=[c.id for c in items],
            call_count=len(items),
            active_count=sum(c.status in ACTIVE for c in items),
            status_counts=dict(Counter(c.status for c in items)),
        )
        for (source, target), items in sorted(pairs.items())
    ]
    return AgentGraph(nodes=nodes, edges=edges, calls=calls)


class TaskDetail(TaskNode):
    messages: list[dict]
    questions: list[dict]
    artifacts: list[dict]
    waiting_for: list[str]


class ObservedEvent(BaseModel):
    id: str
    task_id: str
    seq: int
    time: int
    type: str
    data: dict


class EventPage(BaseModel):
    events: list[ObservedEvent]
    next_after: int
    has_more: bool
    log_available: bool


# Explicit public payloads; never expose system prompts, request headers,
# tool-private metadata, or provider diagnostic envelopes.
FIELDS = {
    "llm/retry": ("turn", "step", "retryId", "retry", "maxRetries", "delayMs"),
    "llm/retry-started": ("turn", "step", "retryId", "retry"),
    "turn/start": ("turn",),
    "turn/end": ("turn", "reason"),
    "step/start": ("turn", "step"),
    "step/end": ("turn", "step"),
    "tool/call": ("turn", "step", "callId", "name", "arguments"),
    "tool/result": ("turn", "step", "message"),
    "assistant/message": ("turn", "step", "message", "usage", "interrupted"),
    "assistant/attempt": ("turn", "step"),
    "user/message": ("turn", "step", "content", "source"),
}


def public_event(task_id: str, event: dict) -> ObservedEvent | None:
    kind, data = event["type"], event["data"]
    if kind not in FIELDS:
        return None
    if kind == "user/message" and data.get("source", {}).get("kind") not in (
        "user",
        "user-rpc",
    ):
        return None
    payload = {key: data[key] for key in FIELDS[kind] if key in data}
    if kind == "turn/end":
        payload["reason"] = {"kind": data.get("reason", {}).get("kind")}
    return ObservedEvent(
        id=f"{task_id}:{event['seq']}",
        task_id=task_id,
        seq=event["seq"],
        time=event["time"],
        type=kind,
        data=payload,
    )


class Observation:
    def __init__(self, manager):
        self.manager = manager
        self.read_slots = asyncio.Semaphore(4)

    async def owned_task(self, task_id: str, user: User) -> Task:
        async with self.manager.db.sessions() as session:
            task = await session.scalar(
                select(Task).where(Task.id == task_id, Task.owner_id == user.id)
            )
            if task is None:
                raise HTTPException(404, "Task not found")
            return task

    def node(self, task: Task, waits: list[str]) -> TaskNode:
        attached = task.id in self.manager.live
        activity = task.status
        if task.status in ACTIVE:
            if task.questions and not (attached and task.status == "running"):
                activity = "waiting_user"
            elif waits:
                activity = "waiting_dependency"
            elif attached:
                activity = "executing"
            elif task.status != "queued":
                activity = "resuming_or_transitioning"
        return TaskNode(
            id=task.id,
            root_id=task.root_id,
            parent_id=task.parent_id,
            conversation_id=task.conversation_id,
            agent_id=task.agent_id,
            version_id=task.version_id,
            name=task.definition.get("name", "Agent"),
            prompt=task.prompt,
            status=task.status,
            activity=activity,
            worker_attached=attached,
            created_at=task.created_at,
            finished_at=task.finished_at,
            error=task.error,
            sandbox_requested=task.sandbox,
            revision=task.revision,
        )

    async def graph(self, conversation_id: str, user: User, root_id: str | None):
        async with self.manager.db.sessions() as session:
            owned = await session.scalar(
                select(Conversation.id).where(
                    Conversation.id == conversation_id, Conversation.user_id == user.id
                )
            )
            if owned is None:
                raise HTTPException(404, "Conversation not found")
            query = select(Task).where(
                Task.conversation_id == conversation_id, Task.owner_id == user.id
            )
            if root_id:
                query = query.where(Task.root_id == root_id)
            tasks = list(
                (await session.scalars(query.order_by(Task.created_at, Task.id))).all()
            )
            ids = {task.id for task in tasks}
            active_ids = {task.id for task in tasks if task.status in ACTIVE}
            waits = (
                list(
                    (
                        await session.scalars(
                            select(TaskWait).where(
                                TaskWait.waiter_id.in_(ids),
                                TaskWait.dependency_id.in_(active_ids),
                            )
                        )
                    ).all()
                )
                if ids
                else []
            )
        return aggregate_graph(
            tasks,
            [
                self.node(t, [w.dependency_id for w in waits if w.waiter_id == t.id])
                for t in tasks
            ],
        )

    async def detail(self, task_id: str, user: User) -> TaskDetail:
        task = await self.owned_task(task_id, user)
        async with self.manager.db.sessions() as session:
            waits = list(
                (
                    await session.scalars(
                        select(Task.id)
                        .join(TaskWait, TaskWait.dependency_id == Task.id)
                        .where(
                            TaskWait.waiter_id == task.id,
                            Task.owner_id == user.id,
                            Task.status.in_(ACTIVE),
                        )
                    )
                ).all()
            )
            files = list(
                (
                    await session.scalars(
                        select(Artifact).where(
                            Artifact.task_id == task.id, Artifact.owner_id == user.id
                        )
                    )
                ).all()
            )
        live = self.manager.live.get(task.id)
        return TaskDetail(
            **self.node(task, waits).model_dump(),
            messages=copy.deepcopy(live.messages if live else task.messages),
            questions=task.questions,
            waiting_for=waits,
            artifacts=[
                {
                    "id": f.id,
                    "name": f.name,
                    "size": f.size,
                    "path": f"@artifacts/{f.id}/{f.name}",
                }
                for f in files
            ],
        )

    async def page(self, task_id: str, after: int, limit: int) -> EventPage:
        root = self.manager.sandboxes.root(task_id) / "sessions"
        if not root.is_dir():
            return EventPage(
                events=[], next_after=after, has_more=False, log_available=False
            )
        async with self.read_slots:
            proc = await asyncio.create_subprocess_exec(
                "node",
                str(self.manager.settings.runtime_dir / "observe-session.mjs"),
                str(root),
                task_id,
                str(after + 1),
                str(limit + 1),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
            try:
                output, _ = await asyncio.wait_for(proc.communicate(), 15)
                if proc.returncode:
                    raise HTTPException(503, "Session log temporarily unavailable")
                result = json.loads(output)
            except TimeoutError as exc:
                raise HTTPException(503, "Session log read timed out") from exc
            finally:
                if proc.returncode is None:
                    proc.kill()
                    await proc.wait()
        raw = result["events"][:limit]
        return EventPage(
            events=[p for e in raw if (p := public_event(task_id, e)) is not None],
            next_after=raw[-1]["seq"] if raw else after,
            has_more=len(result["events"]) > limit,
            log_available=result["available"],
        )


def router(auth, manager) -> APIRouter:
    api = APIRouter(prefix="/api", tags=["Observation"])
    observation = Observation(manager)

    @api.get("/conversations/{conversation_id}/graph")
    async def graph(
        conversation_id: str,
        user: Annotated[User, Depends(auth.current_user)],
        root_id: str | None = None,
    ) -> AgentGraph:
        return await observation.graph(conversation_id, user, root_id)

    async def graph_owner(
        conversation_id: str, user: Annotated[User, Depends(auth.current_user)]
    ):
        await observation.graph(conversation_id, user, None)

    @api.get(
        "/conversations/{conversation_id}/graph/events",
        response_class=EventSourceResponse,
        dependencies=[Depends(graph_owner)],
    )
    async def graph_events(
        conversation_id: str,
        request: Request,
        user: Annotated[User, Depends(auth.current_user)],
        token: Annotated[str, Depends(bearer)],
        root_id: str | None = None,
    ) -> AsyncIterable[ServerSentEvent]:
        previous = None
        while not await request.is_disconnected():
            if not await auth.valid_token(token):
                yield ServerSentEvent(event="unauthorized", data={})
                return
            state = await observation.graph(conversation_id, user, root_id)
            serialized = state.model_dump_json()
            if serialized != previous:
                yield ServerSentEvent(event="graph", data=state.model_dump())
                previous = serialized
            # Keep open while the conversation exists, including between runs.
            await asyncio.sleep(1)

    @api.get("/tasks/{task_id}")
    async def detail(
        task_id: str, user: Annotated[User, Depends(auth.current_user)]
    ) -> TaskDetail:
        return await observation.detail(task_id, user)

    @api.get("/tasks/{task_id}/effective-prompt")
    async def effective_prompt(
        task_id: str, user: Annotated[User, Depends(auth.current_user)]
    ) -> dict:
        if not user.is_superuser:
            raise HTTPException(403, "仅管理员可以查看实际提示词。")
        await observation.owned_task(task_id, user)
        path = observation.manager.sandboxes.root(task_id) / "effective-prompt.json"
        if not path.exists():
            return {"available": False, "snapshot": None}
        if path.stat().st_size > 16 * 1024 * 1024:
            raise HTTPException(413, "提示词记录过大，暂不支持在线查看。")
        try:
            snapshot = json.loads(await asyncio.to_thread(path.read_text))
        except (OSError, ValueError):
            raise HTTPException(503, "提示词记录暂时无法读取，请重试。") from None
        return {"available": True, "snapshot": snapshot}

    @api.get("/tasks/{task_id}/history")
    async def history(
        task_id: str,
        user: Annotated[User, Depends(auth.current_user)],
        after: Annotated[int, Query(ge=-1)] = -1,
        limit: Annotated[int, Query(ge=1, le=500)] = 100,
    ) -> EventPage:
        await observation.owned_task(task_id, user)
        return await observation.page(task_id, after, limit)

    async def stream_owner(
        task_id: str,
        user: Annotated[User, Depends(auth.current_user)],
        after: Annotated[int, Query(ge=-1)] = -1,
        last_event_id: Annotated[str | None, Header()] = None,
    ):
        parse_cursor(task_id, after, last_event_id)
        await observation.owned_task(task_id, user)

    @api.get(
        "/tasks/{task_id}/events",
        response_class=EventSourceResponse,
        dependencies=[Depends(stream_owner)],
    )
    async def events(
        task_id: str,
        request: Request,
        user: Annotated[User, Depends(auth.current_user)],
        token: Annotated[str, Depends(bearer)],
        after: Annotated[int, Query(ge=-1)] = -1,
        last_event_id: Annotated[str | None, Header()] = None,
    ) -> AsyncIterable[ServerSentEvent]:
        # Validation lives in a normal dependency below, before SSE headers.
        position = parse_cursor(task_id, after, last_event_id)
        previous = None
        while not await request.is_disconnected():
            if not await auth.valid_token(token):
                yield ServerSentEvent(event="unauthorized", data={})
                return
            try:
                state = await observation.detail(task_id, user)
                page = await observation.page(task_id, position, 100)
            except HTTPException:
                yield ServerSentEvent(event="unavailable", data={"retryable": True})
                return
            serialized = state.model_dump_json()
            if serialized != previous:
                yield ServerSentEvent(event="snapshot", data=state.model_dump())
                previous = serialized
            if page.next_after != position:
                yield ServerSentEvent(
                    event="history",
                    data=page.model_dump(),
                    id=f"{task_id}:{page.next_after}",
                )
                position = page.next_after
            if (
                not page.has_more
                and state.status not in ACTIVE
                and not state.worker_attached
            ):
                yield ServerSentEvent(event="done", data={"after": position})
                return
            if not page.has_more:
                await asyncio.sleep(1)

    return api


def parse_cursor(task_id: str, after: int, last_event_id: str | None) -> int:
    if last_event_id is None:
        return after
    prefix, _, sequence = last_event_id.rpartition(":")
    try:
        value = int(sequence)
    except ValueError as exc:
        raise HTTPException(422, "Invalid Last-Event-ID") from exc
    if prefix != task_id or value < -1:
        raise HTTPException(422, "Invalid Last-Event-ID")
    return value
