"""First-run account and runtime model configuration, under the API instance lock."""

from pydantic import ValidationError
from sqlalchemy import select

from .accounts import UserCreate, create_account, find_user
from .config import Settings
from .dsh.configuration import sync_model, validate_model
from .storage import Database, User


async def bootstrap(db: Database, settings: Settings) -> None:
    email = settings.bootstrap_admin_email
    password = settings.bootstrap_admin_password.get_secret_value()
    validate_model(settings)
    async with db.sessions() as session:
        user = (
            await find_user(session, email)
            if email
            else await session.scalar(
                select(User).where(User.__table__.c.is_superuser.is_(True))
            )
        )
        if not email and user is None:
            if password or settings.model_id:
                raise ValueError(
                    "Configure BOOTSTRAP_ADMIN_EMAIL to create the first administrator"
                )
            return
        if user is None:
            if len(password) < 12:
                raise ValueError("Initial administrator password needs 12+ characters")
            if await session.scalar(
                select(User).where(User.__table__.c.is_superuser.is_(True))
            ):
                raise ValueError(
                    "An administrator already exists; bootstrap cannot add another"
                )
            try:
                payload = UserCreate(email=email, password=password, is_superuser=True)
            except ValidationError:
                raise ValueError("Invalid bootstrap administrator email") from None
            user = await create_account(session, payload)
        elif not user.is_superuser:
            raise ValueError(
                "Bootstrap email belongs to a regular user; refusing promotion"
            )
        sync_model(settings, user.id)
