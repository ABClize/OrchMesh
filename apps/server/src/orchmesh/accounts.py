"""Account persistence shared by CLI/bootstrap and authentication."""

import uuid

from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from .security import password_hash
from .storage import User


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    email: str
    is_active: bool
    is_superuser: bool
    is_verified: bool


class UserCreate(BaseModel):
    model_config = ConfigDict(hide_input_in_errors=True)
    email: EmailStr
    password: str = Field(min_length=12, repr=False)
    is_superuser: bool = False


async def find_user(session: AsyncSession, email: str) -> User | None:
    return await session.scalar(
        select(User).where(func.lower(User.email) == email.lower())
    )


async def create_account(session: AsyncSession, values: UserCreate) -> User:
    if await find_user(session, str(values.email)):
        raise ValueError("User already exists")
    user = User(
        email=str(values.email),
        hashed_password=await run_in_threadpool(password_hash.hash, values.password),
        is_superuser=values.is_superuser,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user
