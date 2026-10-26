import asyncio
import fcntl
import time
import uuid
from collections.abc import AsyncIterable
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .accounts import UserRead
from .auth import Auth, bearer
from .bootstrap import bootstrap
from .config import Settings
from .dsh.manager import Busy, Manager
from .logging import application_logging, failure, logger
from .projects import owned_project
from .projects import router as projects_router
from .storage import Conversation, Database, Run, User
from .workspace import router as workspace_router


class APIError(BaseModel):
    detail: str


class ConversationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    title: str
    reasoning: str
    project_id: uuid.UUID | None
    directory_id: uuid.UUID | None
    pinned: bool
    archived: bool
    created_at: str


class ConversationCreate(BaseModel):
    project_id: uuid.UUID | None = None


class ConversationUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, min_length=1, max_length=120, pattern=r"\S")
    pinned: bool | None = None
    archived: bool | None = None


class ReasoningPreference(BaseModel):
    reasoning: str = Field(max_length=32)


class Prompt(BaseModel):
    text: str = Field(min_length=1, max_length=32000)


class RunRead(BaseModel):
    id: uuid.UUID


class Snapshot(BaseModel):
    messages: list[dict]
    status: str
    run_id: str | None
    cursor: int
    read_only: bool = False
    error: str | None = None


