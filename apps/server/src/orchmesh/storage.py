import uuid
from datetime import UTC, datetime

from sqlalchemy import JSON, String, Text, UniqueConstraint
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from .config import Settings


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "user"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(1024))
    is_active: Mapped[bool] = mapped_column(default=True)
    is_superuser: Mapped[bool] = mapped_column(default=False)
    is_verified: Mapped[bool] = mapped_column(default=False)


class Project(Base):
    __tablename__ = "project"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(index=True)
    native_id: Mapped[str | None] = mapped_column(String(80))
    name: Mapped[str] = mapped_column(default="历史工作区")
    # Retained only as the immutable owner binding for legacy files.
    created_at: Mapped[str] = mapped_column(
        default=lambda: datetime.now(UTC).isoformat()
    )


class Conversation(Base):
    __tablename__ = "conversation"
    title: Mapped[str] = mapped_column(default="新对话")
    pinned: Mapped[bool] = mapped_column(default=False)
    archived: Mapped[bool] = mapped_column(default=False)
    legacy: Mapped[bool] = mapped_column(default=False)
    legacy_messages: Mapped[list] = mapped_column(JSON, default=list)
    agent_id: Mapped[str | None] = mapped_column(String(64))
    creator: Mapped[bool] = mapped_column(default=False)

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(index=True)
    directory_id: Mapped[uuid.UUID | None] = mapped_column()
    model_id: Mapped[str | None] = mapped_column(String(128))
    reasoning: Mapped[str] = mapped_column(
        String(32), default="default", server_default="default"
    )
    created_at: Mapped[str] = mapped_column(
        default=lambda: datetime.now(UTC).isoformat()
    )


class Run(Base):
    __tablename__ = "run"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[str] = mapped_column(String(128), index=True)
    status: Mapped[str] = mapped_column(default="running")
    created_at: Mapped[str] = mapped_column(
        default=lambda: datetime.now(UTC).isoformat()
    )


class AgentDefinition(Base):
    __tablename__ = "agent_definition"
    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(index=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    draft: Mapped[dict] = mapped_column(JSON, default=dict)
    published_version: Mapped[str | None] = mapped_column(String(64))
    archived: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[str] = mapped_column(
        default=lambda: datetime.now(UTC).isoformat()
    )


class AgentVersion(Base):
    __tablename__ = "agent_version"
    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    agent_id: Mapped[str] = mapped_column(String(64), index=True)
    definition: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[str] = mapped_column(
        default=lambda: datetime.now(UTC).isoformat()
    )


class AgentComment(Base):
    __tablename__ = "agent_comment"
    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    agent_id: Mapped[str] = mapped_column(String(64), index=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(index=True)
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(
        default=lambda: datetime.now(UTC).isoformat()
    )


class Task(Base):
    __tablename__ = "task"
    __table_args__ = (UniqueConstraint("owner_id", "request_id"),)
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(index=True)
    request_id: Mapped[str] = mapped_column(String(128))
    conversation_id: Mapped[str] = mapped_column(String(128), index=True)
    root_id: Mapped[str] = mapped_column(String(64), index=True)
    parent_id: Mapped[str | None] = mapped_column(String(64), index=True)
    agent_id: Mapped[str | None] = mapped_column(String(64))
    version_id: Mapped[str | None] = mapped_column(String(64))
    definition: Mapped[dict] = mapped_column(JSON)
    continuation_prompt: Mapped[str | None] = mapped_column(Text)
    platform_prompt: Mapped[str | None] = mapped_column(Text)
    prompt: Mapped[str] = mapped_column(Text)
    context: Mapped[list] = mapped_column(JSON, default=list)
    model: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    messages: Mapped[list] = mapped_column(JSON, default=list)
    questions: Mapped[list] = mapped_column(JSON, default=list)
    finished_at: Mapped[str | None] = mapped_column(String(64))
    sandbox: Mapped[bool] = mapped_column(default=False)
    a2a_id: Mapped[str | None] = mapped_column(String(128))
    a2a_context: Mapped[str | None] = mapped_column(String(128))
    error: Mapped[str | None] = mapped_column(Text)
    revision: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[str] = mapped_column(
        default=lambda: datetime.now(UTC).isoformat()
    )


class ToolReceipt(Base):
    __tablename__ = "tool_receipt"
    id: Mapped[str] = mapped_column(String(256), primary_key=True)
    task_id: Mapped[str] = mapped_column(String(64), index=True)
    result: Mapped[dict] = mapped_column(JSON)


class Answer(Base):
    __tablename__ = "task_answer"
    id: Mapped[str] = mapped_column(String(256), primary_key=True)
    task_id: Mapped[str] = mapped_column(String(64), index=True)
    call_id: Mapped[str] = mapped_column(String(128))
    answer: Mapped[dict] = mapped_column(JSON)


class Artifact(Base):
    __tablename__ = "artifact"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(index=True)
    task_id: Mapped[str] = mapped_column(String(64), index=True)
    conversation_id: Mapped[str] = mapped_column(String(128), index=True)
    name: Mapped[str] = mapped_column(String(255))
    path: Mapped[str] = mapped_column(Text)
    digest: Mapped[str] = mapped_column(String(64))
    size: Mapped[int] = mapped_column()
    created_at: Mapped[str] = mapped_column(
        default=lambda: datetime.now(UTC).isoformat()
    )


class Memory(Base):
    __tablename__ = "memory"
    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(index=True)
    agent_id: Mapped[str | None] = mapped_column(String(64), index=True)
    content: Mapped[str] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[str] = mapped_column(
        default=lambda: datetime.now(UTC).isoformat()
    )


class Preference(Base):
    __tablename__ = "preference"
    owner_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    memory_enabled: Mapped[bool] = mapped_column(default=True)


class Knowledge(Base):
    __tablename__ = "knowledge"
    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(index=True)
    agent_id: Mapped[str | None] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(255))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(
        default=lambda: datetime.now(UTC).isoformat()
    )


class Database:
    def __init__(self, settings: Settings):
        self.engine = create_async_engine(settings.database_url, hide_parameters=True)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)

    async def session(self):
        async with self.sessions() as session:
            yield session


async def require_record(session, model, identifier):
    """Read a business invariant without treating missing rows as valid state."""
    record = await session.get(model, identifier)
    if record is None:
        raise ValueError(f"Missing {model.__tablename__} record")
    return record


class TaskWait(Base):
    mode: Mapped[str] = mapped_column(String(8), default="all", server_default="all")
    __tablename__ = "task_wait"
    waiter_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    dependency_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    root_id: Mapped[str] = mapped_column(String(64), index=True)
