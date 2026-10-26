"""Deterministic SDK-wire peer; used only by platform lifecycle tests."""

import json
import sys
import threading
import time
import uuid
from pathlib import Path

path = Path(sys.argv[1])
path.parent.mkdir(parents=True, exist_ok=True)
events = json.loads(path.read_text()) if path.exists() else []
lock = threading.Lock()
cancel = threading.Event()
worker = None
session_id = None
navigation_path = path.parent / "navigation.json"


def navigation():
    return (
        json.loads(navigation_path.read_text())
        if navigation_path.exists()
        else {
            "workspaces": [],
            "pinned": [],
            "archived": [],
            "sessions": {"items": []},
        }
    )


def save_navigation(value):
    navigation_path.write_text(json.dumps(value))


def emit(record):
    with lock:
        print(json.dumps(record), flush=True)


def response(command, data=None):
    emit({"jsonrpc": "2.0", "id": command["id"], "result": data or {}})


def notify(method, data):
    emit(
        {
            "jsonrpc": "2.0",
            "method": method,
            "params": {"sessionId": session_id, **data},
        }
    )


def event(kind, data):
    record = {
        "type": kind,
        "data": data,
        "seq": len(events),
        "time": time.time_ns() // 1000000,
    }
    events.append(record)
    path.write_text(json.dumps(events))
    notify("session.event", {"event": record})


def generate(text):
    event(
        "user/message",
        {
            "role": "user",
            "source": {"kind": "user"},
            "content": [{"type": "text", "text": text}],
        },
    )
    notify("orchmesh.stream", {"frame": {"type": "start"}})
    output = ""
    for token in ["这是", "流式", "回复。"] * (
        100 if text in {"slow", "abort-as-error"} else 1
    ):
        if cancel.wait(0.15):
            break
        output += token
        notify(
            "orchmesh.stream",
            {
                "frame": {
                    "type": "chunk",
                    "chunk": {"type": "text-delta", "index": 0, "text": token},
                }
            },
        )
    event(
        "assistant/message",
        {
            "message": {
                "role": "assistant",
                "content": [{"type": "text", "text": output}],
            },
            "interrupted": cancel.is_set(),
        },
    )
    reason = (
        "error"
        if text == "model-error" or (text == "abort-as-error" and cancel.is_set())
        else "aborted"
        if cancel.is_set()
        else "completed"
    )
    event("turn/end", {"reason": {"kind": reason}})
    time.sleep(0.05)
    notify("session.status", {"status": "idle"})


for line in sys.stdin:
    command = json.loads(line)
    kind, params = command["method"], command.get("params", {})
    if kind == "initialize":
        response(command)
    elif kind == "navigation/list":
        response(command, navigation())
    elif kind in ("project/create", "project/rename"):
        nav = navigation()
        if kind == "project/create":
            workspace = next(
                (w for w in nav["workspaces"] if w["path"] == params["path"]), None
            )
            if workspace is None:
                workspace = {
                    "id": str(uuid.uuid4()),
                    "path": params["path"],
                    "sessionIds": [],
                }
                nav["workspaces"].append(workspace)
        else:
            workspace = next(
                w for w in nav["workspaces"] if w["id"] == params["workspaceId"]
            )
        workspace["title"] = params["title"]
        save_navigation(nav)
        response(command, {"workspace": {**workspace, "workspaceId": workspace["id"]}})
    elif kind == "session/create":
        nav = navigation()
        sid = params.get("sessionId", "native-" + uuid.uuid4().hex)
        nav["sessions"]["items"].append(
            {
                "sessionId": sid,
                "projections": {"values": {"title": params.get("title", "新对话")}},
            }
        )
        if params.get("workspaceId"):
            next(w for w in nav["workspaces"] if w["id"] == params["workspaceId"])[
                "sessionIds"
            ].append(sid)
        if params.get("archived"):
            nav["archived"].append(sid)
        elif params.get("pinned"):
            nav["pinned"].append(sid)
        save_navigation(nav)
        response(command, {"sessionId": sid})
    elif kind == "project/delete":
        nav = navigation()
        nav["workspaces"] = [
            w for w in nav["workspaces"] if w["id"] != params["workspaceId"]
        ]
        save_navigation(nav)
        response(command, {"deleted": True})
    elif kind == "session/rename":
        nav = navigation()
        item = next(
            s for s in nav["sessions"]["items"] if s["sessionId"] == params["sessionId"]
        )
        item["projections"]["values"]["title"] = params["title"]
        save_navigation(nav)
        response(command, {"title": params["title"]})
    elif kind == "session/fork":
        nav = navigation()
        sid = "native-fork-" + uuid.uuid4().hex
        source = next(
            s for s in nav["sessions"]["items"] if s["sessionId"] == params["sessionId"]
        )
        nav["sessions"]["items"].append({**source, "sessionId": sid})
        for w in nav["workspaces"]:
            if params["sessionId"] in w["sessionIds"]:
                w["sessionIds"].append(sid)
        (path.parent / f"{sid}.jsonl").write_text(json.dumps(events))
        save_navigation(nav)
        response(command, {"sessionId": sid})
    elif kind == "navigation/update":
        nav = navigation()
        sid = params["sessionId"]
        for key in ("archived", "pinned"):
            if key in params:
                nav[key] = [item for item in nav[key] if item != sid]
                if params[key]:
                    nav[key].append(sid)
        if sid in nav["archived"]:
            nav["pinned"] = [item for item in nav["pinned"] if item != sid]
        save_navigation(nav)
        response(command, {key: sid in nav[key] for key in ("pinned", "archived")})
    elif kind in ("orchmesh/open", "orchmesh/history"):
        session_id = params["sessionId"]
        response(
            command,
            {"events": events, "archived": session_id in navigation()["archived"]},
        )
    elif kind == "session/prompt":
        text = params["contentBlocks"][0]["text"]
        if text == "crash":
            sys.exit(17)
        cancel.clear()
        if text != "handled":
            worker = threading.Thread(target=generate, args=(text,), daemon=True)
            worker.start()
        response(command, {"messageId": "test"})
    elif kind == "session/wait":

        def wait(cmd=command):
            if worker:
                worker.join()
            response(cmd)

        threading.Thread(target=wait, daemon=True).start()
    elif kind == "orchmesh/stop":
        cancel.set()
        response(command)
