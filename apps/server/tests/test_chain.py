import asyncio
import json
from contextlib import aclosing

import httpx
import pytest
from conftest import authenticated, settle


async def test_csrf_auth_ownership_revocation(app):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as anonymous:
        assert (await anonymous.get("/api/me")).status_code == 401
        assert (
            await anonymous.post(
                "/api/auth/login",
                data={"username": "one@example.com", "password": "bad"},
            )
        ).status_code == 403
    one = await authenticated(app)
    two = await authenticated(app, "two@example.com")
    async with aclosing(one), aclosing(two):
        response = await one.post("/api/conversations")
        assert response.status_code == 201
        cid = response.json()["id"]
        for method, suffix, body in [
            ("GET", "", None),
            ("POST", "/runs", {"text": "leak"}),
            ("POST", "/stop", None),
            ("GET", "/events", None),
        ]:
            response = await two.request(
                method, f"/api/conversations/{cid}{suffix}", json=body
            )
            assert response.status_code == 404, response.text
        token = one.cookies["orchmesh_session"]
        assert await app.state.auth.valid_session(token)
        assert (await one.post("/api/auth/logout")).status_code == 204
        assert not await app.state.auth.valid_session(token)
        assert (await one.get("/api/me")).status_code == 401


async def test_stream_stop_and_resume_history(app):
    client = await authenticated(app)
    async with aclosing(client):
        cid = (await client.post("/api/conversations")).json()["id"]
        url = f"/api/conversations/{cid}"
        assert (
            await client.post(url + "/runs", json={"text": "slow"})
        ).status_code == 202
        assert (
            await client.post(url + "/runs", json={"text": "duplicate"})
        ).status_code == 409
        await asyncio.sleep(0.4)
        snapshot = (await client.get(url)).json()
        assert snapshot["status"] == "running"
        assert snapshot["messages"][-1]["content"][0]["text"]
        # Independent stream subscriber; stopping does not depend on its connection.
        subscription = asyncio.create_task(client.get(url + "/events"))
        await asyncio.sleep(0.2)
        assert (await client.post(url + "/stop")).status_code == 200
        events = await asyncio.wait_for(subscription, 5)
        assert "text_delta" in events.text
        assert '"stopped"' in events.text
        await settle(app)
        restored = (await client.get(url)).json()
        assert restored["status"] == "stopped"
        assert restored["messages"][-1]["stopReason"] == "aborted"
        assert (
            await client.post(url + "/runs", json={"text": "again"})
        ).status_code == 202
        await settle(app)
        final = (await client.get(url)).json()
        assert final["status"] == "completed"
        assert len(final["messages"]) == 4


@pytest.mark.parametrize(
    "prompt,status", [("crash", "failed"), ("handled", "completed")]
)
async def test_exit_and_handled_release_capacity(app, prompt, status):
    client = await authenticated(app)
    async with aclosing(client):
        cid = (await client.post("/api/conversations")).json()["id"]
        url = f"/api/conversations/{cid}"
        await client.post(url + "/runs", json={"text": prompt})
        await settle(app)
        assert (await client.get(url)).json()["status"] == status
        assert (
            await client.post(url + "/runs", json={"text": "hello"})
        ).status_code == 202
        await settle(app)


async def test_logout_revokes_live_stream(app):
    client = await authenticated(app)
    async with aclosing(client):
        cid = (await client.post("/api/conversations")).json()["id"]
        url = f"/api/conversations/{cid}"
        await client.post(url + "/runs", json={"text": "slow"})
        stream = asyncio.create_task(client.get(url + "/events"))
        await asyncio.sleep(0.25)
        await client.post("/api/auth/logout")
        response = await asyncio.wait_for(stream, 3)
        assert "event: unauthorized" in response.text
        # Logging out detaches the UI, never silently aborts work.
        assert app.state.manager.active


async def test_login_rate_limit(app):
    client = await authenticated(app)
    async with aclosing(client):
        statuses = []
        for _ in range(11):
            statuses.append(
                (
                    await client.post(
                        "/api/auth/login",
                        data={"username": "missing@example.com", "password": "bad"},
                    )
                ).status_code
            )
        assert 429 in statuses


async def test_snapshot_recovers_buffer_overflow(app):
    client = await authenticated(app)
    async with aclosing(client):
        cid = (await client.post("/api/conversations")).json()["id"]
        url = f"/api/conversations/{cid}"
        await client.post(url + "/runs", json={"text": "slow"})
        run = next(iter(app.state.manager.active.values()))
        await run.ready.wait()
        for _ in range(300):
            run.emit({"type": "noop"})
        stream = asyncio.create_task(
            client.get(url + "/events", headers={"Last-Event-ID": "1"})
        )
        await asyncio.sleep(0.1)
        await client.post(url + "/stop")
        response = await stream
        data = [
            json.loads(line[6:])
            for line in response.text.splitlines()
            if line.startswith("data: ")
        ]
        assert data[0]["type"] == "snapshot"
        assert data[0]["cursor"] >= 300


async def test_abort_timeout_releases_user_after_process_cleanup(app, monkeypatch):
    from orchmesh.pi.rpc import RPC

    original = RPC.call

    async def timeout_abort(self, method, **params):
        if method == "abort":
            raise TimeoutError
        return await original(self, method, **params)

    monkeypatch.setattr(RPC, "call", timeout_abort)
    client = await authenticated(app)
    async with aclosing(client):
        cid = (await client.post("/api/conversations")).json()["id"]
        url = f"/api/conversations/{cid}"
        await client.post(url + "/runs", json={"text": "slow"})
        run = next(iter(app.state.manager.active.values()))
        await run.ready.wait()
        await client.post(url + "/stop")
        await settle(app)
        assert run.status == "stopped"
        assert run.rpc.process.returncode is not None


async def test_restart_marks_running_metadata_interrupted(app):
    import uuid

    from sqlalchemy import select

    from orchmesh.storage import Run

    client = await authenticated(app)
    async with aclosing(client):
        cid = (await client.post("/api/conversations")).json()["id"]
    async with app.state.db.sessions() as session:
        run = Run(conversation_id=uuid.UUID(cid))
        session.add(run)
        await session.commit()
        run_id = run.id
    await app.state.manager.recover()
    async with app.state.db.sessions() as session:
        restored = await session.scalar(select(Run).where(Run.id == run_id))
        assert restored.status == "interrupted"
    assert not app.state.manager.active


async def test_static_frontend_and_unknown_api(app):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/api/does-not-exist")
        assert response.status_code == 404
        assert response.headers["content-type"].startswith("application/json")
        response = await client.get("/assets/does-not-exist.js")
        assert response.status_code == 404
        response = await client.get("/")
        assert response.status_code == 200
        assert "<title>OrchMesh</title>" in response.text
