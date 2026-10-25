import asyncio
import fcntl
import uuid
from collections.abc import AsyncIterable
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette_csrf.middleware import CSRFMiddleware

from .auth import COOKIE, Auth, UserRead
from .config import Settings
from .pi.manager import Busy, Manager
from .storage import Conversation, Database, Run, User


class ConversationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    title: str
    created_at: str


class Prompt(BaseModel):
    text: str = Field(min_length=1, max_length=32000)


class RunRead(BaseModel):
    id: uuid.UUID


class Snapshot(BaseModel):
    messages: list[dict]
    status: str
    run_id: str | None
    cursor: int
    error: str | None = None


def create_app(settings: Settings | None = None, containers=None) -> FastAPI:
    settings = settings or Settings()
    secret = settings.secret()
    db = Database(settings)
    auth = Auth(db, settings)
    manager = Manager(db, settings, containers)

    @asynccontextmanager
    async def lifespan(app):
        with (settings.data_dir / "runtime.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            try:
                await manager.recover()
                yield
            finally:
                await manager.close()
                await db.engine.dispose()

    app = FastAPI(title="OrchMesh", lifespan=lifespan, openapi_url="/api/openapi.json")
    app.state.db, app.state.manager, app.state.auth = db, manager, auth
    app.add_middleware(
        CSRFMiddleware,
        secret=secret,
        cookie_name="orchmesh_csrf",
        header_name="x-csrftoken",
        cookie_secure=settings.cookie_secure,
        cookie_samesite="strict",
    )
    app.include_router(
        auth.users.get_auth_router(auth.backend),
        prefix="/api/auth",
        tags=["auth"],
        dependencies=[Depends(auth.login_limit)],
    )

    async def owned(conversation_id: uuid.UUID, user: User, session: AsyncSession):
        conversation = await session.scalar(
            select(Conversation).where(
                Conversation.id == conversation_id, Conversation.user_id == user.id
            )
        )
        if conversation is None:
            raise HTTPException(404, "Conversation not found")
        return conversation

    async def owned_dependency(
        conversation_id: uuid.UUID,
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
        return (
            await session.scalars(
                select(Conversation)
                .where(Conversation.user_id == user.id)
                .order_by(Conversation.created_at.desc())
            )
        ).all()

    @app.post("/api/conversations", response_model=ConversationRead, status_code=201)
    async def create_conversation(
        user: Annotated[User, Depends(auth.current_user)],
        session: Annotated[AsyncSession, Depends(db.session)],
    ):
        conversation = Conversation(user_id=user.id)
        session.add(conversation)
        await session.commit()
        return conversation

    async def snapshot_for(user, conversation_id, session):
        try:
            result = await manager.history(user.id, conversation_id)
        except Busy as exc:
            raise HTTPException(409, str(exc)) from exc
        except (RuntimeError, TimeoutError):
            raise HTTPException(503, "Pi 历史读取失败，请检查执行镜像和用户配置")
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
        conversation_id: uuid.UUID,
        user: Annotated[User, Depends(auth.current_user)],
        session: Annotated[AsyncSession, Depends(db.session)],
    ):
        await owned(conversation_id, user, session)
        return await snapshot_for(user, conversation_id, session)

    @app.post("/api/conversations/{conversation_id}/runs", status_code=202)
    async def send(
        conversation_id: uuid.UUID,
        body: Prompt,
        user: Annotated[User, Depends(auth.current_user)],
        session: Annotated[AsyncSession, Depends(db.session)],
    ) -> RunRead:
        conversation = await owned(conversation_id, user, session)
        if not body.text.strip():
            raise HTTPException(422, "Message must not be blank")
        try:
            run = await manager.start(user.id, conversation_id, body.text)
        except Busy as exc:
            raise HTTPException(409, str(exc)) from exc
        if conversation.title == "新对话":
            conversation.title = body.text.strip()[:80]
            await session.commit()
        return RunRead(id=run.id)

    @app.post("/api/conversations/{conversation_id}/stop")
    async def stop(
        conversation_id: uuid.UUID,
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
        conversation_id: uuid.UUID,
        request: Request,
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
            if not await auth.valid_session(request.cookies.get(COOKIE)):
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
