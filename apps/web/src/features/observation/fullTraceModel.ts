import { buildForest } from "@/components/agent-tree/forest";
import { activityLabel, isActive, type Call } from "./model";
import {
  collaborationOperation,
  executionSpans,
  type ExecutionSpan,
} from "./traceModel";
import type { TraceHistory } from "./useTraceHistory";
export type CollaborationSpan = ExecutionSpan & {
  taskId: string;
  record?: ExecutionSpan;
};
const time = (value: string | null | undefined) => {
  const result = value ? Date.parse(value) : NaN;
  return Number.isFinite(result) ? result : null;
};
/** Every agent remains visible; disclosure controls only its own execution records. */
export function collaborationSpans(
  calls: Call[],
  histories: Record<string, TraceHistory>,
  expanded: ReadonlySet<string>,
): CollaborationSpan[] {
  const forest = buildForest(
    calls.map((call) => ({ ...call, parentId: call.parent_id })),
  );
  const spans: CollaborationSpan[] = [];
  const visit = (items: typeof forest.roots, depth = 0) => {
    for (const call of items) {
      const active = isActive(call.status);
      spans.push({
        id: call.id,
        taskId: call.id,
        parentId: null,
        depth,
        name: `${call.name} · ${call.id.slice(-6)}`,
        kind: "agent",
        start: time(call.created_at),
        end: time(call.finished_at),
        state: active
          ? "open"
          : call.status === "failed"
            ? "error"
            : call.finished_at
              ? "complete"
              : "incomplete",
        label: `${activityLabel(call.activity)}${!active && !call.finished_at ? " · 结束时间未记录" : ""}`,
        running: call.activity === "executing",
        expandable: true,
        events: [],
      });
      if (expanded.has(call.id)) {
        const history = histories[call.id];
        const records = executionSpans(history?.events ?? []);
        for (const record of records.filter(
          (span) => span.kind === "tool" || span.name.includes("重试"),
        )) {
          const waiting = [
            "wait_for_tasks",
            "delegate_task",
            "user_question",
          ].includes(record.name);
          const open = active && record.state === "open";
          spans.push({
            ...record,
            record,
            taskId: call.id,
            parentId: call.id,
            depth: depth + 1,
            state:
              !active && record.state === "open" ? "incomplete" : record.state,
            label: open && waiting ? "等待中" : undefined,
            running: open && !waiting && call.activity === "executing",
            name:
              record.name === "wait_for_tasks"
                ? (collaborationOperation(record)?.split(" · ")[0] ??
                  record.name)
                : record.name,
          });
        }
        const notice = history?.error
          ? "记录读取失败，点击重试"
          : history?.loading || !history
            ? "正在读取执行记录…"
            : history.available === false
              ? "执行日志不可用"
              : !records.length
                ? "暂无执行记录"
                : null;
        if (notice)
          spans.push({
            id: `${call.id}:notice`,
            taskId: call.id,
            parentId: call.id,
            name: notice,
            depth: depth + 1,
            kind: "notice",
            start: null,
            end: null,
            state: "incomplete",
            events: [],
            label: history?.error ? "读取失败" : "",
          });
      }
      visit(forest.children.get(call.id) ?? [], depth + 1);
    }
  };
  visit(forest.roots);
  return spans;
}
