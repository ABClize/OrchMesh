import uuid
from contextlib import aclosing
from unittest.mock import Mock

import pytest
from conftest import authenticated

from orchmesh.config import ModelProfile, Settings
from orchmesh.dsh.configuration import validate_model
from orchmesh.storage import Task


def profiles():
    return [
        ModelProfile(
            key="fast",
            name="Fast",
            id="wire-fast",
            base_url="https://example.com/v1",
            api_key="private-fast",
            reasoning_efforts={"off": None, "high": "high"},
        ),
        ModelProfile(
            key="plain",
            name="Plain",
            id="wire-plain",
            base_url="https://other.example.com/v1",
            api_key="private-plain",
            reasoning_efforts={},
        ),
    ]


async def test_model_selection_capabilities_ownership_and_snapshot(app):
    manager = app.state.manager
    manager.settings.models = profiles()
    manager.client = Mock()
    one, two = await authenticated(app), await authenticated(app, "two@example.com")
    async with aclosing(one), aclosing(two):
        catalog = await one.get("/api/model")
        assert catalog.json()["default_model"] == "fast"
        assert "private" not in catalog.text and "base_url" not in catalog.text
        cid = (await one.post("/api/conversations")).json()["id"]
        url = f"/api/conversations/{cid}/reasoning"
        assert (await two.put(url, json={"model_id": "fast"})).status_code == 404
        assert (await one.put(url, json={"model_id": "unknown"})).status_code == 422
        result = await one.put(url, json={"model_id": "fast", "reasoning": "high"})
        assert result.json()["reasoning"] == "high"
        owner = uuid.UUID((await one.get("/api/me")).json()["id"])
        root_id = await manager.admit(owner, cid, "first", "first")
        assert (await one.put(url, json={"model_id": "plain"})).status_code == 409
        async with app.state.db.sessions.begin() as session:
            root = await session.get(Task, root_id)
            frozen = dict(root.model)
            assert frozen["id"] == "wire-fast" and frozen["reasoning"] == "high"
            assert "private-fast" not in str(frozen)
            root.status = "completed"
        assert (
            await one.put(url, json={"model_id": "plain", "reasoning": "high"})
        ).status_code == 422
        result = (await one.put(url, json={"model_id": "plain"})).json()
        assert result["model_id"] == "plain" and result["reasoning"] == "default"
        fork = (await one.post(f"/api/conversations/{cid}/fork")).json()
        assert fork["model_id"] == "plain"
        second_id = await manager.admit(owner, cid, "second", "second")
        async with app.state.db.sessions() as session:
            root = await session.get(Task, root_id)
            second = await session.get(Task, second_id)
            assert root.model == frozen
            assert second.model["id"] == "wire-plain"
            assert second.model["efforts"] is False
        # Child requests inherit the admitted parent's model, including its effort.
        child_id = await manager.admit(owner, cid, "child", "child", parent=second)
        async with app.state.db.sessions() as session:
            assert (await session.get(Task, child_id)).model == second.model


def test_model_config_rejects_duplicates_bad_default_and_redacts_keys(tmp_path):
    settings = Settings(_env_file=None, data_dir=tmp_path, models=profiles())
    validate_model(settings)
    assert "private-fast" not in repr(settings)
    assert settings.resolve_model("plain").api_key.get_secret_value() == "private-plain"
    settings.default_model = "missing"
    with pytest.raises(ValueError, match="not configured"):
        validate_model(settings)
    settings.default_model = "fast"
    settings.models.append(settings.models[0])
    with pytest.raises(ValueError, match="unique"):
        validate_model(settings)


def test_legacy_model_keeps_dsh_catalog_defaults(tmp_path):
    settings = Settings(
        _env_file=None,
        data_dir=tmp_path,
        model_id="legacy",
        model_base_url="https://example.com",
        model_api_key="private",
    )
    assert settings.resolve_model().snapshot("default")["efforts"] is None
