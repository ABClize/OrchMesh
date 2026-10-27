// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AgentRelations } from "./AgentRelations";
import type { AgentGraph } from "./model";
vi.mock("@/components/ui/button-clean", () => ({
  Button: ({
    children,
    onClick,
    "aria-label": label,
  }: {
    children: React.ReactNode;
    onClick: () => void;
    "aria-label": string;
  }) => (
    <button onClick={onClick} aria-label={label}>
      {children}
    </button>
  ),
}));
afterEach(cleanup);
const graph: AgentGraph = {
  nodes: ["A", "B", "独立"].map((id) => ({
    id,
    name: id,
    agent_id: id,
    task_ids: [],
    version_ids: [],
    call_count: 2,
    active_count: 0,
    status_counts: { completed: 2 },
    activity_counts: { completed: 2 },
  })),
  edges: [
    ["A", "B"],
    ["B", "A"],
    ["A", "A"],
  ].map(([source, target]) => ({
    id: `${source}-${target}`,
    source,
    target,
    kind: "call",
    task_ids: ["task"],
    call_count: 2,
    active_count: 0,
    status_counts: { completed: 2 },
  })),
  calls: [],
};
test("cycles, self calls and isolated agents remain finite and direction buttons select edge identities", () => {
  const onSelect = vi.fn();
  render(
    <AgentRelations
      graph={graph}
      selected="A-B"
      onSelect={onSelect}
      details={<div>唯一详情</div>}
    />,
  );
  expect(screen.getAllByRole("region")).toHaveLength(1);
  expect(screen.getAllByRole("button", { name: /，2 次调用，/ })).toHaveLength(
    3,
  );
  expect(screen.getAllByText("唯一详情")).toHaveLength(1);
  expect(screen.getByText("自调用 · 2 次调用")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "查看 B 调用 A 的 2 次调用" }),
  );
  expect(onSelect).toHaveBeenCalledWith("edge", "B-A");
});
test("unknown task selections still expose details without a matching graph group", () => {
  render(
    <AgentRelations
      graph={graph}
      selected="task-opaque-id"
      onSelect={vi.fn()}
      details={<div>任务详情</div>}
    />,
  );
  expect(screen.getAllByText("任务详情")).toHaveLength(1);
});
test("waiting dependencies do not animate as actively executing", () => {
  const call = {
    id: "task",
    root_id: "task",
    parent_id: null,
    conversation_id: "c",
    agent_id: null,
    version_id: null,
    name: "A",
    prompt: "test",
    status: "waiting",
    activity: "waiting_dependency",
    worker_attached: false,
    created_at: "2026-10-27",
    error: null,
    sandbox_requested: false,
    revision: 1,
  };
  const { container, rerender } = render(
    <AgentRelations
      graph={{ ...graph, calls: [call] }}
      selected={null}
      onSelect={vi.fn()}
    />,
  );
  expect(container.querySelectorAll('[data-running="true"]')).toHaveLength(0);
  rerender(
    <AgentRelations
      graph={{ ...graph, calls: [{ ...call, activity: "executing" }] }}
      selected={null}
      onSelect={vi.fn()}
    />,
  );
  expect(container.querySelectorAll('[data-running="true"]')).toHaveLength(3);
});
