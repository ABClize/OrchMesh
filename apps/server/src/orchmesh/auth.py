"""OAuth2 Bearer JWT, matching the official template's authentication model."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jwt.exceptions import InvalidTokenError
from limits import parse
from limits.aio.storage import MemoryStorage
from limits.aio.strategies import MovingWindowRateLimiter
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from .accounts import find_user
from .config import Settings
from .security import create_access_token, decode_subject, password_hash
from .storage import Database, User

bearer = OAuth2PasswordBearer(tokenUrl="/api/login/access-token")


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class Auth:
    def __init__(self, db: Database, settings: Settings, on_login=None):
        self.db = db
        self.secret = settings.secret()
        self.limiter = MovingWindowRateLimiter(MemoryStorage())
        self.router = APIRouter(tags=["auth"])
        # Equal-cost password verification for unknown users.
        dummy_hash = password_hash.hash("unused-dummy-password")

        async def current_user(
            token: Annotated[str, Depends(bearer)],
            session: Annotated[AsyncSession, Depends(db.session)],
        ) -> User:
            user = await self.resolve(token, session)
            if user is None:
                raise HTTPException(
                    401,
                    "Invalid or expired credentials",
                    headers={"WWW-Authenticate": "Bearer"},
                )
            return user

        self.current_user = current_user

        @self.router.post(
            "/api/login/access-token",
            response_model=Token,
            dependencies=[Depends(self.login_limit)],
        )
        async def login(
            response: Response,
            form: Annotated[OAuth2PasswordRequestForm, Depends()],
            session: Annotated[AsyncSession, Depends(db.session)],
        ) -> Token:
            user = await find_user(session, form.username)
            valid, updated = await run_in_threadpool(
                password_hash.verify_and_update,
                form.password,
                user.hashed_password if user else dummy_hash,
            )
            if not user or not valid or not user.is_active:
                raise HTTPException(400, "Incorrect email or password")
            if updated:
                user.hashed_password = updated
                await session.commit()
            if on_login is not None:
                on_login(user.id)
            response.headers["Cache-Control"] = "no-store"
            return Token(
                access_token=create_access_token(
                    user.id, self.secret, settings.access_token_expire_minutes
                )
            )

    async def login_limit(self, request: Request):
        ip = request.client.host if request.client else "unknown"
        if not await self.limiter.hit(parse("10/minute"), "login", ip):
            raise HTTPException(429, "Too many login attempts")

    async def resolve(self, token: str, session: AsyncSession) -> User | None:
        try:
            user_id = decode_subject(token, self.secret)
        except (InvalidTokenError, ValueError, TypeError, KeyError):
            return None
        user = await session.get(User, user_id)
        return user if user and user.is_active else None

    async def valid_token(self, token: str) -> bool:
        async with self.db.sessions() as session:
            return await self.resolve(token, session) is not None
