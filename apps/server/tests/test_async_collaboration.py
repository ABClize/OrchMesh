import uuid
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from orchmesh.storage import Task, TaskWait


async def seed(app):
    owner = uuid.uuid4()
    async with app.state.db.sessions.begin() as session:
        for identifier, parent in (("root", None), ("a", "root"), ("b", "root")):
            session.add(
                Task(
                    id=identifier,
                    owner_id=owner,
                    root_id="root",
                    parent_id=parent,
                    request_id=f"a2a:root:{identifier}",
                    conversation_id="c",
                    agent_id="agent",
                    prompt="work",
                    definition={},
                    status="running",
                )
            )
        session.add(
            Task(
                id="foreign",
                owner_id=uuid.uuid4(),
                root_id="root",
                request_id="foreign",
                conversation_id="other",
                prompt="private",
                definition={},
                status="running",
            )
        )
    async with app.state.db.sessions() as session:
        return await session.get(Task, "root"), await session.get(Task, "a")


async def test_start_reuses_admitted_work_without_wait_or_recovery_barrier(
    app, monkeypatch
):
    parent, _ = await seed(app)
    protocol = app.state.manager.protocol
    wait = AsyncMock(side_effect=AssertionError("start must not wait"))
    monkeypatch.setattr(protocol, "wait_status", wait)
    first = await protocol.start(
        parent, {"agent_id": "agent", "task": "work", "work_key": "a"}
    )
    second = await protocol.start(
        parent, {"agent_id": "agent", "task": "work", "work_key": "a"}
    )
    assert first == second == {"task_id": "a", "status": "running", "accepted": True}
    assert await protocol.recover_dependencies(parent, include_children=False) == []
    async with app.state.db.sessions() as session:
        assert (await session.scalars(select(TaskWait))).all() == []
    with pytest.raises(ValueError, match="different assignment"):
        await protocol.start(
            parent, {"agent_id": "agent", "task": "changed", "work_key": "a"}
        )


async def test_collect_validates_entire_batch_and_returns_individual_failure(
    app, monkeypatch
):
    parent, child = await seed(app)
    protocol = app.state.manager.protocol

    async def finish(identifier, owner):
        async with app.state.db.sessions.begin() as session:
            row = await session.get(Task, identifier)
            row.status = "failed" if identifier == "b" else "completed"

    wait = AsyncMock(side_effect=finish)
    monkeypatch.setattr(protocol, "wait_status", wait)
    with pytest.raises(ValueError, match="owned collaboration"):
        await protocol.collect(parent, ["a", "foreign"])
    with pytest.raises(ValueError, match="ancestor"):
        await protocol.collect(child, ["root"])
    with pytest.raises(ValueError, match="non-empty"):
        await protocol.collect(parent, [])
    async with app.state.db.sessions() as session:
        assert (await session.scalars(select(TaskWait))).all() == []
    wait.assert_not_awaited()
    result = await protocol.collect(parent, ["a", "b", "a"])
    assert [task["status"] for task in result["tasks"]] == ["completed", "failed"]
    assert wait.await_count == 2
    wait.reset_mock()
    restored = await protocol.recover_dependencies(parent, include_children=False)
    assert restored == []
    assert all("result" not in item for item in result["tasks"])


async def test_any_uses_dbos_and_preserves_mode_on_interruption(app, monkeypatch):
    from dbos import DBOS

    parent, _ = await seed(app)
    protocol = app.state.manager.protocol
    handles = AsyncMock(side_effect=lambda identifier: identifier)
    monkeypatch.setattr(DBOS, "retrieve_workflow_async", handles)
    first = AsyncMock(side_effect=RuntimeError("interrupted"))
    monkeypatch.setattr(DBOS, "wait_first_async", first)
    with pytest.raises(RuntimeError, match="interrupted"):
        await protocol.collect(parent, ["a", "b"], "any")
    async with app.state.db.sessions() as session:
        assert [r.mode for r in await session.scalars(select(TaskWait))] == [
            "any",
            "any",
        ]

    async def finish(handles):
        async with app.state.db.sessions.begin() as session:
            row = await session.get(Task, "b")
            row.status = "completed"

    first.side_effect = finish
    restored = await protocol.recover_dependencies(parent, include_children=False)
    assert [r["status"] for r in restored] == ["running", "completed"]
    assert all(set(r) == {"task_id", "agent_id", "name", "status"} for r in restored)
    async with app.state.db.sessions() as session:
        assert list(await session.scalars(select(TaskWait))) == []
    first.reset_mock()
    await protocol.collect(parent, ["a", "b"], "any")
    first.assert_not_awaited()
    with pytest.raises(ValueError, match="mode"):
        await protocol.collect(parent, ["a"], "invalid")


async def test_result_requires_explicit_owned_terminal_read(app, monkeypatch):
    parent, _ = await seed(app)
    protocol = app.state.manager.protocol
    read = AsyncMock(return_value={"task_id": "a", "result": ["final only"]})
    monkeypatch.setattr(protocol, "result", read)
    assert "result" not in await protocol.read_result(parent, "a")
    read.assert_not_awaited()
    with pytest.raises(ValueError, match="owned collaboration"):
        await protocol.read_result(parent, "foreign")
    async with app.state.db.sessions.begin() as session:
        row = await session.get(Task, "a")
        row.status = "completed"
    assert (await protocol.read_result(parent, "a"))["result"] == ["final only"]


async def test_a2a_result_projects_final_text_not_history(app, monkeypatch):
    await seed(app)
    protocol = app.state.manager.protocol
    async with app.state.db.sessions.begin() as session:
        row = await session.get(Task, "a")
        row.status = "completed"
        row.a2a_id = "a2a-a"
        row.a2a_context = "context"
        row.messages = [
            {"role": "user", "content": [{"type": "text", "text": "private prompt"}]},
            {"role": "toolResult", "content": [{"type": "text", "text": "tool log"}]},
            {
                "role": "assistant",
                "content": [{"type": "text", "text": "final answer"}],
            },
        ]
    monkeypatch.setattr(protocol.store, "get", AsyncMock(return_value=None))
    save = AsyncMock()
    monkeypatch.setattr(protocol.store, "save", save)
    await protocol.project("a")
    value = save.call_args.args[0]
    assert [p.text for a in value.artifacts for p in a.parts] == ["final answer"]
