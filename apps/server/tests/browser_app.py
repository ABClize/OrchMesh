"""Dedicated E2E app. Test credentials and fake RPC never enter production setup."""

import asyncio
import tempfile
from pathlib import Path

from conftest import PASSWORD, FakeContainers

from orchmesh.accounts import UserCreate, create_account
from orchmesh.config import Settings
from orchmesh.main import create_app
from orchmesh.storage import Base

directory = tempfile.TemporaryDirectory(prefix="orchmesh-e2e-")
settings = Settings(
    _env_file=None,
    bootstrap_admin_email="",
    bootstrap_admin_password="",
    model_base_url="",
    model_api_key="",
    model_id="",
    data_dir=Path(directory.name),
)
app = create_app(settings, FakeContainers(settings))


async def setup():
    async with app.state.db.engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with app.state.db.sessions() as session:
        await create_account(
            session, UserCreate(email="browser@example.com", password=PASSWORD)
        )


asyncio.run(setup())
