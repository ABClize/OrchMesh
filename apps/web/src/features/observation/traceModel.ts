import { record, type ObservedEvent } from "./model";
import type { TraceSpan } from "@/components/trace-waterfall/TraceWaterfall";
export type ExecutionSpan = TraceSpan & { events: ObservedEvent[] };
const names: Record<string, string> = {
  "assistant/message": "助手输出",
  "assistant/attempt": "模型尝试结束",
  "user/message": "用户输入",
  "llm/retry": "等待模型重试",
  "llm/retry-started": "开始模型重试",
};
/** DSH shell replay retains the official trailing exit-status marker, not ShellRunResult. */
export function toolResultFailed(name: string, data: Record<string, unknown>) {
  const message = record(data.message);
  if (message.isError === true) return true;
  if (!["bash", "pwsh"].includes(name) || !Array.isArray(message.content))
    return false;
  return message.content.some((part) => {
    const item = record(part);
    if (item.type !== "text" || typeof item.text !== "string") return false;
    const exit = /\n\[exit code: (\d+)\]$/.exec(item.text);
    return (
      (exit !== null && Number(exit[1]) !== 0) ||
      /\n\[killed by signal: [^\]\n]+\]$/.test(item.text)
    );
  });
}
/** Pair persisted events by call identity, never by tool name or arrival time. */
export function executionSpans(events: ObservedEvent[]): ExecutionSpan[] {
  const spans: ExecutionSpan[] = [];
  const open = new Map<string, ExecutionSpan>();
  let turn: ExecutionSpan | undefined;
  let step: ExecutionSpan | undefined;
  const unique = new Map(events.map((e) => [`${e.task_id}:${e.seq}`, e]));
  for (const event of [...unique.values()].sort((a, b) => a.seq - b.seq)) {
    const time = new Date(event.time).getTime();
    const timestamp = Number.isFinite(time) ? time : null;
    const kind = event.type.split("/")[0];
    const result = event.type === "tool/result";
    const callId = result
      ? record(record(event.data.message).source).callId
      : event.data.callId;
    const key = kind === "tool" ? `tool:${String(callId)}` : kind;
    const ending = event.type.endsWith("/end") || result;
    const matched =
      ending && (kind !== "tool" || typeof callId === "string")
        ? open.get(key)
        : undefined;
    if (matched) {
      matched.end = timestamp;
      matched.events.push(event);
      matched.state = toolResultFailed(matched.name, event.data)
        ? "error"
        : "complete";
      open.delete(key);
      if (kind === "turn") {
        turn = undefined;
        step = undefined;
        open.delete("step");
      }
      if (kind === "step") step = undefined;
      continue;
    }
    const starts =
      event.type === "turn/start" ||
      event.type === "step/start" ||
      event.type === "tool/call";
    const span: ExecutionSpan = {
      id: `${event.task_id}:${event.seq}`,
      parentId: kind === "turn" ? null : ((step ?? turn)?.id ?? null),
      name:
        event.type === "turn/start"
          ? `轮次 ${event.data.turn ?? "—"}`
          : event.type === "step/start"
            ? `步骤 ${event.data.step ?? "—"}`
            : event.type === "tool/call"
              ? String(event.data.name ?? "工具调用")
              : (names[event.type] ?? event.type),
      kind: starts ? kind : "event",
      start: timestamp,
      end: starts ? null : timestamp,
      state: starts
        ? "open"
        : record(event.data.message).isError === true
          ? "error"
          : "complete",
      events: [event],
    };
    if (kind === "step") span.parentId = turn?.id ?? null;
    spans.push(span);
    if (starts) {
      if (kind !== "tool" || typeof callId === "string") open.set(key, span);
      if (kind === "turn") {
        turn = span;
        step = undefined;
      }
      if (kind === "step") step = span;
    }
  }
  // A closed ancestor bounds missing child results, but does not invent an end timestamp.
  const byId = new Map(spans.map((s) => [s.id, s]));
  for (const span of spans) {
    let parent = span.parentId ? byId.get(span.parentId) : undefined;
    while (parent) {
      if (span.state === "open" && parent.state !== "open")
        span.state = "incomplete";
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
  }
  return spans;
}

/** Only platform delegation tool results carry navigable task references. */
export function spanTaskIds(span: ExecutionSpan): string[] {
  if (
    ![
      "start_agent_task",
      "wait_for_tasks",
      "get_task_result",
      "list_agent_tasks",
    ].includes(span.name)
  )
    return [];
  const ids = new Set<string>();
  for (const event of span.events) {
    if (event.type !== "tool/result") continue;
    const content = record(event.data.message).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const text = record(part).text;
      if (typeof text !== "string") continue;
      try {
        const value = record(JSON.parse(text));
        const results = Array.isArray(value.tasks) ? value.tasks : [value];
        for (const result of results) {
          const id = record(result).task_id;
          if (typeof id === "string" && id) ids.add(id);
        }
      } catch {
        /* Keep malformed results inspectable in the raw event details. */
      }
    }
  }
  return [...ids];
}

/** Explain the collaboration operation without mixing output into status records. */
export function collaborationOperation(span: ExecutionSpan): string | null {
  if (span.name === "get_task_result") return "按需读取最终结果";
  if (span.name === "list_agent_tasks") return "查看状态 · 不读取结果";
  if (span.name !== "wait_for_tasks") return null;
  const call = span.events.find((event) => event.type === "tool/call");
  try {
    const args =
      typeof call?.data.arguments === "string"
        ? record(JSON.parse(call.data.arguments))
        : record(call?.data.arguments);
    return args.mode === "any"
      ? "等待任意一个完成 · 仅返回状态"
      : "等待全部完成 · 仅返回状态";
  } catch {
    return "等待协作任务 · 参数见原始记录";
  }
}
