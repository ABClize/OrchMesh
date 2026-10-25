"""Opt-in real Pi/container integration with a local, deterministic model endpoint."""

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
from orchmesh.pi.configuration import sync_model
from orchmesh.pi.containers import Containers
from orchmesh.pi.rpc import RPC

pytestmark = pytest.mark.skipif(
    os.getenv("ORCHMESH_TEST_DOCKER") != "1", reason="Set ORCHMESH_TEST_DOCKER=1"
)


class Model(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        prompt = next(
            (m["content"] for m in reversed(body["messages"]) if m["role"] == "user"),
            "",
        )
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()

        def chunk(delta, finish=None):
            value = {
                "id": "fixture",
                "object": "chat.completion.chunk",
                "created": 1,
                "model": "fixture",
                "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
            }
            self.wfile.write(("data: " + json.dumps(value) + "\n\n").encode())
            self.wfile.flush()

        try:
            chunk({"role": "assistant"})
            if "tools" in str(prompt) and body["messages"][-1]["role"] != "tool":
                calls = [
                    ("write", {"path": "proof.txt", "content": "Pi wrote this"}),
                    ("read", {"path": "proof.txt"}),
                    (
                        "bash",
                        {
                            "command": (
                                "cat proof.txt && test ! -e /var/run/docker.sock && "
                                "test ! -e /project/OrchMesh"
                            )
                        },
                    ),
                ]
                chunk(
                    {
                        "tool_calls": [
                            {
                                "index": i,
                                "id": f"call_{i}",
                                "type": "function",
                                "function": {
                                    "name": name,
                                    "arguments": json.dumps(args),
                                },
                            }
                            for i, (name, args) in enumerate(calls)
                        ]
                    }
                )
                chunk({}, "tool_calls")
            else:
                for token in ["Pi ", "stream ", "works."] * (
                    100 if "slow" in str(prompt) else 1
                ):
                    chunk({"content": token})
                    time.sleep(0.05)
                chunk({}, "stop")
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass


async def test_real_pi_stream_tools_abort_isolation_and_restore(tmp_path):
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
    server = ThreadingHTTPServer((gateway, 0), Model)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    settings = Settings(
        _env_file=None,
        bootstrap_admin_email="",
        bootstrap_admin_password="",
        model_base_url=f"http://{gateway}:{server.server_port}/v1",
        model_api="openai-completions",
        model_api_key="test-only",
        model_id="fixture",
        data_dir=tmp_path,
    )
    containers = Containers(settings)
    user_id, conversation_id = uuid.uuid4(), uuid.uuid4()
    root = containers.prepare(user_id)
    other = containers.prepare(uuid.uuid4())
    (other / "work/other-secret.txt").write_text("not visible")
    sync_model(settings, user_id)
    records = []
    settled = asyncio.Event()

    def receive(event):
        records.append(event)
        if event.get("type") == "agent_settled":
            settled.set()

    rpc = RPC(containers.command(user_id, conversation_id), receive)
    try:
        await rpc.start()
        response = await rpc.call("prompt", message="use tools")
        assert response["disposition"] == "started"
        await asyncio.wait_for(settled.wait(), 30)
        tools = {e["toolName"] for e in records if e["type"] == "tool_execution_end"}
        assert tools == {"read", "write", "bash"}
        assert (root / "work/proof.txt").read_text() == "Pi wrote this"
        assert any(e["type"] == "message_update" for e in records)
        shell = await rpc.call(
            "bash",
            command=(
                f"test ! -e {other} && test ! -e /var/run/docker.sock && "
                "test ! -e /project/OrchMesh"
            ),
        )
        assert shell["exitCode"] == 0
        settled.clear()
        await rpc.call("prompt", message="slow")
        await asyncio.sleep(0.4)
        await rpc.call("clear_queue")
        await rpc.call("abort")
        await asyncio.wait_for(settled.wait(), 3)
        assert records[-1]["type"] == "agent_settled"
        assert records[-1]["aborted"]
        before = (await rpc.call("get_messages"))["messages"]
        await containers.kill(user_id)
        await rpc.close()
        rpc = RPC(containers.command(user_id, conversation_id), receive)
        await rpc.start()
        restored = (await rpc.call("get_messages"))["messages"]
        assert restored == before
    finally:
        await containers.kill(user_id)
        await rpc.close()
        server.shutdown()
        server.server_close()
