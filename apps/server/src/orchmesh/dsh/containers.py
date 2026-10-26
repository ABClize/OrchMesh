import asyncio
import os
import uuid
from pathlib import Path

from ..config import Settings
from ..projects import workspace_path


class Containers:
    def __init__(self, settings: Settings):
        self.settings = settings

    def user_dir(self, user_id: uuid.UUID) -> Path:
        return self.settings.data_dir / "users" / str(user_id)

    def prepare(self, user_id: uuid.UUID) -> Path:
        root = self.user_dir(user_id)
        for name in ("work", "config", "dsh"):
            (root / name).mkdir(parents=True, exist_ok=True, mode=0o700)
        return root

    @staticmethod
    def name(user_id: uuid.UUID) -> str:
        return f"orchmesh-user-{user_id}"

    def command(
        self,
        user_id: uuid.UUID,
        conversation_id: str | None,
        project_id: uuid.UUID | None = None,
        *,
        control: bool = False,
    ) -> list[str]:
        control = control or conversation_id is None
        root = self.prepare(user_id)
        work = workspace_path(self.settings, user_id, project_id)
        work.mkdir(parents=True, exist_ok=True, mode=0o700)
        command = [
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
            f"type=bind,src={work},dst=/workspace" + (",readonly" if control else ""),
            "--mount",
            f"type=bind,src={root / 'config'},dst=/state/config",
            "--mount",
            f"type=bind,src={root / 'dsh'},dst=/state/dsh",
        ]
        if conversation_id is None:
            # Control-only host: read-only filesystem views, never accepts prompts.
            mounts = [(root / "work", "default")]
            projects = root / "projects"
            if projects.exists():
                mounts.extend(
                    (p / "work", p.name)
                    for p in projects.iterdir()
                    if not p.is_symlink()
                    and p.is_dir()
                    and not (p / "work").is_symlink()
                    and (p / "work").is_dir()
                )
            for path, key in mounts:
                command.extend(
                    ["--mount", f"type=bind,src={path},dst=/workspaces/{key},readonly"]
                )
        else:
            directory = f"/workspaces/{project_id or 'default'}"
            command.extend(
                [
                    "--mount",
                    f"type=bind,src={work},dst={directory}"
                    + (",readonly" if control else ""),
                    "--workdir",
                    directory,
                ]
            )
        if control:
            command.extend(["--env", "ORCHMESH_CONTROL_ONLY=1"])
        return [*command, self.settings.dsh_image]

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
            raise RuntimeError("Could not remove DSH container")
