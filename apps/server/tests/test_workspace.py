import os
import uuid
from contextlib import aclosing

import httpx
import pytest
from conftest import authenticated

from orchmesh.workspace import MAX_FILE, open_path


async def test_files_auth_download_range_and_user_boundary(app):
    one, two = await authenticated(app), await authenticated(app, "two@example.com")
    async with aclosing(one), aclosing(two):
        uid = uuid.UUID((await one.get("/api/me")).json()["id"])
        root = app.state.manager.settings.data_dir / "users" / str(uid) / "work"
        root.mkdir(parents=True, exist_ok=True)
        (root / "报告.txt").write_text("hello world")
        listing = await one.get("/api/workspace/entries")
        assert listing.status_code == 200
        assert listing.json()["entries"][0]["name"] == "报告.txt"
        download = await one.get("/api/workspace/file", params={"path": "报告.txt"})
        assert download.content == b"hello world"
        assert "attachment;" in download.headers["content-disposition"]
        partial = await one.get(
            "/api/workspace/file",
            params={"path": "报告.txt"},
            headers={"Range": "bytes=0-4"},
        )
        assert partial.status_code == 206
        assert partial.content == b"hello"
        assert (
            await two.get("/api/workspace/file", params={"path": "报告.txt"})
        ).status_code == 404
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as anon:
            assert (await anon.get("/api/workspace/entries")).status_code == 401


@pytest.mark.parametrize(
    "path", ["../config/models.json", "/etc/passwd", "a/../../secret", "a\\b", "a\x00b"]
)
async def test_invalid_paths(app, path):
    client = await authenticated(app)
    async with aclosing(client):
        assert (
            await client.get("/api/workspace/file", params={"path": path})
        ).status_code == 400


async def test_links_special_files_and_large_files_are_not_served(app, tmp_path):
    client = await authenticated(app)
    async with aclosing(client):
        uid = uuid.UUID((await client.get("/api/me")).json()["id"])
        root = app.state.manager.settings.data_dir / "users" / str(uid) / "work"
        root.mkdir(parents=True, exist_ok=True)
        secret = tmp_path / "outside"
        secret.write_text("secret")
        (root / "link").symlink_to(secret)
        (root / "folder").symlink_to(tmp_path, target_is_directory=True)
        os.mkfifo(root / "pipe")
        os.link(secret, root / "hardlink")
        for name in ("link", "folder/outside", "pipe", "hardlink"):
            assert (
                await client.get("/api/workspace/file", params={"path": name})
            ).status_code == 404
        with (root / "large").open("wb") as f:
            f.truncate(MAX_FILE + 1)
        assert (
            await client.get("/api/workspace/file", params={"path": "large"})
        ).status_code == 413


def test_open_descriptor_survives_path_replacement(tmp_path):
    root = tmp_path / "work"
    root.mkdir()
    file = root / "file"
    file.write_bytes(b"allowed")
    outside = tmp_path / "secret"
    outside.write_bytes(b"secret")
    fd = open_path(root, "file")
    try:
        file.unlink()
        file.symlink_to(outside)
        assert os.read(fd, 100) == b"allowed"
    finally:
        os.close(fd)
