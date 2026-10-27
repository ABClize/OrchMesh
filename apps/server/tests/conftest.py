import httpx
import pytest

from orchmesh.accounts import UserCreate, create_account
from orchmesh.config import Settings
from orchmesh.logging import application_logging
from orchmesh.main import create_app
from orchmesh.storage import Base

PASSWORD = "test-password-only-123"


@pytest.fixture
async def app(tmp_path):
    settings = Settings(
        _env_file=None,
        database_dsn="",
        data_dir=tmp_path,
        bootstrap_admin_email="",
        bootstrap_admin_password="",
        model_base_url="",
        model_api_key="",
        model_id="",
        model_reasoning_efforts={"off": None, "high": "high"},
    )
    app = create_app(settings)
    async with app.state.db.engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with app.state.db.sessions() as session:
        for email in ("one@example.com", "two@example.com"):
            await create_account(session, UserCreate(email=email, password=PASSWORD))
    # HTTP boundary tests do not pretend an in-memory fake worker proves recovery.
    # Real PostgreSQL/DBOS/DSH restart acceptance is a separate process-level suite.
    with application_logging(settings):
        yield app
    await app.state.db.engine.dispose()


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
