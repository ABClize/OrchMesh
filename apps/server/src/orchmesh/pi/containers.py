import asyncio
import os
import uuid
from pathlib import Path

from ..config import Settings


class Containers:
    def __init__(self, settings: Settings):
        self.settings = settings

    def user_dir(self, user_id: uuid.UUID) -> Path:
        return self.settings.data_dir / "users" / str(user_id)

    def prepare(self, user_id: uuid.UUID) -> Path:
        root = self.user_dir(user_id)
        for name in ("work", "config", "sessions"):
            (root / name).mkdir(parents=True, exist_ok=True, mode=0o700)
        return root

    @staticmethod
    def name(user_id: uuid.UUID) -> str:
        return f"orchmesh-user-{user_id}"

    def command(self, user_id: uuid.UUID, conversation_id: uuid.UUID) -> list[str]:
        root = self.prepare(user_id)
        return [
            "docker",
            "run",
            "--rm",
            "--interactive",
            "--init",
            "--name",
            self.name(user_id),
            "--label",
            "dev.orchmesh.managed=true",
            "--user",
            f"{os.getuid()}:{os.getgid()}",
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            "--read-only",
            "--tmpfs",
            "/tmp:rw,nosuid,nodev,size=256m",
            "--memory=1g",
            "--cpus=1",
            "--pids-limit=128",
            "--mount",
            f"type=bind,src={root / 'work'},dst=/workspace",
            "--mount",
            f"type=bind,src={root / 'config'},dst=/state/config",
            "--mount",
            f"type=bind,src={root / 'sessions'},dst=/state/sessions",
            self.settings.pi_image,
            "--mode",
            "rpc",
            "--session",
            f"/state/sessions/{conversation_id}.jsonl",
        ]

    async def kill(self, user_id: uuid.UUID):
        # Kill the whole container, including detached Shell descendants.
        process = await asyncio.create_subprocess_exec(
            "docker",
            "rm",
            "--force",
            self.name(user_id),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            _, stderr = await asyncio.wait_for(process.communicate(), 15)
        except TimeoutError:
            process.kill()
            await process.wait()
            raise
        if process.returncode and b"No such container" not in stderr:
            raise RuntimeError("Could not remove Pi container")
