from copy import deepcopy


class Messages:
    """Transient projection; durable history remains DSH's own session files."""

    def __init__(self, messages: list[dict] | None = None):
        self.messages = deepcopy(messages or [])
        self.current: int | None = None

    def accept(self, event: dict):
        kind = event.get("type")
        if kind == "tool_execution_end":
            target = next(
                (
                    m
                    for m in self.messages
                    if m.get("role") == "toolResult"
                    and m.get("toolCallId") == event["toolCallId"]
                ),
                None,
            )
            if target is not None:
                target["content"] = deepcopy(event["result"]["content"])
                target["isError"] = event.get("isError", False)
        elif kind == "message_start":
            self.messages.append(deepcopy(event["message"]))
            self.current = len(self.messages) - 1
        elif kind == "message_end":
            if self.current is None:
                self.messages.append(deepcopy(event["message"]))
            else:
                self.messages[self.current] = deepcopy(event["message"])
            self.current = None
        elif kind == "message_update" and self.current is not None:
            change = event["assistantMessageEvent"]
            content = self.messages[self.current].setdefault("content", [])
            index = change.get("contentIndex", 0)
            while len(content) <= index:
                content.append({})
            block = content[index]
            subtype = change["type"]
            if subtype.startswith(("text_", "thinking_")):
                field = "text" if subtype.startswith("text_") else "thinking"
                block["type"] = field
                if subtype.endswith("_delta"):
                    block[field] = block.get(field, "") + change["delta"]
                elif subtype.endswith("_end"):
                    block[field] = change["content"]
            elif subtype == "toolcall_end":
                content[index] = deepcopy(change["toolCall"])
