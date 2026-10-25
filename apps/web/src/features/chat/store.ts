import { create } from "zustand";
import type { ThreadMessageLike } from "@assistant-ui/react";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type Part = {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, Json>;
};
export type PiMessage = {
  role: string;
  content: string | Part[];
  timestamp?: number;
  toolCallId?: string;
  isError?: boolean;
  stopReason?: string;
  errorMessage?: string;
};
export type Snapshot = {
  messages: PiMessage[];
  status: string;
  run_id: string | null;
  cursor: number;
  error?: string | null;
};
type PiEvent = {
  type: string;
  message?: PiMessage;
  assistantMessageEvent?: {
    type: string;
    contentIndex: number;
    delta?: string;
    content?: string;
    toolCall?: Part;
  };
  toolCallId?: string;
  result?: { content: Part[] };
  partialResult?: { content: Part[] };
  isError?: boolean;
};
type State = Snapshot & {
  current: number | null;
  reset: () => void;
  snapshot: (snapshot: Snapshot) => void;
  event: (event: PiEvent) => void;
};
const empty = {
  messages: [],
  status: "idle",
  run_id: null,
  cursor: 0,
  error: null,
  current: null,
} satisfies Snapshot & { current: null };

export const useChat = create<State>((set) => ({
  ...empty,
  reset: () => set(empty),
  snapshot: (value) =>
    set({
      ...value,
      current:
        value.status === "running" &&
        value.messages.at(-1)?.role === "assistant"
          ? value.messages.length - 1
          : null,
    }),
  event: (event) =>
    set((state) => {
      const messages = structuredClone(state.messages);
      let current = state.current;
      if (event.type === "message_start" && event.message) {
        messages.push(event.message);
        current = messages.length - 1;
      } else if (event.type === "message_end" && event.message) {
        if (current === null) messages.push(event.message);
        else messages[current] = event.message;
        current = null;
      } else if (
        event.type === "message_update" &&
        current !== null &&
        event.assistantMessageEvent
      ) {
        const change = event.assistantMessageEvent;
        const content = messages[current].content;
        if (Array.isArray(content)) {
          const index = change.contentIndex ?? 0;
          while (content.length <= index)
            content.push({ type: "text", text: "" });
          const field = change.type.startsWith("thinking_")
            ? "thinking"
            : "text";
          if (
            change.type.startsWith("text_") ||
            change.type.startsWith("thinking_")
          ) {
            content[index].type = field;
            if (change.type.endsWith("_delta"))
              content[index][field] =
                (content[index][field] ?? "") + (change.delta ?? "");
            else if (change.type.endsWith("_end"))
              content[index][field] = change.content ?? "";
          } else if (change.type === "toolcall_end" && change.toolCall)
            content[index] = change.toolCall;
        }
      }
      return { messages, current };
    }),
}));

export function toThreadMessages(messages: PiMessage[]): ThreadMessageLike[] {
  const results = new Map(
    messages
      .filter((m) => m.role === "toolResult")
      .map((m) => [m.toolCallId, m]),
  );
  return messages.flatMap((message, index): ThreadMessageLike[] => {
    if (message.role !== "user" && message.role !== "assistant") return [];
    const parts =
      typeof message.content === "string"
        ? [{ type: "text", text: message.content }]
        : message.content;
    const content: Exclude<ThreadMessageLike["content"], string>[number][] = [];
    for (const part of parts) {
      if (part.type === "text")
        content.push({ type: "text", text: part.text ?? "" });
      if (part.type === "thinking")
        content.push({ type: "reasoning", text: part.thinking ?? "" });
      if (part.type === "toolCall" && part.id) {
        const result = results.get(part.id);
        content.push({
          type: "tool-call",
          toolCallId: part.id,
          toolName: part.name ?? "tool",
          args: part.arguments ?? {},
          argsText: JSON.stringify(part.arguments ?? {}),
          ...(result
            ? { result: result.content, isError: result.isError }
            : {}),
        });
      }
    }
    return [
      {
        id: `pi-${message.timestamp ?? 0}-${index}`,
        role: message.role,
        content,
        ...(message.role === "assistant" && message.stopReason === "error"
          ? {
              status: {
                type: "incomplete",
                reason: "error",
                error: "模型调用失败，请检查 Pi 配置。",
              } as const,
            }
          : {}),
      },
    ];
  });
}
