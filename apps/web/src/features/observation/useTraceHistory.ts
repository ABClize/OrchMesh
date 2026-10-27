import { useEffect, useRef, useState } from "react";
import { platformRequest } from "@/lib/platform";
import {
  isActive,
  mergeHistory,
  type Call,
  type EventPage,
  type ObservedEvent,
} from "./model";

export type TraceHistory = {
  events: ObservedEvent[];
  after: number;
  available: boolean | null;
  loading: boolean;
  error?: string;
  settled?: boolean;
};
/** Only expanded calls are read, with bounded HTTP concurrency and cursor replay. */
export function useTraceHistory(calls: Call[], expanded: ReadonlySet<string>) {
  const cache = useRef<Record<string, TraceHistory>>({});
  const [histories, setHistories] = useState<Record<string, TraceHistory>>({});
  const [attempt, setAttempt] = useState(0);
  const targets = calls.filter((call) => expanded.has(call.id));
  const key = JSON.stringify(
    targets.map((call) => [call.id, isActive(call.status)]),
  );
  useEffect(() => {
    const entries = JSON.parse(key) as [string, boolean][];
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const publish = () => {
      if (!controller.signal.aborted) setHistories({ ...cache.current });
    };
    const cycle = async () => {
      const queue = entries.filter(
        ([id, active]) => active || !cache.current[id]?.settled,
      );
      async function worker() {
        while (queue.length && !controller.signal.aborted) {
          const [id, active] = queue.shift()!;
          const old = cache.current[id] ?? {
            events: [],
            after: -1,
            available: null,
            loading: true,
          };
          cache.current[id] = {
            ...old,
            loading: old.available === null,
            error: undefined,
          };
          publish();
          try {
            const page = await platformRequest<EventPage>(
              `/tasks/${encodeURIComponent(id)}/history?after=${old.after}&limit=200`,
              "GET",
              undefined,
              controller.signal,
            );
            if (controller.signal.aborted) return;
            cache.current[id] = {
              events: mergeHistory(old.events, page, id),
              after: Math.max(old.after, page.next_after),
              available: page.log_available,
              loading: page.has_more,
              settled: !active && !page.has_more,
            };
          } catch (error) {
            if (controller.signal.aborted) return;
            cache.current[id] = {
              ...old,
              loading: false,
              error: String(error),
            };
          }
          publish();
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(3, queue.length) }, worker),
      );
      if (controller.signal.aborted) return;
      if (
        entries.some(([id, active]) => active || !cache.current[id]?.settled)
      ) {
        timer = setTimeout(
          () => void cycle(),
          entries.some(([id]) => cache.current[id]?.loading) ? 50 : 1500,
        );
      }
    };
    void cycle();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [key, attempt]);
  return { histories, retry: () => setAttempt((n) => n + 1) };
}
