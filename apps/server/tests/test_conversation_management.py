import uuid
from contextlib import aclosing

from conftest import authenticated

from orchmesh.storage import Conversation, Task


async def test_archive_delete_ownership_and_running_guard(app):
    one, two = await authenticated(app), await authenticated(app, "two@example.com")
    async with aclosing(one), aclosing(two):
        cid = (await one.post("/api/conversations")).json()["id"]
        url = f"/api/conversations/{cid}"
        assert (await two.delete(url)).status_code == 404
        assert (await one.delete(url)).status_code == 409
        owner = uuid.UUID((await one.get("/api/me")).json()["id"])
        task_id = str(uuid.uuid4())
        async with app.state.db.sessions.begin() as session:
            session.add(
                Task(
                    id=task_id,
                    owner_id=owner,
                    request_id=task_id,
                    conversation_id=cid,
                    root_id=task_id,
                    definition={},
                    prompt="test",
                    status="running",
                )
            )
        assert (await one.patch(url, json={"archived": True})).status_code == 409
        assert (
            await one.put(url + "/reasoning", json={"reasoning": "high"})
        ).status_code == 409
        async with app.state.db.sessions.begin() as session:
            task = await session.get(Task, task_id)
            task.status = "completed"
        assert (await one.patch(url, json={"archived": True})).status_code == 200
        assert (await one.patch(url, json={"archived": False})).status_code == 200
        assert (await one.patch(url, json={"archived": True})).status_code == 200
        fork = (await one.post(url + "/fork")).json()["id"]
        assert (await one.delete(url)).status_code == 200
        assert (await one.get(f"/api/conversations/{fork}")).status_code == 200
        assert (await one.get(url)).status_code == 404
        assert not any(
            row["id"] == cid for row in (await one.get("/api/conversations")).json()
        )
        async with app.state.db.sessions() as session:
            assert await session.get(Conversation, cid) is None
            assert await session.get(Task, task_id) is not None
