import json

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


async def test_bootstrap_admin_and_preserve_existing_configuration(configured):
    settings, db = configured
    await bootstrap(db, settings)
    async with db.sessions() as session:
        user = await session.scalar(select(User))
        assert user.is_superuser
        assert password_hash.verify_and_update(
            "initial-test-password", user.hashed_password
        )[0]
        original_hash = user.hashed_password
        directory = settings.data_dir / "users" / str(user.id) / "config"
    models = directory / "models.json"
    assert (
        json.loads(models.read_text())["providers"]["project-api"]["apiKey"]
        == "test-only-key"
    )
    assert models.stat().st_mode & 0o777 == 0o600
    models.write_text('{"providers": {"custom": {}}}')
    defaults = directory / "settings.json"
    defaults.write_text('{"theme": "dark", "defaultProvider": "custom"}')
    changed = settings.model_copy(
        update={
            "model_id": "changed-model",
            "model_base_url": "https://changed.example/v1",
            "model_api_key": SecretStr("rotated-test-key"),
            "bootstrap_admin_password": SecretStr("changed-admin-password"),
        }
    )
    await bootstrap(db, changed)
    providers = json.loads(models.read_text())["providers"]
    assert "custom" in providers
    assert providers["project-api"]["apiKey"] == "rotated-test-key"
    assert providers["project-api"]["baseUrl"] == "https://changed.example/v1"
    assert providers["project-api"]["models"] == [{"id": "changed-model"}]
    assert json.loads(defaults.read_text()) == {
        "theme": "dark",
        "defaultProvider": "project-api",
        "defaultModel": "changed-model",
    }
    assert defaults.stat().st_mode & 0o777 == 0o600
    async with db.sessions() as session:
        users = list((await session.scalars(select(User))).all())
        assert len(users) == 1
        assert users[0].hashed_password == original_hash
    # An email change cannot silently create another administrator.
    with pytest.raises(ValueError, match="already exists"):
        await bootstrap(
            db,
            settings.model_copy(update={"bootstrap_admin_email": "other@example.com"}),
        )


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


async def test_clear_env_removes_managed_key_and_preserves_other_users(configured):
    settings, db = configured
    await bootstrap(db, settings)
    async with db.sessions() as session:
        user = await session.scalar(select(User))
        directory = settings.data_dir / "users" / str(user.id) / "config"
        friend = await create_account(
            session,
            UserCreate(email="friend@example.com", password="friend-password-123"),
        )
    friend_dir = settings.data_dir / "users" / str(friend.id) / "config"
    friend_dir.mkdir(parents=True)
    friend_models = friend_dir / "models.json"
    friend_models.write_text('{"providers":{"project-api":{"apiKey":"friend-key"}}}')
    original = friend_models.read_bytes()
    cleared = settings.model_copy(
        update={
            "bootstrap_admin_email": "",
            "bootstrap_admin_password": SecretStr(""),
            "model_base_url": "",
            "model_api_key": SecretStr(""),
            "model_id": "",
        }
    )
    await bootstrap(db, cleared)
    assert (
        "project-api"
        not in json.loads((directory / "models.json").read_text())["providers"]
    )
    assert "defaultModel" not in json.loads((directory / "settings.json").read_text())
    assert friend_models.read_bytes() == original


async def test_model_refresh_without_bootstrap_credentials(configured):
    settings, db = configured
    await bootstrap(db, settings)
    changed = settings.model_copy(
        update={
            "bootstrap_admin_email": "",
            "bootstrap_admin_password": SecretStr(""),
            "model_id": "after-restart",
        }
    )
    await bootstrap(db, changed)
    paths = list(settings.data_dir.glob("users/*/config/settings.json"))
    assert json.loads(paths[0].read_text())["defaultModel"] == "after-restart"


async def test_invalid_existing_pi_config_is_not_destroyed(configured):
    settings, db = configured
    await bootstrap(db, settings)
    path = next(settings.data_dir.glob("users/*/config/settings.json"))
    path.write_text("broken-json")
    models = path.with_name("models.json")
    original = models.read_bytes()
    with pytest.raises(ValueError, match="was not replaced"):
        await bootstrap(db, settings.model_copy(update={"model_id": "new"}))
    assert path.read_text() == "broken-json"
    assert models.read_bytes() == original
