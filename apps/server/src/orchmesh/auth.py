import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from fastapi_users import BaseUserManager, FastAPIUsers, UUIDIDMixin, schemas
from fastapi_users.authentication import AuthenticationBackend, CookieTransport
from fastapi_users.authentication.strategy.db import DatabaseStrategy
from fastapi_users.db import SQLAlchemyUserDatabase
from fastapi_users_db_sqlalchemy.access_token import SQLAlchemyAccessTokenDatabase
from limits import parse
from limits.aio.storage import MemoryStorage
from limits.aio.strategies import MovingWindowRateLimiter
from sqlalchemy.ext.asyncio import AsyncSession

from .config import Settings
from .storage import AccessToken, Database, User

COOKIE = "orchmesh_session"
SESSION_SECONDS = 86400


class UserRead(schemas.BaseUser[uuid.UUID]):
    pass


class UserCreate(schemas.BaseUserCreate):
    pass


class UserManager(UUIDIDMixin, BaseUserManager[User, uuid.UUID]):
    async def validate_password(self, password, user):
        from fastapi_users.exceptions import InvalidPasswordException

        if len(password) < 12:
            raise InvalidPasswordException(reason="Use at least 12 characters")


class Auth:
    def __init__(self, db: Database, settings: Settings):

        async def user_db(session: Annotated[AsyncSession, Depends(db.session)]):
            yield SQLAlchemyUserDatabase(session, User)

        async def manager(database=Depends(user_db)):
            yield UserManager(database)

        async def token_db(session: Annotated[AsyncSession, Depends(db.session)]):
            yield SQLAlchemyAccessTokenDatabase(session, AccessToken)

        def strategy(database=Depends(token_db)):
            return DatabaseStrategy(database, lifetime_seconds=SESSION_SECONDS)

        self.backend = AuthenticationBackend(
            name="cookie",
            transport=CookieTransport(
                cookie_name=COOKIE,
                cookie_max_age=SESSION_SECONDS,
                cookie_secure=settings.cookie_secure,
                cookie_samesite="lax",
            ),
            get_strategy=strategy,
        )
        self.users = FastAPIUsers[User, uuid.UUID](manager, [self.backend])
        self.current_user = self.users.current_user(active=True)
        self.db = db
        self.limiter = MovingWindowRateLimiter(MemoryStorage())

    async def login_limit(self, request: Request):
        if request.url.path != "/api/auth/login":
            return
        # Do not trust forwarded headers without a trusted deployment proxy.
        ip = request.client.host if request.client else "unknown"
        if not await self.limiter.hit(parse("10/minute"), "login", ip):
            raise HTTPException(429, "Too many login attempts")

    async def valid_session(self, token: str | None) -> bool:
        async with self.db.sessions() as session:
            users = SQLAlchemyUserDatabase(session, User)
            strategy = DatabaseStrategy(
                SQLAlchemyAccessTokenDatabase(session, AccessToken),
                lifetime_seconds=SESSION_SECONDS,
            )
            user = await strategy.read_token(token, UserManager(users))
            return user is not None and user.is_active
