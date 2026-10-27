import { expect, test } from "vitest";
import { collaborationSpans } from "./fullTraceModel";
import type { Call, ObservedEvent } from "./model";
const root: Call = {
  id: "root",
  parent_id: null,
  root_id: "root",
  conversation_id: "c",
  agent_id: null,
  version_id: null,
  name: "Agent",
  prompt: "",
  status: "running",
  activity: "waiting_dependency",
  worker_attached: true,
  created_at: "2026-10-27T00:00:00Z",
  finished_at: null,
  error: null,
  sandbox_requested: false,
  revision: 1,
};
test("collapsed agents remain visible, with real lifecycle boundaries and per-agent activity", () => {
  const spans = collaborationSpans(
    [
      root,
      {
        ...root,
        id: "child",
        parent_id: "root",
        activity: "executing",
        created_at: "2026-10-27T00:00:02Z",
      },
    ],
    {},
    new Set(),
  );
  expect(spans).toHaveLength(2);
  expect(spans.map((s) => s.running)).toEqual([false, true]);
  expect(spans[1].start! - spans[0].start!).toBe(2000);
  expect(spans[1].parentId).toBeNull();
  expect(spans[1].depth).toBe(1);
});
test("expanded records retain task identity and wait semantics without fabricating historical ends", () => {
  const event: ObservedEvent = {
    id: "event",
    task_id: "root",
    seq: 1,
    time: Date.parse(root.created_at),
    type: "tool/call",
    data: {
      callId: "wait",
      name: "wait_for_tasks",
      arguments: '{"mode":"any"}',
    },
  };
  const spans = collaborationSpans(
    [root],
    { root: { events: [event], after: 1, available: true, loading: false } },
    new Set(["root"]),
  );
  expect(spans[1].name).toBe("等待任意一个完成");
  expect(spans[1].label).toBe("等待中");
  expect(spans[1].record?.name).toBe("wait_for_tasks");
  const old = collaborationSpans(
    [{ ...root, status: "completed", activity: "completed" }],
    {},
    new Set(),
  );
  expect(old[0].end).toBeNull();
  expect(old[0].label).toContain("结束时间未记录");
  const done = collaborationSpans(
    [
      {
        ...root,
        status: "failed",
        activity: "failed",
        finished_at: "2026-10-27T00:00:05Z",
      },
    ],
    {},
    new Set(),
  );
  expect(done[0].end! - done[0].start!).toBe(5000);
  expect(done[0].state).toBe("error");
});
