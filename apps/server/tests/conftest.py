import asyncio
import sys
from pathlib import Path

import httpx
import pytest

from orchmesh.accounts import UserCreate, create_account
from orchmesh.config import Settings
from orchmesh.dsh.containers import Containers
from orchmesh.main import create_app
from orchmesh.storage import Base

PASSWORD = "test-password-only-123"


class FakeContainers(Containers):
    def command(self, user_id, conversation_id, project_id=None, *, control=False):
        root = self.prepare(user_id)
        return [
            sys.executable,
            str(Path(__file__).parent / "fixtures/fake_dsh.py"),
            str(root / "dsh" / f"{conversation_id}.jsonl"),
        ]

    async def kill(self, user_id):
        pass


@pytest.fixture
async def app(tmp_path):
    settings = Settings(
        _env_file=None,
        bootstrap_admin_email="",
        bootstrap_admin_password="",
        model_base_url="",
        model_api_key="",
        model_id="",
        data_dir=tmp_path,
    )
    app = create_app(settings, FakeContainers(settings))
    async with app.state.db.engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with app.state.db.sessions() as session:
        for email in ("one@example.com", "two@example.com"):
            await create_account(session, UserCreate(email=email, password=PASSWORD))
    async with app.router.lifespan_context(app):
        yield app


async def authenticated(app, email="one@example.com"):
    client = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )
    response = await client.post(
        "/api/login/access-token", data={"username": email, "password": PASSWORD}
    )
    assert response.status_code == 200, response.text
    client.headers["Authorization"] = "Bearer " + response.json()["access_token"]
    return client


async def settle(app):
    for _ in range(500):
        if not app.state.manager.active:
            return
        await asyncio.sleep(0.01)
    raise AssertionError("Run did not settle")
