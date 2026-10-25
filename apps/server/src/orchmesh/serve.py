"""Small foreground launcher; official CLIs own migration and reload behavior."""

import os
import signal
import subprocess
import sys
import time

from .config import ROOT, Settings


def serve(dev: bool = False) -> None:
    settings = Settings()
    if dev and settings.port == settings.web_port:
        raise SystemExit("ORCHMESH_PORT and ORCHMESH_WEB_PORT must differ")
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=ROOT / "apps/server",
        check=True,
    )
    api = [
        str(ROOT / "apps/server/.venv/bin/fastapi"),
        "dev" if dev else "run",
        "--host",
        settings.host,
        "--port",
        str(settings.port),
    ]
    if not dev:
        os.chdir(ROOT / "apps/server")
        os.execv(api[0], api)
    commands = [(api, ROOT / "apps/server"), (["npm", "run", "dev"], ROOT / "apps/web")]
    processes: list[subprocess.Popen] = []

    def stop(signum, frame):
        raise KeyboardInterrupt

    previous = {
        sig: signal.signal(sig, stop) for sig in (signal.SIGINT, signal.SIGTERM)
    }
    try:
        for command, cwd in commands:
            processes.append(subprocess.Popen(command, cwd=cwd, start_new_session=True))
        while all(process.poll() is None for process in processes):
            time.sleep(0.2)
        raise SystemExit(
            next(p.returncode or 1 for p in processes if p.poll() is not None)
        )
    except KeyboardInterrupt:
        pass
    finally:
        for sig in previous:
            signal.signal(sig, signal.SIG_IGN)
        for process in processes:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        deadline = time.monotonic() + 15
        for process in processes:
            try:
                process.wait(timeout=max(0.1, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
        for sig, handler in previous.items():
            signal.signal(sig, handler)
