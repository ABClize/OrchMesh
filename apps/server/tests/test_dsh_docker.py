"""Real pinned DSH, Docker and tools against a deterministic model endpoint."""

import asyncio
import json
import os
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from orchmesh.config import Settings
from orchmesh.dsh.configuration import sync_model
from orchmesh.dsh.containers import Containers
from orchmesh.dsh.events import history
from orchmesh.dsh.rpc import RPC

pytestmark = pytest.mark.skipif(
    os.getenv("ORCHMESH_TEST_DOCKER") != "1", reason="Set ORCHMESH_TEST_DOCKER=1"
)


class Model(BaseHTTPRequestHandler):
    mode = "tools"
    calls = 0
    tool_names = []
    requests = []

    def log_message(self, *args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        type(self).requests.append(body)
        type(self).calls += 1
        type(self).tool_names = [x["function"]["name"] for x in body.get("tools", [])]
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()

        def chunk(delta, finish=None):
            value = {
                "id": "test",
                "object": "chat.completion.chunk",
                "created": 1,
                "model": "fixture",
                "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
            }
            self.wfile.write(("data: " + json.dumps(value) + "\n\n").encode())
            self.wfile.flush()

        try:
            chunk({"role": "assistant"})
            if self.mode == "tools" and self.calls == 1:
                chunk(
                    {
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": "test_bash",
                                "type": "function",
                                "function": {
                                    "name": "bash",
                                    "arguments": json.dumps(
                                        {
                                            "description": "Verify workspace isolation",
                                            "command": (
                                                "printf 'DSH proof' > proof.txt; "
                                                "cat proof.txt; "
                                                "test ! -e /var/run/docker.sock && "
                                                "test ! -e /project/OrchMesh && "
                                                "echo ISOLATED"
                                            ),
                                        }
                                    ),
                                },
                            }
                        ]
                    }
                )
                chunk({}, "tool_calls")
            elif self.mode == "tools" and self.calls == 2:
                chunk(
                    {
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": "deliver",
                                "type": "function",
                                "function": {
                                    "name": "present",
                                    "arguments": json.dumps(
                                        {"files": [{"path": "proof.txt"}]}
                                    ),
                                },
                            }
                        ]
                    }
                )
                chunk({}, "tool_calls")
            else:
                for token in ["DSH ", "stream ", "works."] * (
                    100 if self.mode == "slow" else 1
                ):
                    chunk({"content": token})
                    time.sleep(0.05)
                chunk({}, "stop")
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass


async def test_dsh_tools_stream_stop_and_restore(tmp_path):
    gateway = subprocess.check_output(
        [
            "docker",
            "network",
            "inspect",
            "bridge",
            "--format",
            "{{(index .IPAM.Config 0).Gateway}}",
        ],
        text=True,
    ).strip()
    model = ThreadingHTTPServer((gateway, 0), Model)
    threading.Thread(target=model.serve_forever, daemon=True).start()
    Model.calls, Model.mode = 0, "tools"
    Model.requests = []
    settings = Settings(
        _env_file=None,
        data_dir=tmp_path,
        model_base_url=f"http://{gateway}:{model.server_port}/v1",
        model_api_key="test-only",
        model_id="fixture",
        model_reasoning_efforts={"off": None, "high": "high"},
        model_thinking_format="deepseek",
    )
    containers = Containers(settings)
    uid, cid = uuid.uuid4(), uuid.uuid4()
    sync_model(settings, uid)
    records = []
    rpc = RPC(containers.command(uid, cid), records.append)
    try:
        await rpc.start()
        await rpc.call("initialize", reasoningEffort="off")
        capabilities = await rpc.call("orchmesh/model")
        assert {e["id"] for e in capabilities["efforts"]} == {"off", "high"}
        await rpc.call("orchmesh/open", sessionId=str(cid))
        await rpc.call(
            "session/prompt",
            sessionId=str(cid),
            contentBlocks=[
                {"type": "text", "text": "Use bash to write and read proof.txt."}
            ],
        )
        await rpc.call("session/wait", sessionId=str(cid), timeout=45)
        assert "bash" in Model.tool_names, Model.tool_names
        assert "present" in Model.tool_names
        assert "present_files" not in Model.tool_names
        assert Model.requests[0]["thinking"] == {"type": "disabled"}
        assert (containers.user_dir(uid) / "work/proof.txt").read_text() == "DSH proof"
        result = await rpc.call("orchmesh/history", sessionId=str(cid))
        messages, reason = history(result["events"])
        assert reason == "completed"
        assert any(
            m.get("role") == "toolResult"
            and "ISOLATED" in json.dumps(m)
            and not m["isError"]
            for m in messages
        )
        assert any(
            r.get("method") == "orchmesh.stream"
            and r["params"]["frame"]["type"] == "chunk"
            for r in records
        )
        assert any(
            m.get("role") == "toolResult"
            and "dsh.deliverables" in json.dumps(m)
            and not m["isError"]
            for m in messages
        )
        branch = await rpc.call("session/fork", sessionId=str(cid))
        forked = await rpc.call("orchmesh/history", sessionId=branch["sessionId"])
        assert history(forked["events"])[0] == messages
        await rpc.call(
            "session/rename", sessionId=branch["sessionId"], title="Native branch"
        )
        Model.mode = "slow"
        records.clear()
        await rpc.call(
            "session/prompt",
            sessionId=str(cid),
            contentBlocks=[{"type": "text", "text": "Continue."}],
        )
        for _ in range(100):
            if any(
                r.get("method") == "orchmesh.stream"
                and r["params"]["frame"]["type"] == "chunk"
                for r in records
            ):
                break
            await asyncio.sleep(0.05)
        waiting = asyncio.create_task(
            rpc.call("session/wait", sessionId=str(cid), timeout=10)
        )
        await rpc.call("orchmesh/stop", sessionId=str(cid))
        await waiting
        before = await rpc.call("orchmesh/history", sessionId=str(cid))
        assert history(before["events"])[1] == "aborted"
        await rpc.call("shutdown")
        await rpc.close()
        await containers.kill(uid)
        rpc = RPC(containers.command(uid, cid), records.append)
        await rpc.start()
        await rpc.call("initialize", reasoningEffort="high")
        after = await rpc.call("orchmesh/history", sessionId=str(cid))
        assert any(e["type"] == "deliverables/presented" for e in after["events"])
        # Cold browsing must neither activate an Agent nor rewrite session files.
        logs = list((containers.user_dir(uid) / "dsh").rglob("*.jsonl"))
        saved = {str(p): p.read_bytes() for p in logs}
        await rpc.call("orchmesh/history", sessionId=str(cid))
        assert saved == {str(p): p.read_bytes() for p in logs}
        assert history(after["events"])[0] == history(before["events"])[0]
        await rpc.call("session/resume", sessionId=str(cid))
        Model.mode = "normal"
        await rpc.call(
            "session/prompt",
            sessionId=str(cid),
            contentBlocks=[{"type": "text", "text": "High."}],
        )
        await rpc.call("session/wait", sessionId=str(cid), timeout=15)
        assert Model.requests[-1]["thinking"] == {"type": "enabled"}
        assert Model.requests[-1]["reasoning_effort"] == "high"
        await rpc.call("shutdown")
        await rpc.close()
        await containers.kill(uid)
        rpc = RPC(containers.command(uid, cid), records.append)
        await rpc.start()
        await rpc.call("initialize")
        await rpc.call("orchmesh/open", sessionId=str(cid))
        await rpc.call(
            "session/prompt",
            sessionId=str(cid),
            contentBlocks=[{"type": "text", "text": "Default."}],
        )
        await rpc.call("session/wait", sessionId=str(cid), timeout=15)
        assert Model.requests[-1].get("reasoning_effort") is None
    finally:
        await containers.kill(uid)
        await rpc.close()
        model.shutdown()
        model.server_close()


