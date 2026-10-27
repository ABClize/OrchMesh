from contextlib import aclosing
from unittest.mock import Mock

from conftest import authenticated
from test_model_settings import admin
from test_models import profiles

from orchmesh.prompt_settings import DEFAULTS, read_prompts
from orchmesh.storage import Conversation, Task


async def test_prompt_permissions_persistence_conflicts_validation_and_restore(app):
    client, _ = await admin(app)
    other = await authenticated(app, "two@example.com")
    async with aclosing(client), aclosing(other):
        url = "/api/settings/prompts"
        initial = (await client.get(url)).json()
        assert initial["prompts"] == DEFAULTS.model_dump()
        payload = {
            "prompts": {**initial["prompts"], "assistant": "Custom instruction"},
            "revision": initial["revision"],
        }
        assert (await other.get(url)).status_code == 403
        assert (await other.put(url, json=payload)).status_code == 403
        invalid = {**payload, "prompts": {**payload["prompts"], "platform": "   "}}
        assert (await client.put(url, json=invalid)).status_code == 422
        result = await client.put(url, json=payload)
        assert result.status_code == 200
        assert (
            read_prompts(app.state.manager.settings).assistant == "Custom instruction"
        )
        assert (await client.put(url, json=payload)).status_code == 409
        assert (
            app.state.manager.settings.data_dir / "platform-prompts.json"
        ).stat().st_mode & 0o777 == 0o600
        restored = await client.put(
            url,
            json={
                "prompts": initial["defaults"],
                "revision": result.json()["revision"],
            },
        )
        assert restored.json()["prompts"] == DEFAULTS.model_dump()


async def test_prompt_admission_snapshot_and_builder(app):
    manager = app.state.manager
    manager.settings.models = profiles()
    manager.client = Mock()
    client, owner = await admin(app)
    async with aclosing(client):
        url = "/api/settings/prompts"
        initial = (await client.get(url)).json()
        cid = (await client.post("/api/conversations")).json()["id"]
        before = await manager.admit(owner, cid, "before", "before")
        modified = {
            "continuation": "Resume with saved rules",
            "assistant": "New assistant",
            "builder": "New builder",
            "platform": "New common rules",
        }
        assert (
            await client.put(
                url, json={"prompts": modified, "revision": initial["revision"]}
            )
        ).status_code == 200
        async with app.state.db.sessions.begin() as session:
            task = await session.get(Task, before)
            assert task.definition["instructions"] == DEFAULTS.assistant
            assert task.continuation_prompt == DEFAULTS.continuation
            assert task.platform_prompt == DEFAULTS.platform
            task.status = "completed"
        after = await manager.admit(owner, cid, "after", "after")
        builder_cid = (await client.post("/api/conversations")).json()["id"]
        async with app.state.db.sessions.begin() as session:
            (await session.get(Conversation, builder_cid)).creator = True
        builder = await manager.admit(owner, builder_cid, "builder", "builder")
        async with app.state.db.sessions() as session:
            assert (
                await session.get(Task, after)
            ).continuation_prompt == "Resume with saved rules"
            assert (await session.get(Task, after)).definition[
                "instructions"
            ] == "New assistant"
            assert (
                await session.get(Task, after)
            ).platform_prompt == "New common rules"
            assert (await session.get(Task, builder)).definition[
                "instructions"
            ] == "New builder"
            assert (
                await session.get(Task, before)
            ).platform_prompt == DEFAULTS.platform


async def test_effective_prompt_requires_admin_and_task_owner(app):
    import json
    import uuid

    client, owner = await admin(app)
    other = await authenticated(app, "two@example.com")
    task_id = str(uuid.uuid4())
    async with app.state.db.sessions.begin() as session:
        session.add(
            Task(
                id=task_id,
                owner_id=owner,
                request_id=task_id,
                conversation_id="prompt-view",
                root_id=task_id,
                definition={},
                prompt="inspect",
                status="completed",
            )
        )
    url = f"/api/tasks/{task_id}/effective-prompt"
    async with aclosing(client), aclosing(other):
        assert (await other.get(url)).status_code == 403
        assert (await client.get(url)).json() == {"available": False, "snapshot": None}
        root = app.state.manager.sandboxes.root(task_id)
        root.mkdir(parents=True, exist_ok=True)
        snapshot = {
            "sections": [{"name": "actual", "text": "recorded, not current settings"}]
        }
        (root / "effective-prompt.json").write_text(json.dumps(snapshot))
        assert (await client.get(url)).json()["snapshot"] == snapshot
        from orchmesh.storage import User

        other_id = uuid.UUID((await other.get("/api/me")).json()["id"])
        async with app.state.db.sessions.begin() as session:
            (await session.get(User, other_id)).is_superuser = True
        assert (await other.get(url)).status_code == 404
