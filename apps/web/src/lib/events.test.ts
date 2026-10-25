// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectEvents } from "./events";
import { expireToken, getToken, setToken, watchSession } from "./session";

const encoder = new TextEncoder();
const sse = (text: string) =>
  new Response(
    new ReadableStream({
      start(controller) {
        // Exercise the upstream parser across transport chunk boundaries.
        for (let i = 0; i < text.length; i += 3)
          controller.enqueue(encoder.encode(text.slice(i, i + 3)));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
const callbacks = () => ({
  update: vi.fn<(data: string) => boolean>(() => false),
  disconnected: vi.fn(),
  failed: vi.fn(),
  unauthorized: vi.fn(),
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("authenticated SSE", () => {
  it("uses a bearer header, parses split frames, and stops at a final snapshot", async () => {
    setToken("test-token");
    const fetch = vi
      .fn()
      .mockResolvedValue(
        sse(
          'event: update\ndata: {"status":"running"}\n\nevent: update\ndata: {"status":"stopped"}\n\n',
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const cb = callbacks();
    cb.update.mockImplementation(
      (data: string) => JSON.parse(data).status === "stopped",
    );
    const controller = connectEvents("/api/conversations/test/events", cb);
    await vi.waitFor(() => expect(cb.update).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls[0][0]).toBe("/api/conversations/test/events");
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer test-token",
    );
    expect(fetch.mock.calls[0][1].credentials).toBe("omit");
    expect(controller.signal.aborted).toBe(true);
    expect(cb.disconnected).not.toHaveBeenCalled();
  });
  it("stops on an expired token instead of retrying authentication forever", async () => {
    setToken("expired");
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    const cb = callbacks();
    connectEvents("/api/conversations/test/events", cb);
    await vi.waitFor(() => expect(cb.unauthorized).toHaveBeenCalledOnce());
    expect(getToken()).toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
    expect(cb.disconnected).not.toHaveBeenCalled();
  });
  it("reconnects after EOF and accepts a fresh snapshot", async () => {
    setToken("token");
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        sse('event: update\ndata: {"status":"running"}\n\n'),
      )
      .mockResolvedValueOnce(
        sse('event: update\ndata: {"status":"completed"}\n\n'),
      );
    vi.stubGlobal("fetch", fetch);
    const cb = callbacks();
    cb.update.mockImplementation(
      (data: string) => JSON.parse(data).status === "completed",
    );
    const controller = connectEvents("/api/conversations/test/events", cb);
    try {
      await vi.waitFor(() => expect(controller.signal.aborted).toBe(true), {
        timeout: 3000,
      });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(cb.disconnected).toHaveBeenCalledOnce();
    } finally {
      controller.abort();
    }
  });
  it("aborts a pending request when the view is closed", async () => {
    setToken("token");
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, init) => {
        signal = init.signal;
        return new Promise((_resolve, reject) =>
          signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          ),
        );
      }),
    );
    const cb = callbacks();
    const controller = connectEvents("/api/conversations/test/events", cb);
    controller.abort();
    expect(signal?.aborted).toBe(true);
    await Promise.resolve();
    expect(cb.disconnected).not.toHaveBeenCalled();
  });
});

it("logout is local and delayed failures cannot erase a new login", () => {
  setToken("new-token");
  expireToken("old-token");
  expect(getToken()).toBe("new-token");
  const callback = vi.fn();
  const unwatch = watchSession(callback);
  setToken(null);
  expect(getToken()).toBeNull();
  expect(callback).toHaveBeenCalledOnce();
  window.dispatchEvent(new StorageEvent("storage", { key: "access_token" }));
  expect(callback).toHaveBeenCalledTimes(2);
  unwatch();
});

it("a late 401 from an old stream does not clear a new login", async () => {
  setToken("old-token");
  let respond!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          respond = resolve;
        }),
    ),
  );
  const cb = callbacks();
  const controller = connectEvents("/api/conversations/old/events", cb);
  setToken("new-token");
  respond(new Response(null, { status: 401 }));
  await vi.waitFor(() => expect(controller.signal.aborted).toBe(true));
  expect(getToken()).toBe("new-token");
  expect(cb.unauthorized).not.toHaveBeenCalled();
});
