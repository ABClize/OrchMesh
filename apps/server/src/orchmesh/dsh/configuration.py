"""Validate model routes; keys remain server-side, DSH owns provider execution."""

from urllib.parse import urlsplit

from ..config import Settings


def validate_model(settings: Settings) -> None:
    profiles = settings.model_profiles()
    if not profiles:
        if settings.model_base_url or settings.model_api_key.get_secret_value():
            raise ValueError("Model requires BASE_URL, API_KEY and ID together")
        return
    if len({p.key for p in profiles}) != len(profiles):
        raise ValueError("Model keys must be unique")
    settings.resolve_model()
    for profile in profiles:
        url = urlsplit(profile.base_url)
        if url.scheme not in ("http", "https") or not url.hostname or url.username:
            raise ValueError("Model BASE_URL must be an HTTP(S) endpoint")
        if not profile.api_key.get_secret_value():
            raise ValueError("Model API_KEY is required")
        if set(profile.reasoning_efforts or {}) - {
            "off",
            "minimal",
            "low",
            "medium",
            "high",
            "xhigh",
            "max",
        }:
            raise ValueError("Unsupported reasoning effort")
