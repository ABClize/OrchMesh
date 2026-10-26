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
        for name in ("work", "config", "dsh"):
            (root / name).mkdir(parents=True, exist_ok=True, mode=0o700)
        return root

    @staticmethod
    def name(user_id: uuid.UUID) -> str:
        return f"orchmesh-user-{user_id}"

    def prepare_workspaces(self, user_id):
        """Keep historical container paths stable without moving user files."""
        root = self.prepare(user_id)
        projects, aliases = root / "projects", root / "workspace-mounts"
        projects.mkdir(exist_ok=True, mode=0o700)
        aliases.mkdir(exist_ok=True, mode=0o700)
        targets = {"default": "/workspace"}
        for project in projects.iterdir():
            if project.is_symlink() or not project.is_dir():
                continue
            try:
                uuid.UUID(project.name)
            except ValueError:
                continue
            work = project / "work"
            if work.is_dir() and not work.is_symlink():
                targets[project.name] = f"/project-workspaces/{project.name}/work"
        for name, target in targets.items():
            link = aliases / name
            if link.is_symlink() and os.readlink(link) == target:
                continue
            if link.exists() or link.is_symlink():
                raise RuntimeError("Unexpected workspace mapping")
            link.symlink_to(target)
        return root

    def command(
        self,
        user_id: uuid.UUID,
        conversation_id: str | None = None,
        project_id: uuid.UUID | None = None,
        *,
        control: bool = False,
    ) -> list[str]:
        # A user owns one Host, independent of the selected conversation/project.
        # Keep optional arguments for direct SDK test callers; they do not scope mounts.
        root = self.prepare_workspaces(user_id)
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
        ]
        for source, target, readonly in [
            (root / "work", "/workspace", False),
            (root / "projects", "/project-workspaces", False),
            (root / "workspace-mounts", "/workspaces", True),
            (root / "config", "/state/config", True),
            (root / "dsh", "/state/dsh", False),
        ]:
            command.extend(
                [
                    "--mount",
                    f"type=bind,src={source},dst={target}"
                    + (",readonly" if readonly else ""),
                ]
            )
        return [*command, "--workdir", "/workspaces/default", self.settings.dsh_image]

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
