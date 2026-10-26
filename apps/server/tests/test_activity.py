from contextlib import aclosing
from unittest.mock import AsyncMock

from conftest import authenticated


async def test_activity_ownership_and_closed_run(app):
    one, two = await authenticated(app), await authenticated(app, "two@example.com")
    async with aclosing(one), aclosing(two):
        cid = (await one.post("/api/conversations")).json()["id"]
        url = f"/api/conversations/{cid}/activity"
        for path in (url, url + "/children/unowned"):
            assert (await two.get(path)).status_code == 404
        assert (
            await two.post(
                url,
                json={
                    "kind": "answer",
                    "request_id": "other",
                    "outcome": "allowed-once",
                },
            )
        ).status_code == 404
        assert (
            await one.post(url, json={"kind": "prompt", "text": "late"})
        ).status_code == 409
        assert (
            await one.post(url, json={"kind": "answer", "request_id": "x"})
        ).status_code == 422
        assert (
            await one.post(url, json={"kind": "prompt", "text": "  "})
        ).status_code == 422


async def test_activity_routes_preserve_explicit_decisions(app):
    one = await authenticated(app)
    async with aclosing(one):
        cid = (await one.post("/api/conversations")).json()["id"]
        url = f"/api/conversations/{cid}/activity"
        app.state.manager.activity = AsyncMock(return_value={"accepted": True})
        r = await one.post(
            url, json={"kind": "answer", "request_id": "r", "outcome": "rejected"}
        )
        assert r.status_code == 200
        assert app.state.manager.activity.call_args.kwargs["outcome"] == "rejected"
        r = await one.post(
            url,
            json={
                "kind": "queue",
                "item_id": "q",
                "action": "edit",
                "text": "corrected",
            },
        )
        assert r.status_code == 200
        assert app.state.manager.activity.call_args.kwargs["action"] == {
            "kind": "edit",
            "content": [{"type": "text", "text": "corrected"}],
        }


async def test_send_waits_for_inflight_metadata_host(app, monkeypatch):
    import asyncio

    from orchmesh.dsh.rpc import RPC

    one = await authenticated(app)
    async with aclosing(one):
        cid = (await one.post("/api/conversations")).json()["id"]
        url = f"/api/conversations/{cid}"
        entered, release = asyncio.Event(), asyncio.Event()
        original = RPC.start
        first = True

        async def delayed_start(self):
            nonlocal first
            if first:
                first = False
                entered.set()
                await release.wait()
            await original(self)

        monkeypatch.setattr(RPC, "start", delayed_start)
        read = asyncio.create_task(one.get(url))
        await asyncio.wait_for(entered.wait(), 2)
        send = asyncio.create_task(one.post(url + "/runs", json={"text": "Hello"}))
        await asyncio.sleep(0.02)
        release.set()
        assert (await read).status_code == 200
        assert (await send).status_code == 202
