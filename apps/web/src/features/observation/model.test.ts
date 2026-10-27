import { expect, test } from "vitest";
import {
  scopeGraph,
  pendingDependencies,
  mergeHistory,
  activityLabel,
  type AgentGraph,
  type Call,
  type ObservedEvent,
} from "./model";
const call = (
  id: string,
  root: string,
  status: string,
  version: string,
): Call => ({
  id,
  root_id: root,
  parent_id: id === root ? null : root,
  conversation_id: "c",
  agent_id: "agent",
  version_id: version,
  name: `name-${id}`,
  prompt: id,
  status,
  activity: status,
  worker_attached: false,
  created_at: "2026-10-27T00:00:00Z",
  error: null,
  sandbox_requested: false,
  revision: 1,
});
export const fixture: AgentGraph = {
  calls: [
    call("r1", "r1", "completed", "v1"),
    call("child", "r1", "failed", "v2"),
    call("r2", "r2", "running", "draft:agent"),
  ],
  nodes: [
    {
      id: "opaque-node",
      agent_id: "agent",
      name: "latest",
      version_ids: ["v1", "v2", "draft:agent"],
      task_ids: ["r1", "child", "r2"],
      call_count: 3,
      active_count: 1,
      status_counts: { completed: 1, failed: 1, running: 1 },
      activity_counts: { completed: 1, failed: 1, running: 1 },
    },
  ],
  edges: [
    {
      id: "opaque-edge",
      source: "opaque-node",
      target: "opaque-node",
      kind: "call",
      task_ids: ["child"],
      call_count: 1,
      active_count: 0,
      status_counts: { failed: 1 },
    },
  ],
};
test("root scoping retains opaque identities, self edges and mixed status counts", () => {
  const graph = scopeGraph(fixture, "r1");
  expect(graph.nodes[0]).toMatchObject({
    id: "opaque-node",
    name: "name-child",
    call_count: 2,
    active_count: 0,
    version_ids: ["v1", "v2"],
    status_counts: { completed: 1, failed: 1 },
  });
  expect(graph.edges[0].task_ids).toEqual(["child"]);
  expect(scopeGraph(fixture, "r2").edges).toEqual([]);
  expect(scopeGraph(fixture, null)).toBe(fixture);
});
test("replayed history deduplicates, sorts and rejects events from another task", () => {
  const event = (task: string, seq: number): ObservedEvent => ({
    id: `${task}:${seq}`,
    task_id: task,
    seq,
    time: 0,
    type: "step/start",
    data: {},
  });
  expect(
    mergeHistory(
      [event("a", 2)],
      {
        events: [event("a", 2), event("b", 3), event("a", 1)],
        next_after: 8,
        has_more: false,
        log_available: true,
      },
      "a",
    ).map((e) => e.seq),
  ).toEqual([1, 2]);
  expect(activityLabel("resuming_or_transitioning")).toBe("正在衔接执行");
  expect(activityLabel("future-state")).toBe("状态待更新");
});

test("recorded completed dependencies are not shown as active waits", () => {
  const calls = [
    call("done", "r", "completed", "v"),
    call("active", "r", "running", "v"),
    call("failed", "r", "failed", "v"),
  ];
  const waiting_for = ["done", "active", "failed", "unknown"];
  expect(
    pendingDependencies({ activity: "waiting_user", waiting_for }, calls),
  ).toEqual([]);
  expect(
    pendingDependencies({ activity: "completed", waiting_for }, calls),
  ).toEqual([]);
  expect(
    pendingDependencies({ activity: "waiting_dependency", waiting_for }, calls),
  ).toEqual(["active", "unknown"]);
});
