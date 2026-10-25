"""Application diagnostics: allowlisted fields, standard daily file rotation."""

import logging
import traceback
from contextlib import contextmanager
from logging.handlers import TimedRotatingFileHandler

from .config import Settings

logger = logging.getLogger("orchmesh")


def failure(event: str, exc: BaseException, **fields: object) -> None:
    # Exception text, source lines and locals can contain model keys or prompts.
    frames = traceback.extract_tb(exc.__traceback__)
    locations = ";".join(f"{f.name}:{f.lineno}" for f in frames)
    logger.error(
        "%s exception=%s frames=%s %s",
        event,
        type(exc).__name__,
        locations,
        " ".join(f"{key}={value}" for key, value in fields.items()),
    )


@contextmanager
def application_logging(settings: Settings):
    directory = settings.data_dir / "logs"
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    handler = TimedRotatingFileHandler(
        directory / "orchmesh.log",
        when="midnight",
        backupCount=settings.log_retention_days,
        encoding="utf-8",
    )
    formatter = logging.Formatter(
        "%(asctime)s %(levelname)s %(name)s %(message)s", "%Y-%m-%dT%H:%M:%S%z"
    )
    handler.setFormatter(formatter)
    console = logging.StreamHandler()
    console.setFormatter(formatter)
    old_level, old_propagate = logger.level, logger.propagate
    logger.setLevel(settings.log_level)
    logger.propagate = False
    logger.addHandler(handler)
    logger.addHandler(console)
    try:
        logger.info("service.start")
        yield
    finally:
        logger.info("service.stop")
        for target in (handler, console):
            logger.removeHandler(target)
            target.close()
        logger.setLevel(old_level)
        logger.propagate = old_propagate
