from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[4]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="ORCHMESH_", env_file=ROOT / ".env", extra="ignore"
    )
    data_dir: Path = ROOT / ".data"
    cookie_secure: bool = False
    pi_image: str = "orchmesh-pi:1.4.0"
    max_active_runs: int = 4
    run_timeout: int = 1800
    web_dir: Path = ROOT / "apps/web/dist"

    @property
    def database_url(self) -> str:
        return f"sqlite+aiosqlite:///{self.data_dir}/platform.sqlite3"

    def secret(self) -> str:
        # Generated once locally; never ship a default session/CSRF secret.
        self.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        path = self.data_dir / "csrf-secret"
        try:
            with path.open("x") as stream:
                path.chmod(0o600)
                import secrets

                stream.write(secrets.token_urlsafe(48))
        except FileExistsError:
            pass
        return path.read_text()
