import asyncio
from contextlib import aclosing
from unittest.mock import AsyncMock

from conftest import authenticated

from orchmesh.dsh.rpc import RPC


async def test_navigation_reuses_official_host_across_reads_and_remove(
    app, monkeypatch
):
    starts = 0
    original = RPC.start

    async def counted(self):
        nonlocal starts
        starts += 1
        await original(self)

    monkeypatch.setattr(RPC, "start", counted)
    client = await authenticated(app)
    async with aclosing(client):
        project = (
            await client.post("/api/projects", json={"name": "latency regression"})
        ).json()
        reads = await asyncio.gather(
            client.get("/api/projects"), client.get("/api/conversations")
        )
        assert all(r.status_code == 200 for r in reads)
        assert (
            await client.delete("/api/projects/" + project["id"])
        ).status_code == 200
        assert (await client.get("/api/projects")).json() == []
        assert starts == 1, "Navigation restarts the official SDK for each request"


async def test_host_reused_for_execution_and_released_on_shutdown(app, monkeypatch):
    client = await authenticated(app)
    async with aclosing(client):
        cid = (await client.post("/api/conversations")).json()["id"]
        manager = app.state.manager
        uid = next(iter(manager.hosts))
        host = manager.hosts[uid]
        await client.post("/api/conversations/" + cid + "/runs", json={"text": "slow"})
        assert not host.rpc.closed.is_set()
        assert manager.hosts[uid] is host
        await client.post("/api/conversations/" + cid + "/stop")
        await client.get("/api/projects")
        assert manager.hosts[uid] is host
        await manager.close()
        assert host.rpc.closed.is_set()
        assert not manager.hosts


async def test_control_host_failures_are_not_replayed(app, monkeypatch):
    client = await authenticated(app)
    async with aclosing(client):
        await client.get("/api/projects")
        manager = app.state.manager
        host = next(iter(manager.hosts.values()))
        call = AsyncMock(side_effect=RuntimeError("lost connection"))
        monkeypatch.setattr(host.rpc, "call", call)
        assert (await client.get("/api/projects")).status_code == 503
        assert call.await_count == 1
        assert not manager.hosts
        assert (await client.get("/api/projects")).status_code == 200


async def test_control_host_retention_is_bounded(app):
    app.state.manager.settings.max_active_runs = 1
    one, two = await authenticated(app), await authenticated(app, "two@example.com")
    async with aclosing(one), aclosing(two):
        await asyncio.gather(*app.state.manager.warming.values())
        assert (await one.get("/api/projects")).status_code == 200
        assert (await two.get("/api/projects")).status_code == 200
        assert len(app.state.manager.hosts) == 1
        assert not app.state.manager.reading


async def test_control_host_scope_and_new_mount_refresh(app):
    client = await authenticated(app)
    async with aclosing(client):
        await client.get("/api/projects")
        manager = app.state.manager
        first = next(iter(manager.hosts.values()))
        project = (
            await client.post("/api/projects", json={"name": "new mount"})
        ).json()
        assert not first.rpc.closed.is_set()
        second = next(iter(manager.hosts.values()))
        assert (
            await client.post("/api/conversations", json={"project_id": project["id"]})
        ).status_code == 201
        assert second is first
        assert not second.rpc.closed.is_set()


async def test_expired_control_host_is_reaped_and_reopened(app):
    client = await authenticated(app)
    async with aclosing(client):
        await client.get("/api/projects")
        manager = app.state.manager
        host = next(iter(manager.hosts.values()))
        host.expires = 0
        await manager.expire_hosts()
        assert host.rpc.closed.is_set()
        assert not manager.hosts
        assert (await client.get("/api/projects")).status_code == 200


async def test_two_sessions_and_turns_share_host_but_not_history(app):
    from conftest import settle

    client = await authenticated(app)
    async with aclosing(client):
        ids = [(await client.post("/api/conversations")).json()["id"] for _ in range(2)]
        host = next(iter(app.state.manager.hosts.values()))
        for cid in (ids[0], ids[1], ids[0]):
            url = "/api/conversations/" + cid
            assert (
                await client.post(url + "/runs", json={"text": cid})
            ).status_code == 202
            await settle(app)
            assert next(iter(app.state.manager.hosts.values())) is host
            messages = (await client.get(url)).json()["messages"]
            assert all(
                m["content"][0]["text"] == cid for m in messages if m["role"] == "user"
            )
        assert len([m for m in messages if m["role"] == "user"]) == 2


async def test_idle_reaper_preserves_official_background_work(app, monkeypatch):
    client = await authenticated(app)
    async with aclosing(client):
        await client.get("/api/projects")
        manager = app.state.manager
        host = next(iter(manager.hosts.values()))
        original = host.rpc.call

        async def busy(method, **params):
            if method == "orchmesh/busy":
                return {"busy": True}
            return await original(method, **params)

        monkeypatch.setattr(host.rpc, "call", busy)
        host.expires = 0
        await manager.expire_hosts()
        assert not host.rpc.closed.is_set()
        assert host.expires > 0


async def test_login_prewarms_without_waiting_and_deduplicates(app, monkeypatch):
    started, release = asyncio.Event(), asyncio.Event()
    original = RPC.start
    starts = 0

    async def blocked(self):
        nonlocal starts
        starts += 1
        started.set()
        await release.wait()
        await original(self)

    monkeypatch.setattr(RPC, "start", blocked)
    client = await asyncio.wait_for(authenticated(app), 2)
    async with aclosing(client):
        await asyncio.wait_for(started.wait(), 2)
        manager = app.state.manager
        uid = next(iter(manager.warming))
        manager.prewarm(uid)
        assert starts == 1
        request = asyncio.create_task(client.get("/api/projects"))
        release.set()
        assert (await request).status_code == 200
        assert starts == 1


async def test_capacity_does_not_evict_active_user(app):
    from conftest import settle

    manager = app.state.manager
    manager.settings.max_active_runs = 1
    one = await authenticated(app)
    async with aclosing(one):
        cid = (await one.post("/api/conversations")).json()["id"]
        host = next(iter(manager.hosts.values()))
        await one.post(f"/api/conversations/{cid}/runs", json={"text": "slow"})
        two = await authenticated(app, "two@example.com")
        async with aclosing(two):
            await asyncio.gather(*manager.warming.values())
            assert (await two.get("/api/projects")).status_code == 409
            assert list(manager.hosts.values()) == [host]
            host.expires = 0
            await manager.expire_hosts()
            assert not host.rpc.closed.is_set()
            await one.post(f"/api/conversations/{cid}/stop")
            await settle(app)
            assert (await two.get("/api/projects")).status_code == 200
