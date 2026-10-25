"""Deterministic RPC test double; never loaded by the application."""

import json
import sys
import threading
import time
from pathlib import Path

path = Path(sys.argv[1])
path.parent.mkdir(parents=True, exist_ok=True)
messages = json.loads(path.read_text()) if path.exists() else []
lock = threading.Lock()
cancel = threading.Event()
worker = None


def emit(record):
    with lock:
        print(json.dumps(record), flush=True)


def response(command, data=None):
    emit({"id": command["id"], "type": "response", "success": True, "data": data or {}})


def message(record):
    messages.append(record)
    emit({"type": "message_start", "message": record})
    emit({"type": "message_end", "message": record})
    path.write_text(json.dumps(messages))


def generate(text):
    message({"role": "user", "content": text, "timestamp": time.time_ns()})
    timestamp = time.time_ns()
    emit(
        {
            "type": "message_start",
            "message": {"role": "assistant", "content": [], "timestamp": timestamp},
        }
    )
    output = ""
    for part in ["这是", "流式", "回复。"] * (100 if text == "slow" else 1):
        if cancel.wait(0.15):
            break
        output += part
        emit(
            {
                "type": "message_update",
                "assistantMessageEvent": {
                    "type": "text_delta",
                    "contentIndex": 0,
                    "delta": part,
                },
            }
        )
    final = {
        "role": "assistant",
        "content": [{"type": "text", "text": output}],
        "timestamp": timestamp,
        "stopReason": "aborted" if cancel.is_set() else "stop",
    }
    messages.append(final)
    path.write_text(json.dumps(messages))
    emit({"type": "message_end", "message": final})
    emit({"type": "agent_end"})
    time.sleep(0.05)  # agent_end deliberately precedes stable idle
    emit({"type": "agent_settled", "aborted": cancel.is_set()})


for line in sys.stdin:
    command = json.loads(line)
    kind = command["type"]
    if kind == "get_messages":
        response(command, {"messages": messages})
    elif kind == "prompt":
        if command["message"] == "crash":
            sys.exit(17)
        if command["message"] == "handled":
            response(command, {"disposition": "handled"})
            continue
        cancel.clear()
        response(command, {"disposition": "started"})
        worker = threading.Thread(
            target=generate, args=(command["message"],), daemon=True
        )
        worker.start()
    elif kind == "clear_queue":
        response(command)
    elif kind == "abort":
        cancel.set()
        if worker:
            worker.join(2)
        response(command)
