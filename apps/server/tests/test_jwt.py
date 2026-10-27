import uuid
from contextlib import aclosing

import jwt
import pytest
from conftest import authenticated


@pytest.mark.parametrize(
    "claims,algorithm,secret",
    [
        ({"sub": str(uuid.uuid4()), "exp": 1}, "HS256", None),
        ({"sub": "not-a-uuid", "exp": 9999999999}, "HS256", None),
        ({"sub": str(uuid.uuid4())}, "HS256", None),
        ({"sub": str(uuid.uuid4()), "exp": 9999999999}, "HS384", None),
        (
            {"sub": str(uuid.uuid4()), "exp": 9999999999},
            "HS256",
            "wrong-secret-which-is-at-least-32-bytes",
        ),
    ],
)
async def test_invalid_tokens_rejected_for_api_and_stream(
    app, claims, algorithm, secret
):
    client = await authenticated(app)
    async with aclosing(client):
        cid = (await client.post("/api/conversations")).json()["id"]
        token = jwt.encode(claims, secret or app.state.auth.secret, algorithm=algorithm)
        client.headers["Authorization"] = f"Bearer {token}"
        assert (await client.get("/api/me")).status_code == 401
        assert (await client.get(f"/api/conversations/{cid}/events")).status_code == 401
