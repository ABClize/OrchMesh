import uuid
from contextlib import aclosing

from conftest import authenticated
from sqlalchemy import select

from orchmesh.storage import AgentVersion, Task

DEFINITION = {
    "name": "Translator",
    "description": "Short translations",
    "instructions": "Translate faithfully.",
    "tools": [],
    "knowledge_ids": [],
}


async def test_drafts_private_publish_requires_confirmation_and_matching_trial(app):
    one, two = await authenticated(app), await authenticated(app, "two@example.com")
    async with aclosing(one), aclosing(two):
        agent = (await one.post("/api/agents", json=DEFINITION)).json()
        identifier = agent["id"]
        assert (await two.get("/api/agents")).json() == []
        assert (
            await two.put(f"/api/agents/{identifier}", json=DEFINITION)
        ).status_code == 404
        assert (
            await one.post(f"/api/agents/{identifier}/publish", json={"confirm": False})
        ).status_code == 422
        assert (
            await one.post(f"/api/agents/{identifier}/publish", json={"confirm": True})
        ).status_code == 409
        owner = uuid.UUID((await one.get("/api/me")).json()["id"])
        cid = (await one.post("/api/conversations")).json()["id"]
        async with app.state.db.sessions.begin() as session:
            session.add(
                Task(
                    id=str(uuid.uuid4()),
                    owner_id=owner,
                    request_id="trial",
                    conversation_id=cid,
                    root_id="trial",
                    agent_id="draft:" + identifier,
                    definition={**DEFINITION, "knowledge": []},
                    prompt="test",
                    status="completed",
                )
            )
        published = await one.post(
            f"/api/agents/{identifier}/publish", json={"confirm": True}
        )
        assert published.status_code == 200
        version = published.json()["published_version"]
        changed = {**DEFINITION, "instructions": "A new unpublished instruction"}
        assert (
            await one.put(f"/api/agents/{identifier}", json=changed)
        ).status_code == 200
        public = (await two.get("/api/agents")).json()[0]
        assert public["draft"]["instructions"] == DEFINITION["instructions"]
        async with app.state.db.sessions() as session:
            assert (await session.get(AgentVersion, version)).definition[
                "instructions"
            ] == DEFINITION["instructions"]
        assert (
            await one.post(f"/api/agents/{identifier}/publish", json={"confirm": True})
        ).status_code == 409


async def test_memory_ownership_disable_and_delete(app):
    one, two = await authenticated(app), await authenticated(app, "two@example.com")
    async with aclosing(one), aclosing(two):
        item = (
            await one.post("/api/context/memory", json={"content": "Prefer Chinese"})
        ).json()["id"]
        assert (await two.get("/api/context/memory")).json() == []
        assert (await two.delete("/api/context/memory/" + item)).status_code == 404
        assert (
            await one.put(
                "/api/context/memory/" + item,
                json={"content": "Prefer Chinese", "enabled": False},
            )
        ).status_code == 200
        assert (await one.get("/api/context/memory")).json()[0]["enabled"] is False
        assert (await one.delete("/api/context/memory/" + item)).status_code == 200


async def test_legacy_readonly_and_fork_preserve_file_binding(app):
    from orchmesh.storage import Conversation

    one = await authenticated(app)
    async with aclosing(one):
        cid = (await one.post("/api/conversations")).json()["id"]
        directory = uuid.uuid4()
        async with app.state.db.sessions.begin() as session:
            row = await session.get(Conversation, cid)
            row.legacy, row.directory_id = True, directory
            row.legacy_messages = [
                {"role": "user", "content": [{"type": "text", "text": "history"}]}
            ]
        assert (
            await one.post(
                f"/api/conversations/{cid}/runs", json={"text": "do not replay"}
            )
        ).status_code == 409
        child = (await one.post(f"/api/conversations/{cid}/fork")).json()
        assert child["directory_id"] == str(directory)
        state = (await one.get("/api/conversations/" + child["id"])).json()
        assert (
            state["read_only"] is False
            and state["messages"][0]["content"][0]["text"] == "history"
        )


async def test_collaboration_wait_cycles_are_rejected_without_depth_limits(app):
    import pytest

    from orchmesh.storage import TaskWait

    owner = uuid.uuid4()
    async with app.state.db.sessions.begin() as session:
        for identifier in ("root", "a", "b"):
            session.add(
                Task(
                    id=identifier,
                    owner_id=owner,
                    request_id=identifier,
                    conversation_id="c",
                    root_id="root",
                    prompt=identifier,
                    definition={},
                    status="running",
                )
            )
    async with app.state.db.sessions() as session:
        first, second = await session.get(Task, "a"), await session.get(Task, "b")
    await app.state.manager.protocol.attach_wait(first, "b")
    with pytest.raises(ValueError, match="cycle"):
        await app.state.manager.protocol.attach_wait(second, "a")
    async with app.state.db.sessions() as session:
        edges = (await session.scalars(select(TaskWait))).all()
        assert len(edges) == 1