async def test_native_navigation_survives_hosts_and_keeps_workspace_identity(tmp_path):
    settings = Settings(
        _env_file=None,
        data_dir=tmp_path,
        model_base_url="http://127.0.0.1:1/v1",
        model_api_key="test-only",
        model_id="fixture",
    )
    containers = Containers(settings)
    uid, pid, cid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    sync_model(settings, uid)
    root = containers.user_dir(uid) / "projects" / str(pid) / "work"
    root.mkdir(parents=True)
    (root / "kept.txt").write_text("unchanged")

    async def invoke(method, *, execution=False, **params):
        rpc = RPC(
            containers.command(
                uid, cid if execution else None, pid if execution else None
            ),
            lambda _: None,
        )
        try:
            await rpc.start()
            await rpc.call("initialize")
            return await rpc.call(method, **params)
        finally:
            await containers.kill(uid)
            await rpc.close()

    created = await invoke(
        "project/create", path=f"/workspaces/{pid}", title="Native project"
    )
    wid = created["workspace"]["workspaceId"]
    await invoke(
        "session/create",
        execution=True,
        sessionId=str(cid),
        title="Imported title",
        workspaceId=wid,
    )
    await invoke(
        "session/rename", execution=True, sessionId=str(cid), title="Imported title"
    )
    state = await invoke("navigation/update", sessionId=str(cid), pinned=True)
    assert state == {"pinned": True, "archived": False}
    state = await invoke("navigation/update", sessionId=str(cid), archived=True)
    assert state == {"pinned": False, "archived": True}
    await invoke("navigation/update", sessionId=str(cid), archived=False)
    await invoke("project/rename", workspaceId=wid, title="Renamed native")
    nav = await invoke("navigation/list")
    workspace = next(w for w in nav["workspaces"] if w["id"] == wid)
    assert workspace["title"] == "Renamed native"
    assert str(cid) in workspace["sessionIds"]
    assert workspace["path"] == f"/workspaces/{pid}"
    summary = next(s for s in nav["sessions"]["items"] if s["sessionId"] == str(cid))
    assert summary["projections"]["values"]["title"] == "Imported title"
    assert str(cid) not in nav["archived"]
    assert (root / "kept.txt").read_text() == "unchanged"
    with pytest.raises(RuntimeError):
        await invoke("session/prompt", sessionId=str(cid), contentBlocks=[])


async def test_control_navigation_needs_no_model_credentials(tmp_path):
    settings = Settings(_env_file=None, data_dir=tmp_path)
    containers = Containers(settings)
    uid, cid = uuid.uuid4(), uuid.uuid4()
    rpc = RPC(containers.command(uid, cid, control=True), lambda _: None)
    try:
        await rpc.start()
        await rpc.call("initialize")
        await rpc.call("session/create", sessionId=str(cid))
        nav = await rpc.call("navigation/list")
        assert any(s["sessionId"] == str(cid) for s in nav["sessions"]["items"])
        with pytest.raises(RuntimeError):
            await rpc.call("session/prompt", sessionId=str(cid), contentBlocks=[])
    finally:
        await containers.kill(uid)
        await rpc.close()
