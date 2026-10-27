from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[4]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="ORCHMESH_",
        env_file=ROOT / ".env",
        extra="ignore",
        hide_input_in_errors=True,
    )
    data_dir: Path = ROOT / ".data"
    host: str = "127.0.0.1"
    port: int = Field(default=8000, ge=1, le=65535)
    web_port: int = Field(default=5173, ge=1, le=65535)
    bootstrap_admin_email: str = ""
    bootstrap_admin_password: SecretStr = SecretStr("")
    model_base_url: str = ""
    model_api: str = "openai-completions"
    model_api_key: SecretStr = SecretStr("")
    model_id: str = ""
    http_proxy: SecretStr = SecretStr("")
    no_proxy: str = "localhost,127.0.0.1,::1"
    search_api_key: SecretStr = SecretStr("")
    search_base_url: str = "https://api.deepseek.com/anthropic/v1"
    search_model: str = "deepseek-v4-flash"
    model_reasoning_efforts: dict[str, str | None] | None = None
    model_thinking_format: Literal["deepseek"] | None = None
    access_token_expire_minutes: int = Field(default=60, ge=1)
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    log_retention_days: int = Field(default=30, ge=1)
    database_dsn: SecretStr = Field(
        default=SecretStr(""), validation_alias="ORCHMESH_DATABASE_URL"
    )
    db_password: SecretStr = SecretStr("")
    db_port: int = 5433
    dsh_image: str = "orchmesh-sandbox:0.2.1-rc.3"
    runtime_dir: Path = ROOT / "apps/runtime"
    sandbox_idle_seconds: int = Field(default=300, ge=1)
    max_active_runs: int = Field(default=4, ge=1)
    runtime_idle_seconds: int = Field(default=600, ge=1)
    run_timeout: int = 1800
    web_dir: Path = ROOT / "apps/web/dist"

    @property
    def database_url(self) -> str:
        if self.database_dsn.get_secret_value():
            return self.database_dsn.get_secret_value()
        if self.db_password.get_secret_value():
            from urllib.parse import quote

            password = quote(self.db_password.get_secret_value(), safe="")
            return (
                f"postgresql+psycopg://orchmesh:{password}"
                f"@127.0.0.1:{self.db_port}/orchmesh"
            )
        return f"sqlite+aiosqlite:///{self.data_dir}/platform.sqlite3"

    def secret(self) -> str:
        # Generated once locally; never ship a default JWT signing secret.
        self.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        path = self.data_dir / "jwt-secret"
        try:
            with path.open("x") as stream:
                path.chmod(0o600)
                import secrets

                stream.write(secrets.token_urlsafe(48))
        except FileExistsError:
            pass
        return path.read_text()
