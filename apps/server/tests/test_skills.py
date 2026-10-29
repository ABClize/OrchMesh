import base64
import io
import zipfile
from contextlib import aclosing
from unittest.mock import Mock

import pytest
from conftest import authenticated
from test_model_settings import admin
from test_models import profiles

from orchmesh.platform.catalog import freeze_definition
from orchmesh.platform.skills import task_skills
from orchmesh.platform.tools import definitions, invoke
from orchmesh.storage import AgentDefinition, AgentVersion, Task


def bundle(body="Return SKILL_V1.", name="business-proof"):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as z:
        z.writestr(
            "proof/SKILL.md",
            f"---\nname: {name}\ndescription: Business proof\n---\n{body}",
        )
        z.writestr("proof/scripts/proof.py", 'print("SCRIPT_V1")')
    return stream.getvalue()


async def test_skill_permissions_binding_and_immutable_tasks(app, tmp_path):
    client, owner = await admin(app)
    other = await authenticated(app, "two@example.com")
    app.state.manager.settings.models = profiles()
    app.state.manager.client = Mock()
    async with aclosing(client), aclosing(other):
        files = {"file": ("proof.zip", bundle(), "application/zip")}
        assert (await other.post("/api/skills/upload", files=files)).status_code == 403
        uploaded = await client.post("/api/skills/upload", files=files)
        assert uploaded.status_code == 200, uploaded.text
        skill = uploaded.json()
        assert (await client.post("/api/skills/upload", files=files)).status_code == 422
        detail = (await other.get("/api/skills/" + skill["id"])).json()
        assert (
            base64.b64decode(detail["files"]["scripts/proof.py"])
            == b'print("SCRIPT_V1")'
        )
        binding = {"id": skill["id"], "revision": skill["revision"]}
        definition = dict(
            name="Proof", instructions="Use business-proof", skills=[binding]
        )
        agent = (await client.post("/api/agents", json=definition)).json()
        assert (
            await other.put("/api/agents/" + agent["id"], json=definition)
        ).status_code == 404
        cid = (
            await client.post(
                "/api/conversations", json={"agent_id": "draft:" + agent["id"]}
            )
        ).json()["id"]
        # Existing task uses the same admission path as browser execution.
        task_id = await app.state.manager.admit(owner, cid, "proof", "proof")
        changed = await client.put(
            "/api/skills/" + skill["id"] + "/file",
            json={
                "path": "SKILL.md",
                "revision": skill["revision"],
                "content": (
                    "---\nname: business-proof\ndescription: Business proof\n"
                    "---\nReturn SKILL_V2."
                ),
            },
        )
        assert changed.status_code == 200, changed.text
        assert changed.json()["revision"] != skill["revision"]
        old = (
            await client.get(f"/api/skills/{skill['id']}?revision={skill['revision']}")
        ).json()
        assert old["revision"] == skill["revision"]
        assert old["definition"]["content"] == "Return SKILL_V1."
        assert old["used_by"] == [{"id": agent["id"], "name": "Proof"}]
        assert (
            await client.get(f"/api/skills/{skill['id']}?revision=missing")
        ).status_code == 404
        assert (await other.get(f"/api/skills/{skill['id']}")).json()["used_by"] == []
        stale = await client.put(
            "/api/skills/" + skill["id"] + "/file",
            json={
                "path": "SKILL.md",
                "revision": skill["revision"],
                "content": "stale",
            },
        )
        assert stale.status_code == 422
        async with app.state.db.sessions() as s:
            task = await s.get(Task, task_id)
            assert task.definition["skills"][0]["revision"] == skill["revision"]
            loaded = await task_skills(
                s, task.definition["skills"], tmp_path / "restored"
            )
            assert loaded[0]["content"] == "Return SKILL_V1."
            record = await s.get(AgentDefinition, agent["id"])
            assert (await freeze_definition(s, record))["skills"][0][
                "revision"
            ] == skill["revision"]
        async with app.state.db.sessions.begin() as s:
            record = await s.get(AgentDefinition, agent["id"])
            published = AgentVersion(
                id="skill-preview-published",
                agent_id=agent["id"],
                definition=await freeze_definition(s, record),
            )
            s.add(published)
            record.published_version = published.id
        updated_definition = {
            **definition,
            "skills": [{"id": skill["id"], "revision": changed.json()["revision"]}],
        }
        saved = await client.put("/api/agents/" + agent["id"], json=updated_definition)
        assert saved.status_code == 200, saved.text
        async with app.state.db.sessions() as s:
            record = await s.get(AgentDefinition, agent["id"])
            published = await s.get(AgentVersion, record.published_version)
            assert record.draft["skills"][0]["revision"] == changed.json()["revision"]
            assert published.definition["skills"][0]["revision"] == skill["revision"]
        assert not {"list_skills", "import_skill", "edit_skill_file"} & {
            t["name"] for t in definitions(False, True)
        }
        assert "import_skill" not in {t["name"] for t in definitions(True, False)}
        with pytest.raises(ValueError, match="Builder"):
            await invoke(app.state.manager, task, "list_skills", {}, "forged")


