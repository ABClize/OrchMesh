import asyncio
import sys
from pathlib import Path

import httpx
import pytest
from fastapi_users.db import SQLAlchemyUserDatabase

from orchmesh.auth import UserCreate, UserManager
from orchmesh.config import Settings
from orchmesh.main import create_app
from orchmesh.pi.containers import Containers
from orchmesh.storage import Base, User

PASSWORD = "test-password-only-123"


class FakeContainers(Containers):
    def command(self, user_id, conversation_id):
        root = self.prepare(user_id)
        return [
            sys.executable,
            str(Path(__file__).parent / "fixtures/fake_pi.py"),
            str(root / "sessions" / f"{conversation_id}.jsonl"),
        ]

    async def kill(self, user_id):
        pass


@pytest.fixture
async def app(tmp_path):
    settings = Settings(data_dir=tmp_path)
    app = create_app(settings, FakeContainers(settings))
    async with app.state.db.engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with app.state.db.sessions() as session:
        manager = UserManager(SQLAlchemyUserDatabase(session, User))
        for email in ("one@example.com", "two@example.com"):
            await manager.create(UserCreate(email=email, password=PASSWORD))
    async with app.router.lifespan_context(app):
        yield app


async def authenticated(app, email="one@example.com"):
    client = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )
    await client.get("/api/health")
    client.headers["x-csrftoken"] = client.cookies["orchmesh_csrf"]
    response = await client.post(
        "/api/auth/login", data={"username": email, "password": PASSWORD}
    )
    assert response.status_code == 204, response.text
    return client


async def settle(app):
    for _ in range(500):
        if not app.state.manager.active:
            return
        await asyncio.sleep(0.01)
    raise AssertionError("Run did not settle")
