// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { observeStream } from "./stream";
import { getToken, setToken } from "@/lib/session";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});
function response(text: string) {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
test("reconnect uses server history ID even when the page has no visible events", async () => {
  vi.useFakeTimers();
  setToken("test-only-token");
  const controller = new AbortController();
  const seen: Record<string, string>[] = [];
  const fetcher = vi.fn(async (_path: unknown, init?: RequestInit) => {
    seen.push({ ...(init?.headers as Record<string, string>) });
    return seen.length === 1
      ? response(
          'event: history\nid: task:15\ndata: {"events":[],"next_after":15}\n\nevent: unavailable\ndata: {}\n\n',
        )
      : response('event: done\ndata: {"after":15}\n\n');
  });
  vi.stubGlobal("fetch", fetcher);
  const states: string[] = [];
  const done = observeStream("/api/tasks/task/events?after=-1", {
    signal: controller.signal,
    message: (event) => {
      if (event.event === "done") controller.abort();
    },
    connection: (state) => states.push(state),
  });
  await vi.advanceTimersByTimeAsync(1100);
  await done;
  expect(seen[0].Authorization).toBe("Bearer test-only-token");
  expect(seen[1]["last-event-id"]).toBe("task:15");
  expect(states).toContain("reconnecting");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
test("401 ends reconnect and expires only the token that opened the stream", async () => {
  setToken("old-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      setToken("new-token");
      return new Response("", { status: 401 });
    }),
  );
  const states: string[] = [];
  await observeStream("/api/tasks/task/events", {
    signal: new AbortController().signal,
    message: () => {},
    connection: (state) => states.push(state),
  });
  expect(getToken()).toBe("new-token");
  expect(states.at(-1)).toBe("error");
});
