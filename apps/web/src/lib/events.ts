import { fetchEventSource } from "@microsoft/fetch-event-source";
import { expireToken, getToken } from "./session";

class FatalStreamError extends Error {}

type Callbacks = {
  update: (data: string) => boolean; // true means the run reached a terminal snapshot
  disconnected: () => void;
  failed: (message: string) => void;
  unauthorized: () => void;
};

export function connectEvents(
  url: string,
  callbacks: Callbacks,
): AbortController {
  const controller = new AbortController();
  const token = getToken();
  let retries = 0;
  const unauthorized = () => {
    controller.abort();
    if (getToken() !== token) return;
    expireToken(token);
    callbacks.unauthorized();
  };
  if (!token) {
    unauthorized();
    return controller;
  }
  void fetchEventSource(url, {
    signal: controller.signal,
    credentials: "omit",
    headers: { Authorization: `Bearer ${token}` },
    openWhenHidden: true,
    async onopen(response) {
      if (controller.signal.aborted)
        throw new FatalStreamError("Stream closed");
      if (response.status === 401) {
        unauthorized();
        throw new FatalStreamError("登录已过期，请重新登录。");
      }
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 429
      )
        throw new FatalStreamError("无法打开此对话，请刷新列表。");
      if (
        !response.ok ||
        !response.headers.get("content-type")?.startsWith("text/event-stream")
      )
        throw new Error("Stream unavailable");
    },
    onmessage(event) {
      if (controller.signal.aborted) return;
      if (event.event === "unauthorized") unauthorized();
      else if (event.event === "update") {
        retries = 0;
        if (callbacks.update(event.data)) controller.abort();
      }
    },
    onclose() {
      if (!controller.signal.aborted) throw new Error("Stream interrupted");
    },
    onerror(error) {
      if (controller.signal.aborted || error instanceof FatalStreamError)
        throw error;
      callbacks.disconnected();
      return Math.min(1000 * 2 ** retries++, 10000);
    },
  }).catch((error: Error) => {
    if (!controller.signal.aborted) callbacks.failed(error.message);
  });
  return controller;
}
