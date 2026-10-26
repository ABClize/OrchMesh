import uuid
from datetime import UTC, datetime

from sqlalchemy import ForeignKey, String
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
    # Ownership and directory identity only; all navigation state lives in DSH.
    created_at: Mapped[str] = mapped_column(
        default=lambda: datetime.now(UTC).isoformat()
    )


class Conversation(Base):
    __tablename__ = "conversation"
    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("user.id"), index=True)
    directory_id: Mapped[uuid.UUID | None] = mapped_column()
    reasoning: Mapped[str] = mapped_column(
        String(32), default="default", server_default="default"
    )
    created_at: Mapped[str] = mapped_column(
        default=lambda: datetime.now(UTC).isoformat()
    )


class Run(Base):
    __tablename__ = "run"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[str] = mapped_column(
        String(128), ForeignKey("conversation.id")
    )
    status: Mapped[str] = mapped_column(default="running")
    created_at: Mapped[str] = mapped_column(
        default=lambda: datetime.now(UTC).isoformat()
    )


class Database:
    def __init__(self, settings: Settings):
        self.engine = create_async_engine(settings.database_url)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)

    async def session(self):
        async with self.sessions() as session:
            yield session