async def test_artifact_download_checks_owner_and_preserves_ranges(app, tmp_path):
    from orchmesh.storage import Artifact

    one, two = await authenticated(app), await authenticated(app, "two@example.com")
    async with aclosing(one), aclosing(two):
        owner = uuid.UUID((await one.get("/api/me")).json()["id"])
        path = tmp_path / "artifact" / "report.txt"
        path.parent.mkdir()
        path.write_text("artifact-content")
        identifier = str(uuid.uuid4())
        async with app.state.db.sessions.begin() as session:
            session.add(
                Artifact(
                    id=identifier,
                    owner_id=owner,
                    task_id="t",
                    conversation_id="c",
                    name=path.name,
                    path=str(path),
                    digest="unused",
                    size=path.stat().st_size,
                )
            )
        reference = f"@artifacts/{identifier}/report.txt"
        response = await one.get(
            "/api/workspace/file",
            params={"path": reference},
            headers={"Range": "bytes=0-7"},
        )
        assert response.status_code == 206 and response.content == b"artifact"
        assert (
            await two.get("/api/workspace/file", params={"path": reference})
        ).status_code == 404
        assert (
            await one.get(
                "/api/workspace/file",
                params={"path": reference.replace("report.txt", "other.txt")},
            )
        ).status_code == 404


async def test_inputs_preserve_owner_and_readonly_boundary(app):
    one, two = await authenticated(app), await authenticated(app, "two@example.com")
    async with aclosing(one), aclosing(two):
        cid = (await one.post("/api/conversations")).json()["id"]
        response = await one.post(
            f"/api/conversations/{cid}/inputs",
            files={"file": ("notes.md", b"PRIVATE_INPUT")},
        )
        assert response.status_code == 201
        files = (await one.get(f"/api/conversations/{cid}/inputs")).json()
        assert len(files) == 1 and files[0]["name"] == "notes.md"
        assert (await two.get(f"/api/conversations/{cid}/inputs")).status_code == 404
        assert (
            await two.post(
                f"/api/conversations/{cid}/inputs",
                files={"file": ("other.md", b"OTHER")},
            )
        ).status_code == 404
        assert (
            await two.get("/api/workspace/file", params={"path": files[0]["path"]})
        ).status_code == 404
        assert (
            await one.get("/api/workspace/file", params={"path": files[0]["path"]})
        ).content == b"PRIVATE_INPUT"
        await one.patch(f"/api/conversations/{cid}", json={"archived": True})
        assert (
            await one.post(
                f"/api/conversations/{cid}/inputs", files={"file": ("late.md", b"LATE")}
            )
        ).status_code == 409


async def test_invalid_question_answer_does_not_persist(app):
    from orchmesh.storage import Answer

    one = await authenticated(app)
    async with aclosing(one):
        owner = uuid.UUID((await one.get("/api/me")).json()["id"])
        cid = (await one.post("/api/conversations")).json()["id"]
        async with app.state.db.sessions.begin() as session:
            session.add(
                Task(
                    id="question-test",
                    owner_id=owner,
                    request_id="question",
                    conversation_id=cid,
                    root_id="question-test",
                    prompt="p",
                    definition={},
                    status="waiting",
                    questions=[
                        {
                            "callId": "call",
                            "questions": [{"id": "language", "question": "Language?"}],
                        }
                    ],
                )
            )
        response = await one.post(
            "/api/tasks/question-test/answers",
            json={"call_id": "call", "answer": {"answers": []}},
        )
        assert response.status_code == 422
        async with app.state.db.sessions() as session:
            assert await session.get(Answer, "question-test:call") is None


async def test_recovery_waits_for_admitted_children_even_before_wait_edge(
    app, monkeypatch
):
    from orchmesh.storage import TaskWait

    owner = uuid.uuid4()
    async with app.state.db.sessions.begin() as session:
        for identifier, parent in (
            ("root-recovery", None),
            ("admitted", "root-recovery"),
            ("shared", None),
        ):
            session.add(
                Task(
                    id=identifier,
                    parent_id=parent,
                    root_id="root-recovery",
                    owner_id=owner,
                    request_id=identifier,
                    conversation_id="c",
                    definition={},
                    prompt="p",
                    status="running",
                )
            )
        session.add(
            TaskWait(
                waiter_id="root-recovery",
                dependency_id="shared",
                root_id="root-recovery",
            )
        )
    seen = []

    async def official_wait(identifier, user):
        assert user == owner
        seen.append(identifier)
        return {"task_id": identifier, "status": "completed", "result": []}

    monkeypatch.setattr(app.state.manager.protocol, "wait_status", official_wait)
    async with app.state.db.sessions() as session:
        root = await session.get(Task, "root-recovery")
    restored = await app.state.manager.protocol.recover_dependencies(root)
    assert seen == ["admitted", "shared"]
    assert len(restored) == 2
