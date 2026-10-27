// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useTraceHistory } from "./useTraceHistory";
import { platformRequest } from "@/lib/platform";
import type { Call } from "./model";
vi.mock("@/lib/platform", () => ({ platformRequest: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const call = { id: "a", status: "completed" } as Call;
test("lazy history drains pagination and aborts on collapse", async () => {
  vi.mocked(platformRequest)
    .mockResolvedValueOnce({
      events: [],
      next_after: 200,
      has_more: true,
      log_available: true,
    })
    .mockResolvedValueOnce({
      events: [],
      next_after: 201,
      has_more: false,
      log_available: true,
    });
  const hook = renderHook(({ expanded }) => useTraceHistory([call], expanded), {
    initialProps: { expanded: new Set<string>() },
  });
  expect(platformRequest).not.toHaveBeenCalled();
  hook.rerender({ expanded: new Set(["a"]) });
  await waitFor(() =>
    expect(hook.result.current.histories.a?.settled).toBe(true),
  );
  expect(vi.mocked(platformRequest).mock.calls[1][0]).toContain("after=200");
  const signal = vi.mocked(platformRequest).mock.calls[0][3];
  hook.rerender({ expanded: new Set() });
  expect(signal?.aborted).toBe(true);
  hook.rerender({ expanded: new Set(["a"]) });
  expect(platformRequest).toHaveBeenCalledTimes(2);
});
