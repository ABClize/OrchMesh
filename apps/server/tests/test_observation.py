import asyncio
import uuid
from contextlib import aclosing

from conftest import authenticated

from orchmesh.platform.observation import Observation, public_event
from orchmesh.storage import Task, TaskWait


async def seed(app, client):
    owner = uuid.UUID((await client.get("/api/me")).json()["id"])
    cid = (await client.post("/api/conversations")).json()["id"]
    root, child = str(uuid.uuid4()), str(uuid.uuid4())
    async with app.state.db.sessions.begin() as session:
        for identifier, parent in ((root, None), (child, root)):
            session.add(
                Task(
                    id=identifier,
                    root_id=root,
                    parent_id=parent,
                    owner_id=owner,
                    conversation_id=cid,
                    request_id=identifier,
                    prompt="test",
                    definition={"name": "Same agent"},
                    agent_id="shared-agent",
                    status="completed",
                )
            )
        session.add(TaskWait(waiter_id=root, dependency_id=child, root_id=root))
    return cid, root, child


async def test_graph_detail_ownership_and_stream_validation(app):
    one, two = await authenticated(app), await authenticated(app, "two@example.com")
    async with aclosing(one), aclosing(two):
        cid, root, child = await seed(app, one)
        graph = (await one.get(f"/api/conversations/{cid}/graph")).json()
        assert len(graph["nodes"]) == 1
        assert graph["nodes"][0]["call_count"] == 2
        assert {e["kind"] for e in graph["edges"]} == {"call"}
        assert graph["edges"][0]["source"] == "agent:shared-agent"
        assert graph["edges"][0]["target"] == "agent:shared-agent"
        assert graph["edges"][0]["task_ids"] == [child]
        assert (await one.get(f"/api/tasks/{root}")).json()["waiting_for"] == []
        for path in (
            f"/tasks/{child}",
            f"/tasks/{child}/history",
            f"/tasks/{child}/events",
            f"/conversations/{cid}/graph",
            f"/conversations/{cid}/graph/events",
        ):
            assert (await two.get("/api" + path)).status_code == 404
        response = await one.get(
            f"/api/tasks/{child}/events", headers={"Last-Event-ID": f"{root}:2"}
        )
        assert response.status_code == 422
        assert (
            await one.get(f"/api/tasks/{child}/history?after=-2")
        ).status_code == 422
        stream = await one.get(f"/api/tasks/{child}/events")
        assert "event: snapshot" in stream.text and "event: done" in stream.text


def test_public_events_exclude_private_headers_and_retry_diagnostics():
    def event(kind, data):
        return public_event("task", {"type": kind, "seq": 3, "time": 100, "data": data})

    assert event("request/header", {"secret": "credential"}) is None
    assert event("system/message", {"message": "private"}) is None
    assert event("user/message", {"source": {"kind": "orchmesh-continuation"}}) is None
    retry = event("llm/retry", {"retry": 1, "failure": {"secret": "credential"}})
    assert retry is not None and retry.data == {"retry": 1}
    ended = event("turn/end", {"reason": {"kind": "error", "message": "private"}})
    assert ended is not None and ended.data["reason"] == {"kind": "error"}


