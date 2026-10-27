// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ObservationWorkspace, type Selection } from "./ObservationWorkspace";
import { scopeGraph, type AgentGraph, type Call } from "./model";
const viewport = vi.hoisted(() => ({ desktop: false }));
vi.mock("@/hooks/useMediaQuery", () => ({
  useMediaQuery: () => viewport.desktop,
}));
beforeEach(() => {
  viewport.desktop = false;
});
vi.mock("./CallInspector", () => ({
  CallInspector: ({ taskId }: { taskId: string }) => (
    <div aria-label="测试调用详情">{taskId}</div>
  ),
}));
afterEach(cleanup);
const root: Call = {
  id: "root-task",
  root_id: "root-task",
  parent_id: null,
  conversation_id: "conversation",
  agent_id: null,
  version_id: "v1",
  name: "助手",
  prompt: "研究",
  status: "completed",
  activity: "completed",
  worker_attached: false,
  created_at: "2026-10-27T00:00:00Z",
  error: null,
  sandbox_requested: false,
  revision: 1,
};
const graph: AgentGraph = {
  calls: [
    root,
    { ...root, id: "child-task", parent_id: root.id, prompt: "核对" },
  ],
  nodes: [
    {
      id: "agent-node-not-a-task",
      agent_id: null,
      name: "助手",
      version_ids: ["v1"],
      task_ids: [root.id, "child-task"],
      call_count: 2,
      active_count: 0,
      status_counts: { completed: 2 },
      activity_counts: { completed: 2 },
    },
  ],
  edges: [],
};
function Workspace() {
  const [selection, onSelect] = useState<Selection>(null);
  return (
    <ObservationWorkspace
      graph={scopeGraph(graph, root.id)}
      readOnly={false}
      selection={selection}
      onSelect={onSelect}
      active
    />
  );
}
test("mobile drills through agent calls and never treats node ID as task ID", () => {
  render(<Workspace />);
  fireEvent.click(screen.getByRole("button", { name: /助手/ }));
  expect(screen.queryByLabelText("测试调用详情")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /调用 2/ }));
  expect(screen.getByLabelText("测试调用详情").textContent).toBe("child-task");
  fireEvent.click(screen.getByRole("button", { name: "返回调用列表" }));
  expect(screen.queryByLabelText("测试调用详情")).toBeNull();
  expect(screen.getByRole("button", { name: /调用 1/ })).toBeTruthy();
});

test("desktop call details are mounted only on demand and can be collapsed", () => {
  viewport.desktop = true;
  render(<Workspace />);
  fireEvent.mouseDown(screen.getByRole("tab", { name: "聚合关系图" }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(screen.getByRole("button", { name: /助手，2 次调用/ }));
  expect(screen.queryByLabelText("测试调用详情")).toBeNull();
  const row = screen.getByRole("button", { name: /调用 1/ });
  expect(row.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(row);
  expect(screen.getByLabelText("测试调用详情").textContent).toBe("root-task");
  expect(row.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(row);
  expect(screen.queryByLabelText("测试调用详情")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /助手，2 次调用/ }));
  expect(screen.queryByRole("button", { name: /调用 1/ })).toBeNull();
});
test("a single call still waits for explicit expansion", () => {
  viewport.desktop = true;
  render(
    <ObservationWorkspace
      graph={{
        ...graph,
        calls: [root],
        nodes: [{ ...graph.nodes[0], task_ids: [root.id], call_count: 1 }],
      }}
      readOnly={false}
      selection={{ kind: "node", id: graph.nodes[0].id }}
      onSelect={vi.fn()}
      active
    />,
  );
  expect(screen.queryByLabelText("测试调用详情")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /调用 1/ }));
  expect(screen.getByLabelText("测试调用详情").textContent).toBe(root.id);
});

test("tree selects real task IDs and folding a selected descendant closes details", () => {
  viewport.desktop = true;
  render(<Workspace />);
  fireEvent.mouseDown(screen.getByRole("tab", { name: "调用树" }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(
    screen.getByRole("button", { name: "查看调用：助手 · d-task" }),
  );
  expect(screen.getByLabelText("测试调用详情").textContent).toBe("child-task");
  fireEvent.click(screen.getByRole("button", { name: "折叠助手的分支" }));
  expect(screen.queryByLabelText("测试调用详情")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "查看调用：助手 · d-task" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "展开助手的分支" }));
  expect(
    screen.getByRole("button", { name: "查看调用：助手 · d-task" }),
  ).toBeTruthy();
});

test("desktop defaults to every agent lifecycle without loading tools", () => {
  viewport.desktop = true;
  render(<Workspace />);
  expect(
    screen
      .getByRole("tab", { name: "全链路瀑布图" })
      .getAttribute("aria-selected"),
  ).toBe("true");
  expect(
    screen.getAllByRole("button", { name: /^查看记录：助手/ }),
  ).toHaveLength(2);
  fireEvent.click(
    screen.getByRole("button", { name: "查看记录：助手 · d-task" }),
  );
  expect(screen.getByLabelText("测试调用详情").textContent).toBe("child-task");
});
