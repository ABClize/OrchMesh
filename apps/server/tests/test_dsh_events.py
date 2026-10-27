from orchmesh.dsh.events import Adapter, history, message


def test_native_tool_errors_and_results_reach_existing_cards():
    value = message(
        {
            "role": "tool",
            "source": {"kind": "tool", "callId": "call-1"},
            "isError": True,
            "content": [{"type": "text", "text": "permission denied"}],
        }
    )
    assert value["toolCallId"] == "call-1"
    assert value["isError"]
    assert value["content"][0]["text"] == "permission denied"


def test_history_keeps_chat_across_compaction_without_system_prompt_leak():
    events = [
        {
            "type": "user/message",
            "data": {
                "role": "user",
                "source": {"kind": "user"},
                "content": [{"type": "text", "text": "hello"}],
            },
        },
        {
            "type": "user/message",
            "data": {
                "role": "user",
                "source": {"kind": "context"},
                "content": [{"type": "text", "text": "internal"}],
            },
        },
        {
            "type": "assistant/message",
            "data": {
                "message": {
                    "role": "assistant",
                    "content": [
                        {"type": "reasoning", "text": "check"},
                        {"type": "text", "text": "answer"},
                    ],
                }
            },
        },
        {"type": "compaction/end", "data": {}},
        {"type": "turn/end", "data": {"reason": {"kind": "aborted"}}},
    ]
    messages, reason = history(events)
    assert len(messages) == 2
    assert messages[1]["content"][0] == {"type": "thinking", "thinking": "check"}
    assert messages[1]["stopReason"] == reason == "aborted"


def test_streaming_is_visible_before_message_settlement():
    from orchmesh.dsh.messages import Messages

    adapter, projection = Adapter(), Messages()
    for frame in [
        {"type": "start"},
        {
            "type": "chunk",
            "chunk": {"type": "text-delta", "index": 0, "text": "partial"},
        },
    ]:
        for event in adapter.accept(
            {"method": "orchmesh.stream", "params": {"frame": frame}}
        ):
            projection.accept(event)
    assert projection.messages[-1]["content"][0]["text"] == "partial"


def test_native_delivery_updates_tool_result_for_live_and_cold_views():
    from orchmesh.dsh.messages import Messages

    result = {
        "type": "tool/result",
        "data": {
            "role": "tool",
            "source": {"kind": "tool", "callId": "p1"},
            "content": [{"type": "text", "text": "Presented /workspace/report.md"}],
        },
    }
    delivery = {
        "type": "deliverables/presented",
        "data": {
            "callId": "p1",
            "turn": 1,
            "files": [{"path": "/workspace/report.md", "description": "Report"}],
        },
    }
    for events in ([result, delivery], [delivery, result]):
        adapter, projection = Adapter(), Messages()
        for event in events:
            for update in adapter.accept(
                {"method": "session.event", "params": {"event": event}}
            ):
                projection.accept(update)
        assert projection.messages == history(events)[0]
        assert len(projection.messages) == 1
        assert "dsh.deliverables" in projection.messages[0]["content"][0]["text"]


def test_internal_continuation_is_not_displayed_as_user_instruction():
    from orchmesh.dsh.events import message

    assert (
        message(
            {
                "role": "user",
                "source": {"kind": "orchmesh-continuation"},
                "content": [{"type": "text", "text": "resume internals"}],
            }
        )
        is None
    )
