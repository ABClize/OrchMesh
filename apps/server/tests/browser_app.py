"""Dedicated E2E app. Test credentials and fake RPC never enter production setup."""

import asyncio
import tempfile
from pathlib import Path

from conftest import PASSWORD, FakeContainers
from fastapi_users.db import SQLAlchemyUserDatabase

from orchmesh.auth import UserCreate, UserManager
from orchmesh.config import Settings
from orchmesh.main import create_app
from orchmesh.storage import Base, User

directory = tempfile.TemporaryDirectory(prefix="orchmesh-e2e-")
settings = Settings(data_dir=Path(directory.name))
app = create_app(settings, FakeContainers(settings))


async def setup():
    async with app.state.db.engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with app.state.db.sessions() as session:
        await UserManager(SQLAlchemyUserDatabase(session, User)).create(
            UserCreate(email="browser@example.com", password=PASSWORD)
        )


asyncio.run(setup())
