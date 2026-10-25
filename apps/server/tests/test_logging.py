import logging
import os
import time
from logging.handlers import TimedRotatingFileHandler

from orchmesh.config import Settings
from orchmesh.logging import application_logging, failure, logger


def test_daily_rotation_retention_restart_and_private_diagnostics(tmp_path):
    settings = Settings(_env_file=None, data_dir=tmp_path, log_retention_days=2)
    directory = tmp_path / "logs"
    with application_logging(settings):
        handler = next(
            h for h in logger.handlers if isinstance(h, TimedRotatingFileHandler)
        )
        assert handler.when == "MIDNIGHT"
        assert not handler.utc
        for day in ("2000-01-01", "2000-01-02", "2000-01-03"):
            (directory / f"orchmesh.log.{day}").write_text("old\n")
        logger.info("before-midnight")
        handler.rolloverAt = int(time.time()) - 1
        logger.info("after-midnight")
        try:
            raise RuntimeError("api_key=do-not-log secret prompt")
        except RuntimeError as exc:
            failure("run.failure", exc, run_id="test-run", stage="generation")
    archives = list(directory.glob("orchmesh.log.*"))
    assert len(archives) == 2
    assert "before-midnight" in "".join(p.read_text() for p in archives)
    with application_logging(settings):
        logger.info("after-restart")
    content = (directory / "orchmesh.log").read_text()
    assert all(
        x in content
        for x in (
            "after-midnight",
            "after-restart",
            "RuntimeError",
            "test-run",
            "generation",
        )
    )
    assert "do-not-log" not in content
    assert "secret prompt" not in content
    assert os.stat(directory).st_mode & 0o777 == 0o700
    assert not any(isinstance(h, TimedRotatingFileHandler) for h in logger.handlers)


async def test_http_diagnostics_exclude_query_and_authorization(app):
    import httpx

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/api/health?api_key=hidden-value",
            headers={"Authorization": "Bearer hidden-token"},
        )
    assert len(response.headers["x-request-id"]) == 32
    handler = next(
        h
        for h in logging.getLogger("orchmesh").handlers
        if isinstance(h, TimedRotatingFileHandler)
    )
    content = open(handler.baseFilename).read()
    assert "route=/api/health status=200" in content
    assert "hidden-value" not in content
    assert "hidden-token" not in content
