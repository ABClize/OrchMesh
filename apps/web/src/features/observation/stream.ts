import {
  fetchEventSource,
  type EventSourceMessage,
} from "@microsoft/fetch-event-source";
import { expireToken, getToken } from "@/lib/session";
export type Connection =
  "connecting" | "live" | "reconnecting" | "done" | "error";
class FatalStreamError extends Error {}
export function observeStream(
  path: string,
  options: {
    signal: AbortSignal;
    message: (event: EventSourceMessage) => void;
    connection: (state: Connection, error?: string) => void;
  },
) {
  const token = getToken();
  let retries = 0;
  const unauthorized = () => {
    expireToken(token);
    throw new FatalStreamError("登录已过期，请重新登录。");
  };
  return fetchEventSource(path, {
    signal: options.signal,
    credentials: "omit",
    openWhenHidden: true,
    headers: { Authorization: `Bearer ${token}` },
    async onopen(response) {
      if (response.status === 401) unauthorized();
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 429
      )
        throw new FatalStreamError(
          response.status === 404
            ? "无法访问此记录，可能不存在或没有权限。"
            : "无法读取记录，请重新打开后重试。",
        );
      if (
        !response.ok ||
        !response.headers.get("content-type")?.startsWith("text/event-stream")
      )
        throw new Error("连接暂时不可用");
      options.connection("live");
    },
    onmessage(event) {
      if (options.signal.aborted) return;
      if (event.event === "unauthorized") unauthorized();
      if (event.event === "unavailable") throw new Error("暂时无法读取记录");
      options.message(event);
      retries = 0;
      options.connection(event.event === "done" ? "done" : "live");
    },
    onclose() {
      if (!options.signal.aborted) throw new Error("连接中断");
    },
    onerror(error) {
      if (options.signal.aborted || error instanceof FatalStreamError)
        throw error;
      options.connection("reconnecting");
      return Math.min(1000 * 2 ** retries++, 15000);
    },
  }).catch((error: Error) => {
    if (!options.signal.aborted) options.connection("error", error.message);
  });
}
