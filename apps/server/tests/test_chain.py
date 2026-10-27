from contextlib import aclosing

import httpx
from conftest import authenticated


async def test_bearer_auth_and_ownership(app):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as anonymous:
        assert (await anonymous.get("/api/me")).status_code == 401
        assert (
            await anonymous.post(
                "/api/login/access-token",
                data={"username": "one@example.com", "password": "bad"},
            )
        ).status_code == 400
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
        token = one.headers["Authorization"][7:]
        assert await app.state.auth.valid_token(token)
        del one.headers["Authorization"]
        assert (await one.get("/api/me")).status_code == 401
        # Template logout is client-side; existing JWTs remain valid until expiry.
        assert await app.state.auth.valid_token(token)


async def test_login_rate_limit(app):
    client = await authenticated(app)
    async with aclosing(client):
        statuses = []
        for _ in range(11):
            statuses.append(
                (
                    await client.post(
                        "/api/login/access-token",
                        data={"username": "missing@example.com", "password": "bad"},
                    )
                ).status_code
            )
        assert 429 in statuses


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


async def test_old_cookies_do_not_authenticate_or_block_login(app):
    from conftest import PASSWORD

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        client.cookies.set("orchmesh_csrf", "old")
        client.cookies.set("orchmesh_session", "old")
        assert (await client.get("/api/me")).status_code == 401
        assert (await client.post("/api/conversations")).status_code == 401
        result = await client.post(
            "/api/login/access-token",
            data={"username": "one@example.com", "password": PASSWORD},
        )
        assert result.status_code == 200
        assert "set-cookie" not in result.headers
        assert result.headers["cache-control"] == "no-store"
        assert (await client.post("/api/auth/login")).status_code == 404
        assert (await client.post("/api/auth/logout")).status_code == 404


async def test_same_account_independent_tokens(app):
    one, two = await authenticated(app), await authenticated(app)
    async with aclosing(one), aclosing(two):
        assert (await one.get("/api/me")).status_code == 200
        assert (await two.get("/api/me")).status_code == 200
        del one.headers["Authorization"]
        assert (await one.get("/api/me")).status_code == 401
        assert (await two.get("/api/me")).status_code == 200
