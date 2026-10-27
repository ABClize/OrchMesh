// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TraceWaterfall, type TraceSpan } from "./TraceWaterfall";
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  vi.useRealTimers();
});
const spans: TraceSpan[] = [
  {
    id: "root",
    parentId: null,
    name: "轮次 1",
    kind: "turn",
    start: 1000,
    end: null,
    state: "open",
  },
  {
    id: "tool",
    parentId: "root",
    name: "bash",
    kind: "tool",
    start: 1100,
    end: null,
    state: "open",
  },
];
it("preserves collapse across streamed arrivals and selects original data", () => {
  const props = {
    live: false,
    running: false,
    renderDetail: (s: TraceSpan) => <p>详情 {s.id}</p>,
  };
  const view = render(<TraceWaterfall {...props} spans={spans} />);
  fireEvent.click(screen.getByRole("button", { name: "查看记录：bash" }));
  expect(screen.getByText("详情 tool")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "折叠轮次 1" }));
  view.rerender(
    <TraceWaterfall
      {...props}
      spans={[...spans, { ...spans[1], id: "next", name: "另一个工具" }]}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "查看记录：另一个工具" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "展开轮次 1" }));
  expect(
    screen.getByRole("button", { name: "查看记录：另一个工具" }),
  ).toBeTruthy();
});
it("cleans its clock and stops execution animation while waiting", () => {
  vi.useFakeTimers();
  const view = render(
    <TraceWaterfall spans={spans} live running renderDetail={() => null} />,
  );
  expect(view.container.querySelectorAll("[data-running=true]")).toHaveLength(
    2,
  );
  view.rerender(
    <TraceWaterfall
      spans={spans}
      live
      running={false}
      renderDetail={() => null}
    />,
  );
  expect(view.container.querySelectorAll("[data-running=true]")).toHaveLength(
    0,
  );
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("shows task waiting even when question tool has already returned", () => {
  render(
    <TraceWaterfall
      spans={spans.map((s) => ({ ...s, state: "complete", end: 1200 }))}
      live
      running={false}
      statusLabel="等待你的回答"
      renderDetail={() => null}
    />,
  );
  expect(screen.getByText("等待你的回答")).toBeTruthy();
});
