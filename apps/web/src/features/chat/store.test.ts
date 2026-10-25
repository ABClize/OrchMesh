import { beforeEach, expect, test } from "vitest";
import { toThreadMessages, useChat } from "./store";

beforeEach(() => useChat.getState().reset());

test("reconnect snapshot plus deltas preserves content blocks and replaces final message", () => {
  useChat.getState().snapshot({
    messages: [
      {
        role: "assistant",
        timestamp: 1,
        content: [{ type: "text", text: "hello" }],
      },
    ],
    status: "running",
    run_id: "run",
    cursor: 10,
  });
  useChat.getState().event({
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      contentIndex: 0,
      delta: " world",
    },
  });
  expect(useChat.getState().messages[0].content).toEqual([
    { type: "text", text: "hello world" },
  ]);
  useChat.getState().event({
    type: "message_end",
    message: {
      role: "assistant",
      timestamp: 1,
      content: [{ type: "text", text: "authoritative" }],
    },
  });
  expect(useChat.getState().messages).toHaveLength(1);
  expect(useChat.getState().messages[0].content).toEqual([
    { type: "text", text: "authoritative" },
  ]);
});

test("Pi tool results attach to original call without becoming duplicate bubbles", () => {
  const messages = toThreadMessages([
    {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "call1",
          name: "bash",
          arguments: { command: "pwd" },
        },
      ],
    },
    {
      role: "toolResult",
      toolCallId: "call1",
      content: [{ type: "text", text: "/workspace" }],
    },
  ]);
  expect(messages).toHaveLength(1);
  expect(messages[0].content).toEqual([
    expect.objectContaining({
      type: "tool-call",
      toolCallId: "call1",
      result: "/workspace",
    }),
  ]);
});
