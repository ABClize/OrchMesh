"""DSH events to the existing chat presentation contract, not model history."""

import json


def part(block: dict) -> dict:
    kind = block.get("type")
    if kind == "reasoning":
        return {"type": "thinking", "thinking": block.get("text", "")}
    if kind == "tool-call":
        try:
            arguments = json.loads(block.get("arguments", "{}"))
        except (ValueError, TypeError):
            arguments = {"raw": block.get("arguments", "")}
        return {
            "type": "toolCall",
            "id": block["id"],
            "name": block["name"],
            "arguments": arguments,
        }
    return block


def message(value: dict, timestamp=0) -> dict | None:
    source = value.get("source", {})
    content = value.get("content", [])
    if source.get("kind") == "tool":
        result = next((b for b in content if b.get("type") == "tool-result"), value)
        return {
            "role": "toolResult",
            "toolCallId": source.get("callId"),
            "content": result.get("content", []),
            "isError": result.get("isError", False),
            "timestamp": timestamp,
        }
    role = value.get("role")
    if role not in ("user", "assistant"):
        return None
    if role == "user" and source.get("kind") not in ("user", "user-rpc"):
        return None
    return {"role": role, "content": [part(b) for b in content], "timestamp": timestamp}


class Adapter:
    def __init__(self):
        self.streaming = False
        self.last_reason: str | None = None
        self.deliveries: dict[str, list[dict]] = {}

    def accept(self, notification: dict) -> list[dict]:
        method, payload = notification.get("method"), notification.get("params", {})
        if method == "orchmesh.stream":
            frame = payload["frame"]
            if frame["type"] == "start":
                # A retry supersedes its uncommitted streaming placeholder.
                events = []
                if self.streaming:
                    events.append(
                        {
                            "type": "message_end",
                            "message": {"role": "assistant", "content": []},
                        }
                    )
                self.streaming = True
                events.append(
                    {
                        "type": "message_start",
                        "message": {"role": "assistant", "content": []},
                    }
                )
                return events
            if frame["type"] == "chunk":
                chunk = frame["chunk"]
                kind, index = chunk["type"], chunk.get("index", 0)
                if kind in ("text-delta", "reasoning-delta"):
                    return [
                        {
                            "type": "message_update",
                            "assistantMessageEvent": {
                                "type": "text_delta"
                                if kind == "text-delta"
                                else "thinking_delta",
                                "contentIndex": index,
                                "delta": chunk["text"],
                            },
                        }
                    ]
                if kind == "block-end" and chunk["block"]["type"] == "tool-call":
                    return [
                        {
                            "type": "message_update",
                            "assistantMessageEvent": {
                                "type": "toolcall_end",
                                "contentIndex": index,
                                "toolCall": part(chunk["block"]),
                            },
                        }
                    ]
            return []
        if method != "session.event":
            return []
        event = payload["event"]
        kind, data = event["type"], event["data"]
        if kind == "deliverables/presented":
            content = [
                {
                    "type": "text",
                    "text": json.dumps(
                        {"kind": "dsh.deliverables", "files": data["files"]}
                    ),
                }
            ]
            self.deliveries[data["callId"]] = content
            return [
                {
                    "type": "tool_execution_end",
                    "toolCallId": data["callId"],
                    "result": {"content": content},
                    "isError": False,
                }
            ]
        if kind == "turn/end":
            self.last_reason = data["reason"]["kind"]
            return []
        if kind in ("user/message", "assistant/message", "tool/result"):
            value = message(data.get("message", data), event.get("time", 0))
            if value is None:
                return []
            if value.get("toolCallId") in self.deliveries:
                value["content"] = self.deliveries[value["toolCallId"]]
            if kind == "assistant/message":
                value["stopReason"] = "aborted" if data.get("interrupted") else "stop"
                events = (
                    []
                    if self.streaming
                    else [{"type": "message_start", "message": value}]
                )
                self.streaming = False
                return [*events, {"type": "message_end", "message": value}]
            return [
                {"type": "message_start", "message": value},
                {"type": "message_end", "message": value},
            ]
        return []


def history(events: list[dict]) -> tuple[list[dict], str | None]:
    from .messages import Messages

    adapter, projection = Adapter(), Messages()
    for event in events:
        for normalized in adapter.accept(
            {"method": "session.event", "params": {"event": event}}
        ):
            projection.accept(normalized)
        if event["type"] == "turn/end" and projection.messages:
            last = projection.messages[-1]
            if last.get("role") == "assistant":
                last["stopReason"] = {"error": "error", "aborted": "aborted"}.get(
                    adapter.last_reason or "", "stop"
                )
    return projection.messages, adapter.last_reason
