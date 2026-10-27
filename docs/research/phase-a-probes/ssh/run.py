"""Isolated official DSH SSH probes; never reads the application's .env/data."""
import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

source = Path(__file__).resolve().parent
root = Path(tempfile.mkdtemp(prefix="orchmesh-phase-a-ssh-"))
identity = uuid.uuid4().hex[:10]
name = f"orchmesh-phase-a-ssh-{identity}"
image = f"orchmesh-phase-a-ssh:{identity}"
env = {
    **os.environ,
    "PROBE_CONTAINER": name,
    "PROBE_LABEL": f"orchmesh.phase-a=ssh-{identity}",
    "PROBE_IMAGE": image,
    "PROBE_ALIGN_RG": "1",
    "PATH": f"{root}/bin:{os.environ['PATH']}",
}

def command(*args, timeout=120):
    completed = subprocess.run(args, cwd=root, env=env, text=True,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               timeout=timeout, check=False)
    with (root / "runner.log").open("a") as log:
        log.write(f"COMMAND: {args[0]}\n{completed.stdout}\n")
    if completed.returncode:
        raise RuntimeError(f"Probe command failed ({completed.returncode}); see {root}/runner.log")
    return completed.stdout

for file in source.iterdir():
    if file.suffix in {".mjs", ".py", ".json"} and file.name != "run.py":
        shutil.copy2(file, root / file.name)
shutil.copytree(source / "image", root / "image")
for directory in ("bin", "keys", "artifacts"):
    (root / directory).mkdir()
(root / "bin/ssh").write_text(f'#!/bin/sh\nexec /usr/bin/ssh -F {shlex.quote(str(root / "ssh_config"))} "$@"\n')
(root / "bin/ssh").chmod(0o755)
print(f"Evidence directory: {root}", flush=True)
try:
    command("npm", "ci", "--ignore-scripts", timeout=300)
    command("docker", "build", "-t", image, str(root / "image"), timeout=300)
    command("ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(root / "keys/id_ed25519"))
    (root / "keys/id_ed25519.pub").chmod(0o644)
    command("node", "session.mjs", "plain")
    assert not command("docker", "ps", "-a", "--filter", f"name=^{name}$", "--format", "{{.Names}}").strip()
    command(sys.executable, "lifecycle.py")
    # Start and stop only this run's container around provider and official-tool checks.
    command(sys.executable, "-c", "from lifecycle import start; start()")
    try:
        command("node", "probe.mjs")
        command("node", "native-tools.mjs", "native-aligned")
        state = json.loads((root / "session-native-aligned.json").read_text())
        results = [m for m in state["messages"] if m.get("role") == "tool"][-4:]
        assert len(results) == 4 and all(not m.get("isError") for m in results)
    finally:
        command("docker", "rm", "-f", name)
    command(sys.executable, "loss.py")
    command(sys.executable, "question.py")
    command(sys.executable, "preset.py")
    print(json.dumps({"passed": True, "evidence": str(root), "scenarios": [
        "ordinary-no-container", "same-session-remote", "container-recreation",
        "provider-file-guards", "remote-ptc", "native-write-bash-read-grep",
        "process-cancellation", "transport-loss-unknown", "timed-question-SIGKILL", "immutable-preset-SIGKILL"]}))
finally:
    # Never broad-prune Docker; remove exactly this run's generated name/image.
    subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(["docker", "image", "rm", image], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    # Session/artifact evidence remains; temporary client private key is unnecessary afterward.
    (root / "keys/id_ed25519").unlink(missing_ok=True)
