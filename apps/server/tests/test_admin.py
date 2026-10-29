import uuid
from contextlib import aclosing

from conftest import authenticated
from test_observation import seed

from orchmesh.storage import Conversation, User


async def test_admin_catalog_and_cross_owner_observation(app):
    admin, owner = await authenticated(app), await authenticated(app, "two@example.com")
    async with aclosing(admin), aclosing(owner):
        cid, root, child = await seed(app, owner)
        for route in ("overview", "users", "tasks", "agents"):
            assert (await owner.get(f"/api/admin/{route}")).status_code == 403
        assert (await admin.get(f"/api/tasks/{root}")).status_code == 404
        uid = uuid.UUID((await admin.get("/api/me")).json()["id"])
        async with app.state.db.sessions.begin() as session:
            user = await session.get(User, uid)
            user.is_superuser = True
        users = (await admin.get("/api/admin/users")).json()
        assert users["total"] == 2
        assert all("hashed_password" not in row for row in users["items"])
        assert (await admin.get("/api/admin/overview")).json()["counts"]["tasks"] == 2
        tasks = (
            await admin.get("/api/admin/tasks?search=two@example.com&status=completed")
        ).json()
        assert tasks["total"] == 2
        assert not (await admin.get("/api/admin/tasks?offset=50")).json()["items"]
        assert (await admin.get("/api/admin/tasks?search=missing")).json()["total"] == 0
        graph = await admin.get(f"/api/conversations/{cid}/graph")
        assert graph.status_code == 200
        assert len(graph.json()["calls"]) == 2
        assert (await admin.get(f"/api/tasks/{child}")).status_code == 200
        # Global read access does not grant task control over someone else's task.
        assert (await admin.post(f"/api/conversations/{cid}/stop")).status_code == 404
        async with app.state.db.sessions.begin() as session:
            conversation = await session.get(Conversation, cid)
            await session.delete(conversation)
        assert (await admin.get(f"/api/conversations/{cid}/graph")).status_code == 200
        assert (await owner.get(f"/api/conversations/{cid}/graph")).status_code == 404
        async with app.state.db.sessions.begin() as session:
            user = await session.get(User, uid)
            user.is_superuser = False
        assert (await admin.get(f"/api/tasks/{root}")).status_code == 404
        assert (await admin.get("/api/admin/users")).status_code == 403


async def test_admin_filters_compose_before_pagination(app):
    from datetime import UTC, datetime, timedelta

    from orchmesh.storage import AgentDefinition, Task

    client = await authenticated(app)
    async with aclosing(client):
        uid = uuid.UUID((await client.get("/api/me")).json()["id"])
        cid, root, child = await seed(app, client)
        async with app.state.db.sessions.begin() as session:
            user = await session.get(User, uid)
            user.is_superuser = True
            parent = await session.get(Task, root)
            parent.created_at = (datetime.now(UTC) - timedelta(days=40)).isoformat()
            for name, version, archived in (
                ("Report draft", None, False),
                ("Report published", "version", False),
                ("Report archived", "version", True),
            ):
                session.add(
                    AgentDefinition(
                        owner_id=uid,
                        name=name,
                        published_version=version,
                        archived=archived,
                    )
                )

        async def total(path):
            response = await client.get("/api/admin/" + path)
            assert response.status_code == 200, response.text
            return response.json()["total"]

        assert await total("users?search=one&role=admin&status=active") == 1
        assert await total("users?search=one&role=member") == 0
        assert await total("users?status=inactive") == 0
        assert await total("agents?search=Report&status=draft") == 1
        assert await total("agents?search=one@example.com&status=published") == 1
        assert await total("agents?status=archived") == 1
        assert await total("agents?search=%25") == 0
        async with app.state.db.sessions.begin() as session:
            conversation = await session.get(Conversation, cid)
            conversation.title = "检索验收：业务目标"
            task = await session.get(Task, child)
            task.prompt = "检查唯一工具调用"
        assert await total("tasks?search=检索验收：业务目标") == 2
        assert await total("tasks?search=业务目标&status=completed") == 2
        assert await total("tasks?search=业务目标&status=failed") == 0
        assert await total("tasks?search=唯一工具") == 1
        assert await total("tasks?kind=root") == 1
        assert await total("tasks?kind=child&period=7&status=completed") == 1
        assert await total("tasks?kind=root&period=30") == 0
        assert await total("tasks?search=Same%20agent&period=1") == 1
        assert (await client.get("/api/admin/tasks?period=bad")).status_code == 422
        assert (await client.get("/api/admin/users?role=bad")).status_code == 422


async def test_admin_editor_uses_authors_knowledge_and_does_not_publish(app):
    from orchmesh.storage import AgentDefinition, Knowledge

    admin, owner = await authenticated(app), await authenticated(app, "two@example.com")
    async with aclosing(admin), aclosing(owner):
        admin_id = uuid.UUID((await admin.get("/api/me")).json()["id"])
        owner_id = uuid.UUID((await owner.get("/api/me")).json()["id"])
        definition = {
            "name": "业务助手",
            "description": "",
            "instructions": "处理业务",
            "tools": [],
            "skills": [],
            "knowledge_ids": [],
        }
        agent = (await owner.post("/api/agents", json=definition)).json()
        path = f"/api/agents/{agent['id']}"
        assert (await admin.get(path)).status_code == 404
        assert (await admin.get(path + "/knowledge")).status_code == 404
        async with app.state.db.sessions.begin() as session:
            (await session.get(User, admin_id)).is_superuser = True
            session.add(
                Knowledge(
                    id="owner-note",
                    owner_id=owner_id,
                    title="作者知识",
                    content="author",
                )
            )
            session.add(
                Knowledge(
                    id="admin-note",
                    owner_id=admin_id,
                    title="管理员知识",
                    content="private",
                )
            )
        assert (await admin.get(path)).json()["draft"] == agent["draft"]
        assert [k["id"] for k in (await admin.get(path + "/knowledge")).json()] == [
            "owner-note"
        ]
        assert (
            await admin.put(path, json={**definition, "knowledge_ids": ["admin-note"]})
        ).status_code == 422
        response = await admin.put(
            path,
            json={
                **definition,
                "description": "已更新",
                "knowledge_ids": ["owner-note"],
            },
        )
        assert response.status_code == 200
        assert response.json()["published_version"] is None
        assert (await owner.get(path)).json()["description"] == "已更新"
        async with app.state.db.sessions() as session:
            assert (
                await session.get(AgentDefinition, agent["id"])
            ).owner_id == owner_id
        assert (await admin.get(f"/api/admin/agents?owner_id={owner_id}")).json()[
            "total"
        ] == 1
        assert (await admin.get(f"/api/admin/agents?owner_id={admin_id}")).json()[
            "total"
        ] == 0
        assert (await admin.get("/api/admin/tasks?worker=attached")).json()[
            "total"
        ] == 0
