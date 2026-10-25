import { create } from "zustand";
import {
  projectPiThreadMessages,
  type PiAgentMessage,
} from "@assistant-ui/react-pi";

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
      const messages = state.messages.slice();
      if (state.current !== null)
        messages[state.current] = structuredClone(messages[state.current]);
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

// Pi 1.4 RPC sends deltas, unlike the SDK events expected by the upstream
// reducer. Keep that transport adapter above; delegate UI projection upstream.
export function toThreadMessages(messages: PiMessage[], status = "idle") {
  return projectPiThreadMessages({
    messages: messages as PiAgentMessage[],
    toolExecutions: {},
    hostUiRequests: [],
    runStatus:
      status === "running"
        ? "running"
        : status === "failed"
          ? "failed"
          : "idle",
  });
}
