import uuid
from contextlib import aclosing

from conftest import authenticated

from orchmesh.config import Settings
from orchmesh.model_registry import catalog_path
from orchmesh.storage import Task, User


async def admin(app):
    client = await authenticated(app)
    uid = uuid.UUID((await client.get("/api/me")).json()["id"])
    async with app.state.db.sessions.begin() as session:
        (await session.get(User, uid)).is_superuser = True
    return client, uid


async def test_admin_model_persistence_secrets_conflicts_and_capabilities(
    app, monkeypatch
):
    settings = app.state.manager.settings
    seen = []

    async def probe(settings, profile, *, test=False):
        seen.append((profile.api_key.get_secret_value(), test))
        return {"ok": True, "efforts": [{"id": "high", "name": "High"}]}

    monkeypatch.setattr("orchmesh.model_settings.probe_model", probe)
    client, uid = await admin(app)
    other = await authenticated(app, "two@example.com")
    async with aclosing(client), aclosing(other):
        base = "/api/settings/models"
        assert (await other.get(base)).status_code == 403
        payload = dict(
            key="new",
            name="New Model",
            id="upstream",
            base_url="https://example.com/v1",
            provider="openai",
            api_key="secret-not-public",
            creating=True,
        )
        assert (await other.put(base, json=payload)).status_code == 403
        assert (await other.post(base + "/probe", json=payload)).status_code == 403
        result = await client.put(base, json=payload)
        assert result.status_code == 200, result.text
        assert "secret-not-public" not in result.text
        assert catalog_path(settings).stat().st_mode & 0o777 == 0o600
        loaded = Settings(_env_file=None, data_dir=settings.data_dir)
        assert loaded.resolve_model().api_key.get_secret_value() == "secret-not-public"
        public = (await other.get("/api/model")).json()
        assert public["models"][0]["efforts"] == [{"id": "high", "label": "high"}]
        catalog = (await client.get(base)).json()
        assert "secret-not-public" not in str(catalog)
        assert catalog["models"][0]["has_key"] is True
        assert (await client.put(base, json=payload)).status_code == 409
        edit = {
            **payload,
            "creating": False,
            "revision": catalog["revision"],
            "api_key": "",
            "name": "Edited",
        }
        assert (
            await client.post(base + "/probe?test=true", json=edit)
        ).status_code == 200
        assert seen[-1] == ("secret-not-public", True)
        assert (
            await client.put(
                base, json={**edit, "base_url": "https://other.example.com"}
            )
        ).status_code == 422
        assert (await client.put(base, json=edit)).status_code == 200
        assert loaded.resolve_model().name == "Edited"
        taskid = str(uuid.uuid4())
        async with app.state.db.sessions.begin() as session:
            session.add(
                Task(
                    id=taskid,
                    owner_id=uid,
                    request_id=taskid,
                    conversation_id="c",
                    root_id=taskid,
                    definition={},
                    prompt="test",
                    status="waiting",
                    model={"key": "new"},
                )
            )
        edit["revision"] = (await client.get(base)).json()["revision"]
        assert (await client.put(base, json=edit)).status_code == 409
        # Invalid payloads never echo their body, even if it includes a secret.
        invalid = await client.put(
            base, json={**edit, "api": "secret-invalid-protocol"}
        )
        assert invalid.status_code == 422
        assert "secret-invalid-protocol" not in invalid.text


async def test_probe_failure_never_persists_changes(app, monkeypatch):
    async def failed(*args, **kwargs):
        raise ValueError("Connection failed")

    monkeypatch.setattr("orchmesh.model_settings.probe_model", failed)
    client, _ = await admin(app)
    async with aclosing(client):
        payload = dict(
            key="new",
            name="New",
            id="upstream",
            base_url="https://example.com",
            api_key="private",
        )
        response = await client.put("/api/settings/models", json=payload)
        assert response.status_code == 422
        assert not catalog_path(app.state.manager.settings).exists()
