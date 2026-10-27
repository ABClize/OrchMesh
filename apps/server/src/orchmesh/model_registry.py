"""Private model configuration; environment is the bootstrap fallback."""

import json
import os
import tempfile
from pathlib import Path

from .config import ModelProfile, Settings


def catalog_path(settings: Settings) -> Path:
    return settings.data_dir / "platform-models.json"


def stored_catalog(settings: Settings) -> tuple[list[ModelProfile], str, str] | None:
    path = catalog_path(settings)
    if not path.exists():
        return None
    data = json.loads(path.read_text())
    return (
        [ModelProfile.model_validate(p) for p in data["models"]],
        data["default"],
        data["revision"],
    )


def write_catalog(
    settings: Settings, models: list[ModelProfile], default: str, revision: str
) -> None:
    # Same-directory replacement makes reads see either complete revision. Only
    # the single API owner writes; its router serializes and checks revisions.
    path = catalog_path(settings)
    data = {
        "default": default,
        "revision": revision,
        "models": [
            {**p.model_dump(mode="json"), "api_key": p.api_key.get_secret_value()}
            for p in models
        ],
    }
    fd, temporary = tempfile.mkstemp(prefix=".models-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(data, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
