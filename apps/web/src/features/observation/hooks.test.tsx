// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { EventSourceMessage } from "@microsoft/fetch-event-source";
import { useAgentGraph, useTaskObservation } from "./hooks";
import { platformRequest } from "@/lib/platform";
import { observeStream } from "./stream";
vi.mock("@/lib/platform", () => ({ platformRequest: vi.fn() }));
vi.mock("./stream", () => ({ observeStream: vi.fn(() => Promise.resolve()) }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const page = {
  events: [],
  next_after: 15,
  has_more: true,
  log_available: true,
};
const task = {
  id: "task",
  messages: [],
  questions: [],
  artifacts: [],
  waiting_for: [],
};
function message(event: string, data: unknown, id = ""): EventSourceMessage {
  return { event, data: JSON.stringify(data), id };
}
test("empty pages advance the official cursor; retry resumes and cleanup aborts", async () => {
  vi.mocked(platformRequest).mockImplementation(async (path) =>
    path.includes("/history") ? page : task,
  );
  const hook = renderHook(() => useTaskObservation("task"));
  await waitFor(() => expect(observeStream).toHaveBeenCalledOnce());
  expect(vi.mocked(observeStream).mock.calls[0][0]).toContain("after=15");
  const options = vi.mocked(observeStream).mock.calls[0][1];
  act(() =>
    options.message(
      message("history", { ...page, next_after: 20, events: [] }, "task:20"),
    ),
  );
  act(() => options.connection("error", "failure"));
  act(() => hook.result.current.retry());
  await waitFor(() =>
    expect(
      vi
        .mocked(platformRequest)
        .mock.calls.some(([path]) => path.includes("after=20")),
    ).toBe(true),
  );
  await waitFor(() => expect(observeStream).toHaveBeenCalledTimes(2));
  expect(options.signal.aborted).toBe(true);
  const latest = vi.mocked(observeStream).mock.calls[1][1];
  act(() => latest.message(message("done", { after: 20 })));
  expect(hook.result.current.connection).toBe("done");
  expect(latest.signal.aborted).toBe(true);
  hook.unmount();
});
test("a late task response cannot start a stream after unmount", async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(platformRequest).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const hook = renderHook(() => useTaskObservation("old"));
  hook.unmount();
  await act(async () => resolve(task));
  expect(observeStream).not.toHaveBeenCalled();
});
test("graph feed is disabled off-page and remains connected across completed snapshots", async () => {
  const graph = { nodes: [], edges: [], calls: [] };
  vi.mocked(platformRequest).mockResolvedValue(graph);
  const hook = renderHook(
    ({ enabled }) => useAgentGraph("conversation", enabled),
    { initialProps: { enabled: true } },
  );
  await waitFor(() => expect(observeStream).toHaveBeenCalledOnce());
  const options = vi.mocked(observeStream).mock.calls[0][1];
  act(() => options.message(message("graph", graph)));
  expect(options.signal.aborted).toBe(false);
  hook.rerender({ enabled: false });
  expect(options.signal.aborted).toBe(true);
  expect(hook.result.current.data).toEqual(graph);
});
