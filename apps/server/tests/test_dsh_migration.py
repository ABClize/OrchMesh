from contextlib import aclosing

from conftest import authenticated


async def test_empty_conversation_uses_native_read_only_history(app):
    client = await authenticated(app)
    async with aclosing(client):
        cid = (await client.post("/api/conversations")).json()["id"]

        response = await client.get(f"/api/conversations/{cid}")
        assert response.status_code == 200
        assert response.json()["messages"] == []
        assert not app.state.manager.reading
