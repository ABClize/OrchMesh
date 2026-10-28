"""Task-scoped disposable containers, accessed through official DSH SSH providers."""

import asyncio
import hashlib
import os
import shlex
from pathlib import Path

from ..config import Settings


async def command(*args: str) -> str:
    process = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    output, _ = await process.communicate()
    if process.returncode:
        raise RuntimeError(f"Sandbox command failed: {args[0]}")
    return output.decode().strip()


class Sandboxes:
    def __init__(self, settings: Settings):
        self.settings = settings

    def root(self, task_id: str) -> Path:
        return self.settings.data_dir / "tasks" / task_id

    def name(self, task_id: str) -> str:
        return f"orchmesh-task-{task_id}"

    async def start(self, task_id: str) -> tuple[dict, dict]:
        root = self.root(task_id)
        work = root / "work"
        work.mkdir(parents=True, exist_ok=True)
        # Container node UID is fixed by the official Node base image; app directories
        # outside this task are never mounted, even read-only.
        work.chmod(0o777)
        skills = root / "skills"
        skills.mkdir(exist_ok=True)
        keys = root / "ssh"
        keys.mkdir(exist_ok=True, mode=0o700)
        if not (keys / "identity").exists():
            await command(
                "ssh-keygen",
                "-q",
                "-t",
                "ed25519",
                "-N",
                "",
                "-f",
                str(keys / "identity"),
            )
        name = self.name(task_id)
        modules = self.settings.runtime_dir / "node_modules"
        found = await command(
            "docker", "ps", "-a", "--filter", f"name=^{name}$", "--format", "{{.Names}}"
        )
        if not found:
            args = [
                "docker",
                "run",
                "-d",
                "--name",
                name,
                "--label",
                "orchmesh.task=true",
                "--publish",
                "127.0.0.1::22",
                "--pids-limit",
                "256",
                "--memory",
                "1g",
                "--mount",
                f"type=bind,src={work},dst=/workspace",
                "--mount",
                f"type=bind,src={skills},dst=/skills,readonly",
                "--mount",
                f"type=bind,src={modules},dst=/opt/orchmesh/node_modules,readonly",
                "--mount",
                f"type=bind,src={keys / 'identity.pub'},"
                "dst=/home/node/.ssh/authorized_keys,readonly",
                "--tmpfs",
                "/tmp:rw,nosuid,nodev",
            ]
            for rg in modules.glob("@vscode/ripgrep-*/bin/rg"):
                args += ["--mount", f"type=bind,src={rg},dst={rg},readonly"]
            await command(*args, self.settings.dsh_image)
        else:
            await command("docker", "start", name)
        port = (await command("docker", "port", name, "22")).split(":")[-1]
        # Obtain the host key from the trusted local container, not an
        # unauthenticated scan.
        public = await command(
            "docker", "exec", name, "cat", "/etc/ssh/ssh_host_ed25519_key.pub"
        )
        (keys / "known_hosts").write_text(f"[127.0.0.1]:{port} {public}\n")
        configuration = keys / "config"
        configuration.write_text(
            f"Host task\n HostName 127.0.0.1\n Port {port}\n User node\n"
            f" IdentityFile {keys / 'identity'}\n IdentitiesOnly yes\n"
            f" UserKnownHostsFile {keys / 'known_hosts'}\n"
            " StrictHostKeyChecking yes\n ConnectTimeout 10\n"
        )
        binary = keys / "bin"
        binary.mkdir(exist_ok=True)
        wrapper = binary / "ssh"
        wrapper.write_text(
            f'#!/bin/sh\nexec /usr/bin/ssh -F {shlex.quote(str(configuration))} "$@"\n'
        )
        wrapper.chmod(0o700)
        for attempt in range(30):
            try:
                await command(str(wrapper), "task", "true")
                break
            except RuntimeError:
                if attempt == 29:
                    raise
                await asyncio.sleep(0.1)
        helper = modules / "@deepseek-ai/dsh-ssh/lib/helper.js"
        return (
            {
                "helper": (
                    "/opt/orchmesh/node_modules/@deepseek-ai/dsh-ssh/lib/helper.js"
                ),
                "hash": hashlib.sha256(helper.read_bytes()).hexdigest(),
            },
            {"PATH": str(binary) + os.pathsep + os.environ["PATH"]},
        )

    async def release(self, task_id: str) -> None:
        name = self.name(task_id)
        found = await command(
            "docker", "ps", "-a", "--filter", f"name=^{name}$", "--format", "{{.Names}}"
        )
        if found:
            await command("docker", "rm", "-f", name)
