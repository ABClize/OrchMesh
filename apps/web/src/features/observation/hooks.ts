import { useEffect, useRef, useState } from "react";
import { platformRequest } from "@/lib/platform";
import { observeStream, type Connection } from "./stream";
import {
  emptyGraph,
  mergeHistory,
  type AgentGraph,
  type TaskDetail,
  type EventPage,
  type ObservedEvent,
} from "./model";

type Feed<T> = { data: T; connection: Connection; error?: string };
export function useAgentGraph(conversationId: string, enabled: boolean) {
  const [feed, setFeed] = useState<Feed<AgentGraph>>({
    data: emptyGraph,
    connection: "connecting",
  });
  const [attempt, retry] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const path = `/conversations/${encodeURIComponent(conversationId)}/graph`;
    setFeed((previous) => ({ data: previous.data, connection: "connecting" }));
    // GET exposes immediate 404/route errors; then the first SSE snapshot is authoritative.
    void platformRequest<AgentGraph>(path, "GET", undefined, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setFeed({ data, connection: "connecting" });
        void observeStream(`/api${path}/events`, {
          signal: controller.signal,
          message: (event) => {
            if (event.event === "graph")
              setFeed({
                data: JSON.parse(event.data) as AgentGraph,
                connection: "live",
              });
          },
          connection: (connection, error) => {
            if (!controller.signal.aborted)
              setFeed((previous) => ({ ...previous, connection, error }));
          },
        });
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted)
          setFeed((previous) => ({
            ...previous,
            connection: "error",
            error: error.message,
          }));
      });
    return () => controller.abort();
  }, [conversationId, enabled, attempt]);
  return { ...feed, retry: () => retry((n) => n + 1) };
}
export function useTaskObservation(taskId: string) {
  const [feed, setFeed] = useState<Feed<TaskDetail | null>>({
    data: null,
    connection: "connecting",
  });
  const cursor = useRef(-1);
  const [history, setHistory] = useState<ObservedEvent[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [attempt, retry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    // The inspector is keyed by task ID. Manual retry preserves already displayed events.
    setFeed((previous) => ({
      ...previous,
      connection: "connecting",
      error: undefined,
    }));
    void platformRequest<TaskDetail>(
      `/tasks/${encodeURIComponent(taskId)}`,
      "GET",
      undefined,
      controller.signal,
    )
      .then(async (data) => {
        if (controller.signal.aborted) return;
        setFeed({ data, connection: "connecting" });
        const page = await platformRequest<EventPage>(
          `/tasks/${encodeURIComponent(taskId)}/history?after=${cursor.current}&limit=100`,
          "GET",
          undefined,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        cursor.current = Math.max(cursor.current, page.next_after);
        setHistory((previous) => mergeHistory(previous, page, taskId));
        setAvailable(page.log_available);
        void observeStream(
          `/api/tasks/${encodeURIComponent(taskId)}/events?after=${cursor.current}`,
          {
            signal: controller.signal,
            message: (event) => {
              if (event.event === "snapshot")
                setFeed({
                  data: JSON.parse(event.data) as TaskDetail,
                  connection: "live",
                });
              if (event.event === "history") {
                const page = JSON.parse(event.data) as EventPage;
                cursor.current = Math.max(cursor.current, page.next_after);
                setHistory((previous) => mergeHistory(previous, page, taskId));
                setAvailable(page.log_available);
              }
              if (event.event === "done") {
                setFeed((previous) => ({ ...previous, connection: "done" }));
                controller.abort();
              }
            },
            connection: (connection, error) => {
              if (!controller.signal.aborted)
                setFeed((previous) => ({ ...previous, connection, error }));
            },
          },
        );
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted)
          setFeed((previous) => ({
            ...previous,
            connection: "error",
            error: error.message,
          }));
      });
    return () => controller.abort();
  }, [taskId, attempt]);
  return { ...feed, history, available, retry: () => retry((n) => n + 1) };
}