def create_app(settings: Settings | None = None, containers=None) -> FastAPI:
    settings = settings or Settings()
    settings.secret()
    db = Database(settings)
    auth = Auth(db, settings)
    manager = Manager(db, settings, containers)

    @asynccontextmanager
    async def lifespan(app):
        with (settings.data_dir / "runtime.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with application_logging(settings):
                try:
                    await manager.recover()
                    await bootstrap(db, settings)
                    yield
                finally:
                    await manager.close()
                    await db.engine.dispose()

    app = FastAPI(
        title="OrchMesh",
        lifespan=lifespan,
        openapi_url="/api/openapi.json",
        responses={401: {"model": APIError}, 500: {"model": APIError}},
    )
    app.state.db, app.state.manager, app.state.auth = db, manager, auth
    app.include_router(auth.router)
    app.include_router(workspace_router(settings, auth, db))
    app.include_router(projects_router(settings, auth, db, manager.navigation))

    @app.exception_handler(Busy)
    async def busy_handler(request, exc):
        return JSONResponse(status_code=409, content={"detail": str(exc)})

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

    async def owned(conversation_id: str, user: User, session: AsyncSession):
        conversation = await session.scalar(
            select(Conversation).where(
                Conversation.id == conversation_id, Conversation.user_id == user.id
            )
        )
        if conversation is None:
            raise HTTPException(404, "Conversation not found")
        return conversation

    async def owned_dependency(
        conversation_id: str,
        user: Annotated[User, Depends(auth.current_user)],
        session: Annotated[AsyncSession, Depends(db.session)],
    ):
        return await owned(conversation_id, user, session)

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/me", response_model=UserRead)
    async def me(user: Annotated[User, Depends(auth.current_user)]):
        return user

    @app.get("/api/conversations", response_model=list[ConversationRead])
    async def conversations(
        user: Annotated[User, Depends(auth.current_user)],
        session: Annotated[AsyncSession, Depends(db.session)],
    ):
        return (await manager.navigation.snapshot(user.id))["conversations"]

    @app.post("/api/conversations", response_model=ConversationRead, status_code=201)
    async def create_conversation(
        user: Annotated[User, Depends(auth.current_user)],
        session: Annotated[AsyncSession, Depends(db.session)],
        body: ConversationCreate | None = None,
    ):
        project_id = body.project_id if body else None
        project = (
            await owned_project(session, user.id, project_id) if project_id else None
        )
        async with manager.navigation.transaction(user.id):
            result = await manager.control(
                user.id,
                "session/create",
                workspace_id=project_id,
                **({"workspaceId": project.native_id} if project else {}),
            )
            conversation = Conversation(
                id=result["sessionId"], user_id=user.id, directory_id=project_id
            )
            session.add(conversation)
            await session.commit()
        return await manager.navigation.conversation(user.id, conversation.id)

    @app.patch("/api/conversations/{conversation_id}", response_model=ConversationRead)
    async def update_conversation(
        conversation_id: str,
        body: ConversationUpdate,
        user: Annotated[User, Depends(auth.current_user)],
        session: Annotated[AsyncSession, Depends(db.session)],
    ):
        await owned(conversation_id, user, session)
        run = manager.active.get(user.id)
        if body.archived and run and run.conversation_id == conversation_id:
            raise HTTPException(409, "Stop the running task before archiving")
        if body.title is not None:
            async with manager.navigation.transaction(user.id):
                await manager.control(
                    user.id,
                    "session/rename",
                    conversation_id=conversation_id,
                    sessionId=str(conversation_id),
                    title=body.title.strip(),
                )
        changes = body.model_dump(exclude_none=True, exclude={"title"})
        if changes:
            await manager.navigation.update(user.id, conversation_id, **changes)
        return await manager.navigation.conversation(user.id, conversation_id)

    @app.post(
        "/api/conversations/{conversation_id}/fork",
        response_model=ConversationRead,
        status_code=201,
    )
    async def fork_conversation(
        conversation_id: str,
        user: Annotated[User, Depends(auth.current_user)],
        session: Annotated[AsyncSession, Depends(db.session)],
    ):
        source = await owned(conversation_id, user, session)
        async with manager.navigation.transaction(user.id):
            result = await manager.control(
                user.id,
                "session/fork",
                conversation_id=conversation_id,
                sessionId=str(conversation_id),
            )
            child = Conversation(
                id=result["sessionId"],
                user_id=user.id,
                directory_id=source.directory_id,
                reasoning=source.reasoning,
            )
            session.add(child)
            await session.commit()
        return await manager.navigation.conversation(user.id, child.id)

    @app.get("/api/model")
    async def model_info(user: Annotated[User, Depends(auth.current_user)]) -> dict:
        try:
            return await manager.model_info(user.id)
        except Busy as exc:
            raise HTTPException(409, str(exc)) from exc
        except Exception as exc:
            failure("model.info_failure", exc)
            raise HTTPException(503, "模型能力读取失败，请检查配置") from None

    @app.put(
        "/api/conversations/{conversation_id}/reasoning",
        response_model=ConversationRead,
    )
    async def reasoning_preference(
        conversation_id: str,
        body: ReasoningPreference,
        user: Annotated[User, Depends(auth.current_user)],
        session: Annotated[AsyncSession, Depends(db.session)],
    ):
        conversation = await owned(conversation_id, user, session)
        if user.id in manager.active:
            raise HTTPException(409, "请先等待当前任务结束")
        if body.reasoning != "default":
            info = await model_info(user)
            if body.reasoning not in [e["id"] for e in info["efforts"]]:
                raise HTTPException(422, "模型不支持此思考等级")
        conversation.reasoning = body.reasoning
        await session.commit()
        return await manager.navigation.conversation(user.id, conversation_id)

    async def snapshot_for(user, conversation_id, session):
        try:
            result = await manager.history(user.id, conversation_id)
        except Busy as exc:
            raise HTTPException(409, str(exc)) from exc
        except (RuntimeError, TimeoutError) as exc:
            failure("history.failure", exc, conversation_id=conversation_id)
            raise HTTPException(503, "DSH 历史读取失败，请检查执行镜像和用户配置")
        if result["status"] == "idle":
            last = await session.scalar(
                select(Run)
                .where(Run.conversation_id == conversation_id)
                .order_by(Run.created_at.desc())
                .limit(1)
            )
            if last:
                result["status"] = last.status
                if last.status in ("failed", "interrupted"):
                    result["error"] = "上次执行失败或中断，请检查配置后重新发送。"
        return result

    @app.get("/api/conversations/{conversation_id}", response_model=Snapshot)
    async def snapshot(
        conversation_id: str,
        user: Annotated[User, Depends(auth.current_user)],
        session: Annotated[AsyncSession, Depends(db.session)],
    ):
        await owned(conversation_id, user, session)
        return await snapshot_for(user, conversation_id, session)

    @app.post("/api/conversations/{conversation_id}/runs", status_code=202)
    async def send(
        conversation_id: str,
        body: Prompt,
        user: Annotated[User, Depends(auth.current_user)],
        session: Annotated[AsyncSession, Depends(db.session)],
    ) -> RunRead:
        conversation = await owned(conversation_id, user, session)
        state = await manager.navigation.conversation(user.id, conversation_id)
        if state["archived"]:
            raise HTTPException(409, "Restore the conversation before sending")
        if not body.text.strip():
            raise HTTPException(422, "Message must not be blank")
        try:
            run = await manager.start(
                user.id, conversation_id, body.text, conversation.reasoning
            )
        except Busy as exc:
            raise HTTPException(409, str(exc)) from exc
        return RunRead(id=run.id)

    @app.post("/api/conversations/{conversation_id}/stop")
    async def stop(
        conversation_id: str,
        user: Annotated[User, Depends(auth.current_user)],
        session: Annotated[AsyncSession, Depends(db.session)],
    ) -> dict[str, str]:
        await owned(conversation_id, user, session)
        run = manager.active.get(user.id)
        if run and run.conversation_id == conversation_id:
            await manager.stop(run)
        return {"status": "stopped"}

    @app.get(
        "/api/conversations/{conversation_id}/events",
        response_class=EventSourceResponse,
        dependencies=[Depends(owned_dependency)],
    )
    async def events(
        conversation_id: str,
        request: Request,
        token: Annotated[str, Depends(bearer)],
        user: Annotated[User, Depends(auth.current_user)],
        session: Annotated[AsyncSession, Depends(db.session)],
    ) -> AsyncIterable[ServerSentEvent]:
        run = manager.active.get(user.id)
        if not run or run.conversation_id != conversation_id:
            yield ServerSentEvent(
                event="update",
                data={
                    "type": "snapshot",
                    **await snapshot_for(user, conversation_id, session),
                },
            )
            return
        # Snapshot on connection avoids gaps, stale cursors and replay races.
        cursor = run.sequence
        yield ServerSentEvent(
            event="update", data={"type": "snapshot", **run.snapshot()}, id=str(cursor)
        )
        while True:
            if not await auth.valid_token(token):
                yield ServerSentEvent(event="unauthorized", data={})
                return
            if await request.is_disconnected():
                return
            if run.events and cursor < run.events[0][0] - 1:
                cursor = run.sequence
                yield ServerSentEvent(
                    event="update",
                    data={"type": "snapshot", **run.snapshot()},
                    id=str(cursor),
                )
            else:
                # Copy bounded queue; yielding allows producer to advance.
                for sequence, event in list(run.events):
                    if sequence > cursor:
                        cursor = sequence
                        yield ServerSentEvent(
                            event="update", data=event, id=str(sequence)
                        )
            if run.finished and cursor == run.sequence:
                return
            run.changed.clear()
            # Check sequence after clearing to avoid losing a wakeup.
            if cursor != run.sequence:
                continue
            try:
                await asyncio.wait_for(run.changed.wait(), timeout=1)
            except TimeoutError:
                yield ServerSentEvent(comment="keepalive")

    # Unknown API paths must not resolve to the SPA.
    @app.api_route(
        "/api/{path:path}",
        methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
        include_in_schema=False,
    )
    async def unknown_api(path: str):
        raise HTTPException(404, "Not found")

    if settings.web_dir.is_dir():
        app.frontend("/", directory=str(settings.web_dir))
    return app


app = create_app()
