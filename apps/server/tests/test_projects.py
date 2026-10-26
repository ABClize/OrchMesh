import uuid
from contextlib import aclosing

from conftest import authenticated, settle

from orchmesh.dsh.containers import Containers
from orchmesh.projects import workspace_path


async def test_project_ownership_workspace_and_runtime_mount(app):
    one, two = await authenticated(app), await authenticated(app, "two@example.com")
    async with aclosing(one), aclosing(two):
        uid = uuid.UUID((await one.get("/api/me")).json()["id"])
        response = await one.post("/api/projects", json={"name": "报告项目"})
        assert response.status_code == 201
        pid = response.json()["id"]
        other = (await one.post("/api/projects", json={"name": "另一个项目"})).json()[
            "id"
        ]
        assert (await two.get("/api/projects")).json() == []
        assert (
            await two.post("/api/conversations", json={"project_id": pid})
        ).status_code == 404
        assert (
            await two.get("/api/workspace/entries", params={"project_id": pid})
        ).status_code == 404
        created = await one.post("/api/conversations", json={"project_id": pid})
        cid = created.json()["id"]
        assert created.json()["project_id"] == pid
        settings = app.state.manager.settings
        work = workspace_path(settings, uid, uuid.UUID(pid))
        (work / "proof.txt").write_text("project only")
        assert (
            await one.get(
                "/api/workspace/file", params={"project_id": pid, "path": "proof.txt"}
            )
        ).text == "project only"
        for scope in ({}, {"project_id": other}):
            assert (
                await one.get(
                    "/api/workspace/file", params={**scope, "path": "proof.txt"}
                )
            ).status_code == 404
        # The production command must mount only this project's work directory.
        production = Containers(settings)
        command = production.command(uid, cid, uuid.UUID(pid))
        assert f"type=bind,src={work},dst=/workspace" in command
        assert (
            f"type=bind,src={workspace_path(settings, uid)},dst=/workspace"
            not in command
        )
        assert (await one.post("/api/projects", json={"name": "  "})).status_code == 422


async def test_pin_archive_restore_preserves_history_and_ownership(app):
    one, two = await authenticated(app), await authenticated(app, "two@example.com")
    async with aclosing(one), aclosing(two):
        conversation = (await one.post("/api/conversations")).json()
        assert conversation["project_id"] is None
        url = "/api/conversations/" + conversation["id"]
        assert (await two.patch(url, json={"pinned": True})).status_code == 404
        assert (await one.patch(url, json={"pinned": True})).json()["pinned"] is True
        await one.post(url + "/runs", json={"text": "hello"})
        await settle(app)
        before = (await one.get(url)).json()["messages"]
        assert (await one.patch(url, json={"archived": True})).json()[
            "archived"
        ] is True
        snapshot = (await one.get(url)).json()
        assert snapshot["read_only"] is True
        assert snapshot["messages"] == before
        assert (
            await one.post(url + "/runs", json={"text": "blocked"})
        ).status_code == 409
        assert (await one.patch(url, json={"archived": False})).json()[
            "pinned"
        ] is False
        snapshot = (await one.get(url)).json()
        assert not snapshot["read_only"]
        assert snapshot["messages"] == before


async def test_native_membership_rename_fork_and_remove_keep_files(app):
    client = await authenticated(app)
    async with aclosing(client):
        uid = uuid.UUID((await client.get("/api/me")).json()["id"])
        project = (
            await client.post("/api/projects", json={"name": "Native project"})
        ).json()
        pid = project["id"]
        conversation = (
            await client.post("/api/conversations", json={"project_id": pid})
        ).json()
        url = "/api/conversations/" + conversation["id"]
        assert conversation["project_id"] == pid
        root = workspace_path(app.state.manager.settings, uid, uuid.UUID(pid))
        (root / "kept.txt").write_text("unchanged")
        assert (await client.patch(url, json={"project_id": None})).status_code == 422
        assert (await client.patch(url, json={"title": "Official title"})).json()[
            "title"
        ] == "Official title"
        await client.post(url + "/runs", json={"text": "hello"})
        await settle(app)
        before = (await client.get(url)).json()["messages"]
        child = (await client.post(url + "/fork")).json()
        assert child["id"] != conversation["id"]
        assert child["project_id"] == pid
        assert (await client.get("/api/conversations/" + child["id"])).json()[
            "messages"
        ] == before
        assert (await client.delete("/api/projects/" + pid)).status_code == 200
        assert (await client.get("/api/projects")).json() == []
        rows = (await client.get("/api/conversations")).json()
        assert all(c["project_id"] is None and c["directory_id"] == pid for c in rows)
        assert (root / "kept.txt").read_text() == "unchanged"
        assert (
            await client.get(
                "/api/workspace/file", params={"project_id": pid, "path": "kept.txt"}
            )
        ).text == "unchanged"


async def test_busy_create_does_not_leave_phantom_records(app):
    client = await authenticated(app)
    async with aclosing(client):
        cid = (await client.post("/api/conversations")).json()["id"]
        url = f"/api/conversations/{cid}"
        await client.post(url + "/runs", json={"text": "slow"})
        assert (
            await client.post("/api/projects", json={"name": "Rejected"})
        ).status_code == 409
        assert (await client.post("/api/conversations")).status_code == 409
        await client.post(url + "/stop")
        await settle(app)
        assert (await client.get("/api/projects")).json() == []
        assert len((await client.get("/api/conversations")).json()) == 1
