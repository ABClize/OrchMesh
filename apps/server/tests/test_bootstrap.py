import pytest
from pydantic import SecretStr, ValidationError
from sqlalchemy import select

from orchmesh.accounts import UserCreate, create_account
from orchmesh.bootstrap import bootstrap
from orchmesh.config import Settings
from orchmesh.security import password_hash
from orchmesh.storage import Base, Database, User


@pytest.fixture
async def configured(tmp_path):
    settings = Settings(
        _env_file=None,
        data_dir=tmp_path,
        bootstrap_admin_email="owner@example.com",
        bootstrap_admin_password="initial-test-password",
        model_base_url="https://example.com/v1",
        model_api="openai-completions",
        model_api_key="test-only-key",
        model_id="test-model",
    )
    db = Database(settings)
    async with db.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield settings, db
    await db.engine.dispose()


async def test_bootstrap_preserves_hash_and_does_not_write_user_model_keys(configured):
    settings, db = configured
    await bootstrap(db, settings)
    async with db.sessions() as session:
        first = await session.scalar(select(User))
        original_hash = first.hashed_password
        assert password_hash.verify_and_update("initial-test-password", original_hash)[
            0
        ]
    await bootstrap(
        db,
        settings.model_copy(
            update={
                "bootstrap_admin_password": SecretStr("new-password-not-applied"),
                "model_api_key": SecretStr("rotated-key"),
            }
        ),
    )
    async with db.sessions() as session:
        rows = (await session.scalars(select(User))).all()
        assert len(rows) == 1 and rows[0].hashed_password == original_hash
    assert not list(settings.data_dir.rglob("models.json"))


async def test_bootstrap_refuses_regular_user_promotion(configured):
    settings, db = configured
    async with db.sessions() as session:
        await create_account(
            session,
            UserCreate(
                email=settings.bootstrap_admin_email, password="ordinary-test-password"
            ),
        )
    with pytest.raises(ValueError, match="refusing promotion"):
        await bootstrap(db, settings)


async def test_invalid_model_does_not_create_account(configured):
    settings, db = configured
    with pytest.raises(ValueError, match="together"):
        await bootstrap(db, settings.model_copy(update={"model_id": ""}))
    async with db.sessions() as session:
        assert await session.scalar(select(User)) is None


def test_dotenv_port_and_secret_redaction(tmp_path):
    env = tmp_path / ".env"
    env.write_text("ORCHMESH_PORT=18765\nORCHMESH_MODEL_API_KEY='abc# $def'\n")
    settings = Settings(_env_file=env)
    assert settings.port == 18765
    assert settings.model_api_key.get_secret_value() == "abc# $def"
    assert "abc# $def" not in repr(settings)
    with pytest.raises(ValidationError) as error:
        Settings(_env_file=None, port="sensitive-invalid-value")
    assert "sensitive-invalid-value" not in str(error.value)
