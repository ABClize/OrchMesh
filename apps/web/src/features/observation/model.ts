import type { components } from "@/lib/api-schema";
export type AgentGraph = components["schemas"]["AgentGraph"];
export type AgentNode = components["schemas"]["AgentNode"];
export type Call = components["schemas"]["TaskNode"];
export type TaskDetail = components["schemas"]["TaskDetail"];
export type EventPage = components["schemas"]["EventPage"];
export type ObservedEvent = components["schemas"]["ObservedEvent"];
export const emptyGraph: AgentGraph = { nodes: [], edges: [], calls: [] };
export const isActive = (status: string) =>
  ["queued", "running", "waiting"].includes(status);
export function activityLabel(activity: string) {
  return (
    (
      {
        queued: "排队中",
        running: "执行中",
        executing: "执行中",
        waiting: "等待中",
        waiting_user: "等待你的回答",
        waiting_dependency: "等待协作者",
        resuming_or_transitioning: "正在衔接执行",
        completed: "已完成",
        failed: "失败",
        stopped: "已停止",
      } as Record<string, string>
    )[activity] ?? "状态待更新"
  );
}
export function countsLabel(counts: Record<string, number>) {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${count} ${activityLabel(status)}`)
    .join(" · ");
}
export function formatTime(value: string | number) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "时间未知"
    : date.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}
function counts(calls: Call[], field: "status" | "activity") {
  return calls.reduce<Record<string, number>>((result, call) => {
    result[call[field]] = (result[call[field]] ?? 0) + 1;
    return result;
  }, {});
}
// Filter using server-provided identities: never reconstruct node IDs from names.
export function scopeGraph(
  graph: AgentGraph,
  rootId: string | null,
): AgentGraph {
  if (!rootId) return graph;
  const calls = graph.calls.filter((call) => call.root_id === rootId);
  const byId = new Map(calls.map((call) => [call.id, call]));
  const summarize = (ids: string[]) => {
    const items = ids.flatMap((id) => {
      const call = byId.get(id);
      return call ? [call] : [];
    });
    return {
      task_ids: items.map((c) => c.id),
      call_count: items.length,
      active_count: items.filter((c) => isActive(c.status)).length,
      status_counts: counts(items, "status"),
      items,
    };
  };
  return {
    calls,
    nodes: graph.nodes.flatMap((node) => {
      const { items, ...summary } = summarize(node.task_ids);
      return items.length
        ? [
            {
              ...node,
              ...summary,
              name: items.at(-1)!.name,
              version_ids: [
                ...new Set(
                  items.flatMap((c) => (c.version_id ? [c.version_id] : [])),
                ),
              ],
              activity_counts: counts(items, "activity"),
            },
          ]
        : [];
    }),
    edges: graph.edges.flatMap((edge) => {
      const { items, ...summary } = summarize(edge.task_ids);
      return items.length ? [{ ...edge, ...summary }] : [];
    }),
  };
}
export function mergeHistory(
  previous: ObservedEvent[],
  page: EventPage,
  taskId: string,
) {
  const events = new Map(previous.map((event) => [event.seq, event]));
  for (const event of page.events)
    if (event.task_id === taskId) events.set(event.seq, event);
  return [...events.values()].sort((a, b) => a.seq - b.seq);
}
export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// waiting_for includes recorded dependencies, including calls already completed.
// The detail activity owns whether the UI should present an active wait.
export function pendingDependencies(
  task: Pick<TaskDetail, "activity" | "waiting_for">,
  calls: Call[],
) {
  if (task.activity !== "waiting_dependency") return [];
  const byId = new Map(calls.map((call) => [call.id, call]));
  return task.waiting_for.filter((id) => {
    const call = byId.get(id);
    return !call || isActive(call.status);
  });
}
