"""Manage per-user model settings, retaining the pre-DSH configuration layout."""

import json
import os
import tempfile
import uuid
from pathlib import Path
from urllib.parse import urlsplit

from ..config import Settings
from .containers import Containers

PROVIDER = "project-api"


def validate_model(settings: Settings) -> None:
    values = (
        settings.model_base_url,
        settings.model_api_key.get_secret_value(),
        settings.model_id,
    )
    if not any(values):
        return
    if not all(values):
        raise ValueError(
            "Model requires ORCHMESH_MODEL_BASE_URL, API_KEY and ID together"
        )
    url = urlsplit(settings.model_base_url)
    if url.scheme not in ("http", "https") or not url.hostname or url.username:
        raise ValueError("Model BASE_URL must be an HTTP(S) endpoint")
    if settings.model_api not in (
        "openai-completions",
        "openai-responses",
        "anthropic-messages",
    ):
        raise ValueError("Unsupported model API protocol")


def read_config(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text())
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except (ValueError, UnicodeError):
        raise ValueError(
            f"Invalid model {path.name}; configuration was not replaced"
        ) from None


def write_config(path: Path, content: dict) -> None:
    fd, temporary = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(content, stream, indent=2)
            stream.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def sync_model(settings: Settings, user_id: uuid.UUID) -> None:
    directory = Containers(settings).prepare(user_id) / "config"
    models_path, defaults_path = directory / "models.json", directory / "settings.json"
    models, defaults = read_config(models_path), read_config(defaults_path)
    providers = models.setdefault("providers", {})
    if not isinstance(providers, dict):
        raise ValueError("models.json providers must be an object")
    if settings.model_id:
        providers[PROVIDER] = {
            "baseUrl": settings.model_base_url,
            "api": settings.model_api,
            "apiKey": settings.model_api_key.get_secret_value(),
            "models": [
                {
                    "id": settings.model_id,
                    **(
                        {"reasoningEfforts": settings.model_reasoning_efforts}
                        if settings.model_reasoning_efforts
                        else {}
                    ),
                    **(
                        {"compat": {"thinkingFormat": settings.model_thinking_format}}
                        if settings.model_thinking_format
                        else {}
                    ),
                }
            ],
        }
        defaults.update(defaultProvider=PROVIDER, defaultModel=settings.model_id)
    else:
        # Clearing env must not keep using an old persisted key.
        providers.pop(PROVIDER, None)
        if defaults.get("defaultProvider") == PROVIDER:
            defaults.pop("defaultProvider", None)
            defaults.pop("defaultModel", None)
    if models_path.exists() or settings.model_id:
        write_config(models_path, models)
    if defaults_path.exists() or settings.model_id:
        write_config(defaults_path, defaults)
