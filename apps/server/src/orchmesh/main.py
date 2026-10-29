import asyncio
import fcntl
import time
import uuid
from collections.abc import AsyncIterable
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from .accounts import UserRead
from .auth import Auth, bearer
from .bootstrap import bootstrap
from .config import Settings
from .logging import application_logging, failure, logger
from .projects import ProjectRead
from .storage import Artifact, Conversation, Database, User
from .workspace import router as workspace_router


class APIError(BaseModel):
    detail: str


class ConversationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    title: str
    reasoning: str
    model_id: str | None = None
    project_id: uuid.UUID | None
    directory_id: uuid.UUID | None
    pinned: bool
    archived: bool
    created_at: str


class ConversationCreate(BaseModel):
    agent_id: str | None = None
    creator: bool = False
    project_id: uuid.UUID | None = None


class ConversationUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, min_length=1, max_length=120, pattern=r"\S")
    pinned: bool | None = None
    archived: bool | None = None


class ReasoningPreference(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reasoning: str | None = Field(default=None, max_length=32)
    model_id: str | None = Field(default=None, min_length=1, max_length=128)


class QuestionAnswer(BaseModel):
    call_id: str
    answer: dict


class Prompt(BaseModel):
    request_id: str = Field(default_factory=lambda: str(uuid.uuid4()), max_length=128)
    text: str = Field(min_length=1, max_length=32000)
    review_tools: bool = False


class RunRead(BaseModel):
    id: uuid.UUID


class Snapshot(BaseModel):
    messages: list[dict]
    status: str
    run_id: str | None
    cursor: int
    read_only: bool = False
    activity: dict | None = None
    error: str | None = None


def create_app(settings: Settings | None = None, containers=None) -> FastAPI:
    from .model_settings import router as model_settings_router
    from .platform.catalog import router as catalog_router
    from .platform.engine import ACTIVE, Engine
    from .platform.protocol import Protocol
    from .prompt_settings import router as prompt_settings_router
    from .storage import Project, Task

    settings = settings or Settings()
    settings.secret()
    db = Database(settings)
    manager = Engine(db, settings)
    auth = Auth(db, settings)

    @asynccontextmanager
    async def lifespan(app):
        with (settings.data_dir / "runtime.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with application_logging(settings):
                try:
                    await bootstrap(db, settings)
                    assert manager.protocol is not None
                    await manager.protocol.initialize()
                    await manager.start()
                    yield
                finally:
                    await manager.close()
                    await db.engine.dispose()

    app = FastAPI(title="OrchMesh", lifespan=lifespan, openapi_url="/api/openapi.json")
    from fastapi.exceptions import RequestValidationError
    from fastapi.responses import JSONResponse

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request, error):
        return JSONResponse(
            status_code=422,
            content={
                "detail": [
                    {key: item[key] for key in ("loc", "msg", "type")}
                    for item in error.errors()
                ]
            },
        )

    app.state.db, app.state.manager, app.state.auth = db, manager, auth
    app.include_router(model_settings_router(settings, auth, db))
    app.include_router(prompt_settings_router(settings, auth))
    from .platform.skills import router as skills_router

    app.include_router(skills_router(settings, auth, db))
    app.include_router(auth.router)
    app.include_router(workspace_router(settings, auth, db))
    app.include_router(catalog_router(auth, db))
    from .platform.inputs import router as inputs_router

    app.include_router(inputs_router(auth, db, settings))
    from .platform.observation import router as observation_router

    app.include_router(observation_router(auth, manager))
    from .admin import router as admin_router

    app.include_router(admin_router(auth, db, manager))
    manager.protocol = Protocol(manager, auth, app)

    @app.middleware("http")
    async def request_log(request: Request, call_next):
        started = time.monotonic()
        request_id = uuid.uuid4().hex
        try:
            response = await call_next(request)
        except Exception as exc:
            failure("http.failure", exc, request_id=request_id)
            raise
        # Route templates exclude query strings, credentials and user-supplied paths.
        route = getattr(request.scope.get("route"), "path", "unmatched")
        logger.info(
            "http.response request_id=%s method=%s route=%s status=%s headers_ms=%.1f",
            request_id,
            request.method,
            route,
            response.status_code,
            (time.monotonic() - started) * 1000,
        )
        response.headers["X-Request-ID"] = request_id
        return response

    def read(conversation):
        return {
            "id": conversation.id,
            "title": conversation.title,
            "reasoning": conversation.reasoning,
            "model_id": conversation.model_id,
            "project_id": conversation.directory_id,
            "directory_id": conversation.directory_id,
            "pinned": conversation.pinned,
            "archived": conversation.archived,
            "created_at": conversation.created_at,
        }

    async def owned(identifier, user):
        async with db.sessions() as session:
            value = await session.get(Conversation, identifier)
            if not value or value.user_id != user.id:
                raise HTTPException(404, "Conversation not found")
            return value

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/me", response_model=UserRead)
    async def me(user: Annotated[User, Depends(auth.current_user)]):
        return user

    @app.get("/api/projects", response_model=list[ProjectRead])
    async def projects(user: Annotated[User, Depends(auth.current_user)]) -> list[dict]:
        async with db.sessions() as session:
            rows = (
                await session.scalars(select(Project).where(Project.user_id == user.id))
            ).all()
        return [
            {"id": str(row.id), "name": row.name, "created_at": row.created_at}
            for row in rows
        ]

    @app.get("/api/conversations", response_model=list[ConversationRead])
    async def conversations(user: Annotated[User, Depends(auth.current_user)]):
        async with db.sessions() as session:
            rows = (
                await session.scalars(
                    select(Conversation)
                    .where(Conversation.user_id == user.id)
                    .order_by(Conversation.created_at.desc())
                )
            ).all()
        return [read(row) for row in rows]

    @app.post("/api/conversations", response_model=ConversationRead, status_code=201)
    async def create_conversation(
        user: Annotated[User, Depends(auth.current_user)],
        body: ConversationCreate | None = None,
    ):
        value = Conversation(
            id=str(uuid.uuid4()),
            user_id=user.id,
            agent_id=body.agent_id if body else None,
            creator=body.creator if body else False,
        )
        async with db.sessions.begin() as session:
            session.add(value)
        return read(value)

    @app.patch("/api/conversations/{conversation_id}", response_model=ConversationRead)
    async def update(
        conversation_id: str,
        body: ConversationUpdate,
        user: Annotated[User, Depends(auth.current_user)],
    ):
        async with db.sessions.begin() as session:
            value = await session.scalar(
                select(Conversation)
                .where(
                    Conversation.id == conversation_id, Conversation.user_id == user.id
                )
                .with_for_update()
            )
            if value is None:
                raise HTTPException(404, "Conversation not found")
            if body.archived and await session.scalar(
                select(Task.id)
                .where(Task.conversation_id == conversation_id, Task.status.in_(ACTIVE))
                .limit(1)
            ):
                raise HTTPException(409, "Stop active tasks before archiving")
            for key, item in body.model_dump(exclude_none=True).items():
                setattr(value, key, item.strip() if isinstance(item, str) else item)
        return read(value)

    @app.delete("/api/conversations/{conversation_id}")
    async def delete_conversation(
        conversation_id: str, user: Annotated[User, Depends(auth.current_user)]
    ) -> dict[str, str]:
        async with db.sessions.begin() as session:
            value = await session.scalar(
                select(Conversation)
                .where(
                    Conversation.id == conversation_id, Conversation.user_id == user.id
                )
                .with_for_update()
            )
            if value is None:
                raise HTTPException(404, "Conversation not found")
            if not value.archived:
                raise HTTPException(409, "Archive conversation before deleting")
            if await session.scalar(
                select(Task.id)
                .where(Task.conversation_id == conversation_id, Task.status.in_(ACTIVE))
                .limit(1)
            ):
                raise HTTPException(409, "Stop active tasks before deleting")
            # Execution audit and delivered files have independent ownership.
            await session.delete(value)
        return {"status": "deleted"}

    @app.post(
        "/api/conversations/{conversation_id}/fork",
        response_model=ConversationRead,
        status_code=201,
    )
    async def fork(
        conversation_id: str, user: Annotated[User, Depends(auth.current_user)]
    ):
        source = await owned(conversation_id, user)
        state = await snapshot_for(source)
        value = Conversation(
            id=str(uuid.uuid4()),
            user_id=user.id,
            title=source.title + " · 继续",
            directory_id=source.directory_id,
            reasoning=source.reasoning,
            model_id=source.model_id,
            legacy_messages=state["messages"],
            agent_id=source.agent_id,
        )
        async with db.sessions.begin() as session:
            session.add(value)
        return read(value)

    @app.get("/api/model")
    async def model(user: Annotated[User, Depends(auth.current_user)]) -> dict:
        profiles = settings.model_profiles()
        default = settings.resolve_model().key if profiles else None
        return {
            "default_model": default,
            "models": [
                {
                    "id": p.key,
                    "name": p.name,
                    "efforts": [{"id": key, "label": key} for key in p.effort_ids],
                }
                for p in profiles
            ],
        }

    @app.put(
        "/api/conversations/{conversation_id}/reasoning",
        response_model=ConversationRead,
    )
    async def reasoning(
        conversation_id: str,
        body: ReasoningPreference,
        user: Annotated[User, Depends(auth.current_user)],
    ):
        await owned(conversation_id, user)
        async with db.sessions.begin() as session:
            value = await session.scalar(
                select(Conversation)
                .where(
                    Conversation.id == conversation_id, Conversation.user_id == user.id
                )
                .with_for_update()
            )
            if value is None:
                raise HTTPException(404, "Conversation not found")
            if (
                value.archived
                or value.legacy
                or await session.scalar(
                    select(Task.id)
                    .where(
                        Task.conversation_id == conversation_id, Task.status.in_(ACTIVE)
                    )
                    .limit(1)
                )
            ):
                raise HTTPException(409, "Conversation settings are read-only")
            try:
                selected = settings.resolve_model(body.model_id or value.model_id)
            except ValueError as error:
                raise HTTPException(422, str(error)) from error
            effort = body.reasoning if body.reasoning is not None else value.reasoning
            if effort != "default" and effort not in selected.effort_ids:
                if body.reasoning is not None:
                    raise HTTPException(
                        422, "Unsupported reasoning level for selected model"
                    )
                effort = "default"
            value.model_id = selected.key
            value.reasoning = effort
        return read(value)

    async def snapshot_for(conversation):
        async with db.sessions() as session:
            tasks = list(
                (
                    await session.scalars(
                        select(Task)
                        .where(
                            Task.conversation_id == conversation.id,
                            Task.parent_id.is_(None),
                        )
                        .order_by(Task.created_at)
                    )
                ).all()
            )
        messages = list(conversation.legacy_messages)
        for task in tasks:
            projection = manager.live.get(task.id)
            messages.extend(projection.messages if projection else task.messages)
        last = tasks[-1] if tasks else None
        status = (
            ("running" if last.status in ACTIVE else last.status) if last else "idle"
        )
        return {
            "messages": messages,
            "status": status,
            "run_id": last.id if last else None,
            "cursor": len(messages),
            "read_only": conversation.legacy,
            "error": last.error if last else None,
        }

    @app.get("/api/conversations/{conversation_id}", response_model=Snapshot)
    async def snapshot(
        conversation_id: str, user: Annotated[User, Depends(auth.current_user)]
    ):
        return await snapshot_for(await owned(conversation_id, user))

    @app.post("/api/conversations/{conversation_id}/runs", status_code=202)
    async def send(
        conversation_id: str,
        body: Prompt,
        user: Annotated[User, Depends(auth.current_user)],
    ) -> RunRead:
        conversation = await owned(conversation_id, user)
        if conversation.legacy or conversation.archived:
            raise HTTPException(
                409, "Continue this historical conversation in a new task"
            )
        if not body.text.strip():
            raise HTTPException(422, "Message must not be blank")
        identifier = await manager.admit(
            user.id, conversation_id, body.text, body.request_id
        )
        return RunRead(id=uuid.UUID(identifier))

    @app.post("/api/conversations/{conversation_id}/stop")
    async def stop(
        conversation_id: str, user: Annotated[User, Depends(auth.current_user)]
    ) -> dict[str, str]:
        await owned(conversation_id, user)
        await manager.stop(user.id, conversation_id)
        return {"status": "stopped"}

    @app.get("/api/conversations/{conversation_id}/tasks")
    async def tasks(
        conversation_id: str, user: Annotated[User, Depends(auth.current_user)]
    ) -> list[dict]:
        await owned(conversation_id, user)
        async with db.sessions() as session:
            values = (
                await session.scalars(
                    select(Task)
                    .where(
                        Task.conversation_id == conversation_id,
                        Task.owner_id == user.id,
                    )
                    .order_by(Task.created_at)
                )
            ).all()
            artifacts = (
                await session.scalars(
                    select(Artifact).where(
                        Artifact.conversation_id == conversation_id,
                        Artifact.owner_id == user.id,
                        Artifact.task_id != "input",
                    )
                )
            ).all()
        return [
            {
                "id": t.id,
                "parent_id": t.parent_id,
                "agent_id": t.agent_id,
                "prompt": t.prompt,
                "status": t.status,
                "questions": t.questions,
                "sandbox": t.sandbox,
                "artifacts": [
                    {
                        "name": item.name,
                        "size": item.size,
                        "path": f"@artifacts/{item.id}/{item.name}",
                    }
                    for item in artifacts
                    if item.task_id == t.id
                ],
            }
            for t in values
        ]

    @app.post("/api/tasks/{task_id}/answers")
    async def answer(
        task_id: str,
        body: QuestionAnswer,
        user: Annotated[User, Depends(auth.current_user)],
    ) -> dict:
        from dbos import DBOS

        from .storage import Answer

        async with db.sessions.begin() as session:
            task = await session.get(Task, task_id)
            if not task or task.owner_id != user.id:
                raise HTTPException(404, "Task not found")
            key = f"{task_id}:{body.call_id}"
            old = await session.get(Answer, key)
            if old and old.answer != body.answer:
                raise HTTPException(409, "Question already answered differently")
            if not old:
                pending = next(
                    (q for q in task.questions if q["callId"] == body.call_id), None
                )
                if pending is None or task.status not in ("running", "waiting"):
                    raise HTTPException(409, "Question is not pending")
                answers = body.answer.get("answers")
                expected = {q["id"] for q in pending["questions"]}
                if (
                    not isinstance(answers, list)
                    or len(answers) != len(expected)
                    or any(not isinstance(a, dict) for a in answers)
                    or {a.get("id") for a in answers} != expected
                    or any(
                        not isinstance(a.get("selected", []), list)
                        or not isinstance(a.get("custom", ""), str)
                        or not (a.get("selected") or a.get("custom", "").strip())
                        for a in answers
                    )
                ):
                    raise HTTPException(422, "Answer every pending question")
                session.add(
                    Answer(
                        id=key,
                        task_id=task_id,
                        call_id=body.call_id,
                        answer=body.answer,
                    )
                )
        await DBOS.send_async(
            task_id, body.model_dump(), topic="answer", idempotency_key=key
        )
        return {"status": "accepted"}

    async def event_owner(
        conversation_id: str, user: Annotated[User, Depends(auth.current_user)]
    ):
        await owned(conversation_id, user)

    @app.get(
        "/api/conversations/{conversation_id}/events",
        response_class=EventSourceResponse,
        dependencies=[Depends(event_owner)],
    )
    async def events(
        conversation_id: str,
        request: Request,
        token: Annotated[str, Depends(bearer)],
        user: Annotated[User, Depends(auth.current_user)],
    ) -> AsyncIterable[ServerSentEvent]:
        conversation = await owned(conversation_id, user)
        while not await request.is_disconnected():
            if not await auth.valid_token(token):
                yield ServerSentEvent(event="unauthorized", data={})
                return
            state = await snapshot_for(conversation)
            yield ServerSentEvent(event="update", data={"type": "snapshot", **state})
            if state["status"] != "running":
                return
            await asyncio.sleep(0.3)

    @app.api_route(
        "/api/{path:path}",
        methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
        include_in_schema=False,
    )
    async def unknown(path: str):
        raise HTTPException(404, "Not found")

    if settings.web_dir.is_dir():
        app.frontend("/", directory=str(settings.web_dir))
    return app


app = create_app()
