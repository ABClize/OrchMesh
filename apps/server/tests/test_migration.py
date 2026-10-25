"""Exercise a pre-JWT database with real legacy UUID and password formats."""

import os
import sqlite3
import subprocess
import uuid

import httpx
from conftest import FakeContainers

from orchmesh.config import ROOT, Settings
from orchmesh.main import create_app
from orchmesh.security import password_hash


async def test_legacy_database_migrates_without_account_or_history_loss(tmp_path):
    env = os.environ | {"ORCHMESH_DATA_DIR": str(tmp_path)}
    command = [str(ROOT / "apps/server/.venv/bin/alembic"), "upgrade"]
    subprocess.run(
        command + ["39a33d9348dd"],
        cwd=ROOT / "apps/server",
        env=env,
        check=True,
        capture_output=True,
    )
    uid, cid, rid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    hashed = password_hash.hash("legacy-password-123")
    db = sqlite3.connect(tmp_path / "platform.sqlite3")
    db.execute(
        "INSERT INTO user VALUES (?, ?, ?, 1, 0, 0)",
        (str(uid), "legacy@example.com", hashed),
    )
    db.execute(
        "INSERT INTO conversation VALUES (?, ?, ?, ?)",
        (cid.hex, str(uid), "kept title", "2026-10-26"),
    )
    db.execute(
        "INSERT INTO run VALUES (?, ?, ?, ?)",
        (rid.hex, cid.hex, "completed", "2026-10-26"),
    )
    db.execute(
        "INSERT INTO accesstoken VALUES (?, ?, ?)",
        (str(uid), "old-cookie-token", "2026-10-26"),
    )
    db.commit()
    session_file = tmp_path / "users" / str(uid) / "sessions" / f"{cid}.jsonl"
    session_file.parent.mkdir(parents=True)
    session_file.write_text("original Pi history\n")
    subprocess.run(
        command + ["head"],
        cwd=ROOT / "apps/server",
        env=env,
        check=True,
        capture_output=True,
    )
    assert db.execute("SELECT id,hashed_password FROM user").fetchone() == (
        uid.hex,
        hashed,
    )
    assert db.execute("SELECT user_id,title FROM conversation").fetchone() == (
        uid.hex,
        "kept title",
    )
    assert db.execute("SELECT id FROM run").fetchone()[0] == rid.hex
    assert not db.execute("PRAGMA foreign_key_check").fetchall()
    assert not db.execute(
        "SELECT name FROM sqlite_master WHERE name='accesstoken'"
    ).fetchall()
    assert session_file.read_text() == "original Pi history\n"
    db.close()
    settings = Settings(
        _env_file=None,
        data_dir=tmp_path,
        bootstrap_admin_email="",
        bootstrap_admin_password="",
        model_base_url="",
        model_api_key="",
        model_id="",
    )
    app = create_app(settings, FakeContainers(settings))
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client,
    ):
        result = await client.post(
            "/api/login/access-token",
            data={"username": "legacy@example.com", "password": "legacy-password-123"},
        )
        assert result.status_code == 200
        client.headers["Authorization"] = "Bearer " + result.json()["access_token"]
        assert (await client.get("/api/me")).json()["id"] == str(uid)
        assert (await client.get("/api/conversations")).json()[0]["id"] == str(cid)