async def test_skill_zip_paths_and_format(app):
    client, _ = await admin(app)
    async with aclosing(client):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w") as z:
            z.writestr("../outside", "oops")
            z.writestr("SKILL.md", "bad")
        assert (
            await client.post(
                "/api/skills/upload", files={"file": ("bad.zip", stream.getvalue())}
            )
        ).status_code == 422
        assert (
            await client.post(
                "/api/skills/upload", files={"file": ("bad.md", b"No frontmatter")}
            )
        ).status_code == 422


async def test_disabled_skills_and_builder_admin_boundary(app):
    from orchmesh.storage import Conversation

    client, owner = await admin(app)
    other = await authenticated(app, "two@example.com")
    manager = app.state.manager
    manager.settings.models = profiles()
    manager.client = Mock()
    async with aclosing(client), aclosing(other):
        uploaded = (
            await client.post(
                "/api/skills/upload", files={"file": ("proof.zip", bundle())}
            )
        ).json()
        cid = (await other.post("/api/conversations", json={"creator": True})).json()[
            "id"
        ]
        import uuid

        user_id = uuid.UUID((await other.get("/api/me")).json()["id"])
        tid = await manager.admit(user_id, cid, "builder", "builder")
        async with app.state.db.sessions() as s:
            task = await s.get(Task, tid)
            assert (await s.get(Conversation, cid)).creator
        assert (await invoke(manager, task, "list_skills", {}, "list"))["skills"]
        with pytest.raises(ValueError, match="Administrator"):
            await invoke(
                manager,
                task,
                "import_skill",
                {"source": "owner/repo", "name": "proof"},
                "forged",
            )
        assert (
            await other.put(
                "/api/skills/" + uploaded["id"] + "/state",
                json={"enabled": False, "revision": uploaded["revision"]},
            )
        ).status_code == 403
        assert (
            await client.put(
                "/api/skills/" + uploaded["id"] + "/state",
                json={"enabled": False, "revision": uploaded["revision"]},
            )
        ).status_code == 200
        definition = {
            "name": "Blocked",
            "instructions": "No binding",
            "skills": [{"id": uploaded["id"], "revision": uploaded["revision"]}],
        }
        assert (await client.post("/api/agents", json=definition)).status_code == 422
        async with app.state.db.sessions() as s:
            loaded = await task_skills(
                s, definition["skills"], manager.settings.data_dir / "old-task"
            )
            assert loaded[0]["content"] == "Return SKILL_V1."


async def test_dsh_invocation_policy_and_task_catalog_isolation(app, tmp_path):
    client, _ = await admin(app)
    async with aclosing(client):
        text = (
            "---\nname: manual-only\ndescription: Explicit only\n"
            "disable-model-invocation: true\ncontext: fork\n---\nManual instructions"
        )
        result = await client.post(
            "/api/skills/upload", files={"file": ("SKILL.md", text.encode())}
        )
        assert result.status_code == 200, result.text
        item = result.json()
        detail = (await client.get("/api/skills/" + item["id"])).json()
        assert detail["definition"]["invocation"]["modelInvocable"] is False
        assert detail["definition"]["warnings"]
        async with app.state.db.sessions() as s:
            assert await task_skills(s, [], tmp_path / "unbound") == []
            bound = await task_skills(
                s,
                [{"id": item["id"], "revision": item["revision"]}],
                tmp_path / "bound",
            )
            assert [v["name"] for v in bound] == ["manual-only"]


def test_platform_tool_schemas_compile_with_official_dsh():
    import json
    import subprocess

    from orchmesh.config import Settings

    code = """
    import {defineTool} from '@deepseek-ai/dsh-tools';
    import {readFileSync} from 'node:fs';
    for (const spec of JSON.parse(readFileSync(0,'utf8'))) {
      defineTool({...spec, execute:async()=>'', output:{
        schema:{type:'string'},render:(_,v)=>[{type:'text',text:v}]}});
    }
    """
    result = subprocess.run(
        ["node", "--input-type=module", "-e", code],
        input=json.dumps(definitions(True, True)),
        text=True,
        capture_output=True,
        cwd=Settings().runtime_dir,
        timeout=10,
    )
    assert result.returncode == 0, result.stderr
