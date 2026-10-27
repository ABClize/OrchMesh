"""Validate platform-managed model endpoints without writing user secrets."""

from urllib.parse import urlsplit

from ..config import Settings


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