async def write_log(manager, task_id, *, incomplete=False):
    # Produce real v4 persisted events through the official SDK, no JSONL mock.
    root = manager.sandboxes.root(task_id) / "sessions"
    root.mkdir(parents=True)
    script = """
import { Context } from '@deepseek-ai/cordis';
import * as Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl';
const ctx = new Context();
await ctx.plugin(Jsonl, { root: process.argv[1], compression: 'none' }).await();
const h = await ctx.sessionPersistence.create({version:4, id:process.argv[2],
 createdAt:1, isSeeded:false});
await h.append([
 {seq:0,time:100,type:'turn/start',data:{turn:1}},
 {seq:1,time:110,type:'step/start',data:{turn:1,step:1}},
 {seq:2,time:120,type:'step/end',data:{turn:1,step:1}},
 {seq:3,time:130,type:'turn/end',data:{turn:1,reason:{kind:'completed'}}}
].slice(0, process.argv[3] === 'incomplete' ? 2 : 4));
await h.flush(); await h.close(); await ctx.fiber.dispose();
"""
    proc = await asyncio.create_subprocess_exec(
        "node",
        "--input-type=module",
        "-e",
        script,
        str(root),
        task_id,
        "incomplete" if incomplete else "complete",
        cwd=manager.settings.runtime_dir,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, error = await proc.communicate()
    assert proc.returncode == 0, error.decode()


async def test_official_log_pagination_and_replay_after_reader_restart(app):
    one = await authenticated(app)
    async with aclosing(one):
        _, root, _ = await seed(app, one)
        manager = app.state.manager
        await write_log(manager, root)
        first = (await one.get(f"/api/tasks/{root}/history?limit=2")).json()
        assert [e["seq"] for e in first["events"]] == [0, 1]
        assert first["next_after"] == 1 and first["has_more"]
        # A fresh read model/process uses the same official sequence numbers.
        page = await Observation(manager).page(root, first["next_after"], 2)
        assert [e.seq for e in page.events] == [2, 3]
        assert not page.has_more
        replay = await one.get(
            f"/api/tasks/{root}/events", headers={"Last-Event-ID": f"{root}:1"}
        )
        assert f"id: {root}:3" in replay.text
        assert '"seq":0' not in replay.text
        assert "event: done" in replay.text
        full = await Observation(manager).page(root, -1, 100)
        assert len(full.events) == 4


async def test_open_turn_replay_does_not_invent_interruptions_or_mutate_log(app):
    manager = app.state.manager
    task_id = str(uuid.uuid4())
    await write_log(manager, task_id, incomplete=True)
    log = next((manager.sandboxes.root(task_id) / "sessions").rglob("*.jsonl"))
    before = log.read_bytes()
    page = await Observation(manager).page(task_id, -1, 100)
    assert [e.type for e in page.events] == ["turn/start", "step/start"]
    assert log.read_bytes() == before


async def test_detail_uses_live_projection_and_ignores_completed_dependencies(app):

    from orchmesh.dsh.messages import Messages

    one = await authenticated(app)
    async with aclosing(one):
        cid, root, child = await seed(app, one)
        async with app.state.db.sessions.begin() as session:
            task = await session.get(Task, root)
            task.status = "running"
            dependency = await session.get(Task, child)
            dependency.status = "running"
        app.state.manager.live[root] = Messages(
            [{"role": "assistant", "content": [{"type": "text", "text": "Live"}]}]
        )
        first = (await one.get(f"/api/tasks/{root}")).json()
        assert first["activity"] == "waiting_dependency"
        assert first["messages"][0]["content"][0]["text"] == "Live"
        async with app.state.db.sessions.begin() as session:
            dependency = await session.get(Task, child)
            dependency.status = "completed"
        graph = (await one.get(f"/api/conversations/{cid}/graph")).json()
        assert len(graph["edges"]) == 1
        assert graph["edges"][0]["kind"] == "call"
        assert (
            next(n for n in graph["calls"] if n["id"] == root)["activity"]
            == "executing"
        )
        detail = (await one.get(f"/api/tasks/{root}")).json()
        assert detail["activity"] == "executing"
        assert detail["waiting_for"] == []
        app.state.manager.live.clear()


async def test_agent_graph_aggregates_calls_versions_and_keeps_details(app):
    one = await authenticated(app)
    async with aclosing(one):
        cid, root, child = await seed(app, one)
        async with app.state.db.sessions.begin() as session:
            parent = await session.get(Task, root)
            parent.agent_id = None
            parent.version_id = "assistant-v1"
            existing = await session.get(Task, child)
            existing.version_id = "version-1"
            for identifier, agent, status, parent_id in (
                ("repeat", "draft:shared-agent", "running", root),
                ("reverse", None, "failed", child),
            ):
                session.add(
                    Task(
                        id=identifier,
                        root_id=root,
                        parent_id=parent_id,
                        owner_id=parent.owner_id,
                        conversation_id=cid,
                        request_id=identifier,
                        prompt=identifier,
                        definition={"name": "Same name"},
                        agent_id=agent,
                        version_id="version-2" if agent else "assistant-v1",
                        status=status,
                    )
                )
        graph = (await one.get(f"/api/conversations/{cid}/graph?root_id={root}")).json()
        assert len(graph["nodes"]) == 2
        target = next(n for n in graph["nodes"] if n["agent_id"] == "shared-agent")
        assert target["call_count"] == 2 and target["active_count"] == 1
        assert target["version_ids"] == ["version-1", "version-2"]
        forward = next(e for e in graph["edges"] if e["source"] == "builtin:assistant")
        assert forward["call_count"] == 2
        assert forward["status_counts"] == {"completed": 1, "running": 1}
        assert set(forward["task_ids"]) == {child, "repeat"}
        assert len(graph["edges"]) == 2  # Reverse calls stay directional.
        for task_id in forward["task_ids"]:
            detail = (await one.get(f"/api/tasks/{task_id}")).json()
            assert detail["parent_id"] == root
        empty = (
            await one.get(f"/api/conversations/{cid}/graph?root_id=missing")
        ).json()
        assert empty == {"nodes": [], "edges": [], "calls": []}


async def test_running_worker_with_other_pending_questions_remains_executing(app):
    client = await authenticated(app)
    async with aclosing(client):
        _, root, _ = await seed(app, client)
        async with app.state.db.sessions.begin() as session:
            task = await session.get(Task, root)
            task.status = "running"
            task.questions = [{"callId": "another-pending-question", "questions": []}]
        observation = Observation(app.state.manager)
        app.state.manager.live[root] = object()
        try:
            assert observation.node(task, []).activity == "executing"
            task.status = "waiting"
            assert observation.node(task, []).activity == "waiting_user"
        finally:
            app.state.manager.live.pop(root, None)


async def test_lifecycle_end_is_explicit_and_not_estimated(app):
    client = await authenticated(app)
    async with aclosing(client):
        cid, root, child = await seed(app, client)
        async with app.state.db.sessions.begin() as session:
            task = await session.get(Task, child)
            task.status = "completed"
            task.finished_at = "2026-10-27T01:00:00+00:00"
        graph = (await client.get(f"/api/conversations/{cid}/graph")).json()
        calls = {call["id"]: call for call in graph["calls"]}
        assert calls[child]["finished_at"] == "2026-10-27T01:00:00+00:00"
        assert calls[root]["finished_at"] is None
        detail = (await client.get(f"/api/tasks/{child}")).json()
        assert detail["finished_at"] == calls[child]["finished_at"]
