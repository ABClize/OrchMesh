import { describe, it, expect } from "vitest";
import {
  collaborationOperation,
  executionSpans,
  spanTaskIds,
} from "./traceModel";
import type { ObservedEvent } from "./model";
const e = (
  seq: number,
  type: string,
  data: Record<string, unknown> = {},
  time = seq * 100,
): ObservedEvent => ({
  id: `task:${seq}`,
  task_id: "task",
  seq,
  type,
  data,
  time,
});
describe("executionSpans", () => {
  it("pairs overlapping repeated tools by call id and retains hierarchy", () => {
    const spans = executionSpans([
      e(0, "turn/start", { turn: 1 }),
      e(1, "step/start", { step: 1 }),
      e(2, "tool/call", { name: "bash", callId: "a" }),
      e(3, "tool/call", { name: "bash", callId: "b" }),
      e(4, "tool/result", {
        message: { source: { callId: "b" }, isError: true },
      }),
      e(5, "tool/result", { message: { source: { callId: "a" } } }),
      e(6, "step/end"),
      e(7, "turn/end"),
    ]);
    expect(spans.map((s) => s.end)).toEqual([700, 600, 500, 400]);
    expect(spans[2].parentId).toBe("task:1");
    expect(spans[3].state).toBe("error");
  });
  it("does not invent completed results and deduplicates replay", () => {
    const start = e(0, "turn/start");
    const spans = executionSpans([
      start,
      start,
      e(1, "tool/call", { callId: "x" }),
      e(2, "turn/end"),
    ]);
    expect(spans).toHaveLength(2);
    expect(spans[1].state).toBe("incomplete");
    expect(spans[1].end).toBeNull();
  });
  it("keeps unmatched results and invalid timestamps visible", () => {
    const spans = executionSpans([
      e(1, "tool/result", { message: { source: { callId: "missing" } } }),
      e(2, "tool/call", {}, NaN),
    ]);
    expect(spans).toHaveLength(2);
    expect(spans[1].start).toBeNull();
  });
});

it("recognizes official shell exit markers without treating other tool text as shell status", () => {
  const events = [
    e(0, "tool/call", { name: "bash", callId: "fail" }),
    e(1, "tool/result", {
      message: {
        source: { callId: "fail" },
        isError: false,
        content: [
          {
            type: "text",
            text: "[stderr]\nCONTROLLED_FAILURE\n[exit code: 7]",
          },
        ],
      },
    }),
    e(2, "tool/call", { name: "bash", callId: "retry" }),
    e(3, "tool/result", {
      message: {
        source: { callId: "retry" },
        isError: false,
        content: [{ type: "text", text: "RETRY_RECOVERED" }],
      },
    }),
    e(4, "tool/call", { name: "search", callId: "other" }),
    e(5, "tool/result", {
      message: {
        source: { callId: "other" },
        content: [{ type: "text", text: "example\n[exit code: 7]" }],
      },
    }),
  ];
  expect(executionSpans(events).map((s) => s.state)).toEqual([
    "error",
    "complete",
    "complete",
  ]);
});

it("retains genuine model retry events as separate evidence", () => {
  const spans = executionSpans([
    e(0, "turn/start"),
    e(1, "llm/retry", { attempt: 1 }),
    e(2, "llm/retry-started", { attempt: 2 }),
    e(3, "turn/end"),
  ]);
  expect(spans.slice(1).map((s) => s.name)).toEqual([
    "等待模型重试",
    "开始模型重试",
  ]);
});

it("links batch collection results without trusting arbitrary tool output", () => {
  const spans = executionSpans([
    e(0, "tool/call", { name: "wait_for_tasks", callId: "wait" }),
    e(1, "tool/result", {
      message: {
        source: { callId: "wait" },
        content: [
          {
            type: "text",
            text: JSON.stringify({
              tasks: [{ task_id: "a" }, { task_id: "b" }, { task_id: "a" }],
            }),
          },
        ],
      },
    }),
  ]);
  expect(collaborationOperation(spans[0])).toBe("等待全部完成 · 仅返回状态");
  expect(collaborationOperation({ ...spans[0], name: "get_task_result" })).toBe(
    "按需读取最终结果",
  );
  expect(spanTaskIds(spans[0])).toEqual(["a", "b"]);
  expect(spanTaskIds({ ...spans[0], name: "list_agent_tasks" })).toEqual([
    "a",
    "b",
  ]);
  expect(spanTaskIds({ ...spans[0], name: "get_task_result" })).toEqual([
    "a",
    "b",
  ]);
  expect(spanTaskIds({ ...spans[0], name: "bash" })).toEqual([]);
});
