import { useEffect, useMemo, useRef, useState } from "react";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { useQueryClient } from "@tanstack/react-query";
import { Thread } from "@/components/assistant-ui/elements/thread.aui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { api } from "@/lib/api";
import { toThreadMessages, useChat, type Snapshot } from "./store";

function Welcome() {
  return (
    <div className="flex flex-col gap-3 px-6 py-12 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">从一个想法开始</h1>
      <p className="text-muted-foreground">
        让 Pi 帮你分析问题、读写文件，或运行命令。
      </p>
    </div>
  );
}
const components = { Welcome };

export function Chat({
  id,
  onUnauthorized,
}: {
  id: string;
  onUnauthorized: () => void;
}) {
  const state = useChat();
  const query = useQueryClient();
  const source = useRef<EventSource | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState(false);
  const messages = useMemo(
    () => toThreadMessages(state.messages),
    [state.messages],
  );

  function subscribe() {
    source.current?.close();
    const stream = new EventSource(`/api/conversations/${id}/events`);
    source.current = stream;
    stream.addEventListener("update", (event: MessageEvent) => {
      setConnectionError(false);
      const value = JSON.parse(event.data);
      if (value.type === "snapshot") {
        useChat.getState().snapshot(value);
        if (value.status !== "running") {
          stream.close();
          void query.invalidateQueries({ queryKey: ["conversations"] });
        }
      } else if (value.type === "pi") useChat.getState().event(value.event);
    });
    stream.addEventListener("unauthorized", () => {
      stream.close();
      onUnauthorized();
    });
    stream.onerror = () => {
      setConnectionError(true);
      // EventSource reconnects; check auth because a rejected handshake has no SSE body.
      void api.GET("/api/me").then(({ response }) => {
        if (response.status === 401) {
          stream.close();
          onUnauthorized();
        }
      });
    };
  }

  useEffect(() => {
    let alive = true;
    useChat.getState().reset();
    setLoading(true);
    void query
      .fetchQuery({
        queryKey: ["snapshot", id],
        staleTime: 0,
        queryFn: async () => {
          const { data, error } = await api.GET(
            "/api/conversations/{conversation_id}",
            { params: { path: { conversation_id: id } } },
          );
          if (error) throw new Error("读取对话失败，请稍后重试。");
          return data as Snapshot;
        },
      })
      .then((data) => {
        if (!alive) return;
        useChat.getState().snapshot(data);
        if (data.status === "running") subscribe();
      })
      .catch((error: Error) => {
        if (alive) useChat.setState({ error: error.message });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      source.current?.close();
      useChat.getState().reset();
    };
    // Chat is keyed by conversation, keeping subscription ownership local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage: (message) => message,
    isRunning: state.status === "running",
    isLoading: loading,
    onNew: async (message) => {
      const text = message.content
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("\n");
      useChat.setState({ status: "running", error: null });
      try {
        const { error, response } = await api.POST(
          "/api/conversations/{conversation_id}/runs",
          {
            params: { path: { conversation_id: id } },
            body: { text },
          },
        );
        if (error)
          throw new Error(
            response.status === 409
              ? "已有任务运行，请稍后再试。"
              : "发送失败，请检查连接。",
          );
        subscribe();
        void query.invalidateQueries({ queryKey: ["conversations"] });
      } catch (error) {
        useChat.setState({ status: "failed", error: (error as Error).message });
      }
    },
    onCancel: async () => {
      const { error } = await api.POST(
        "/api/conversations/{conversation_id}/stop",
        { params: { path: { conversation_id: id } } },
      );
      if (error) useChat.setState({ error: "停止请求失败，请重试。" });
    },
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex min-h-0 flex-1 flex-col">
        {(state.error || connectionError || state.status === "stopped") && (
          <Alert className="mx-auto mt-3 max-w-3xl">
            <AlertDescription>
              {state.error ||
                (connectionError
                  ? "连接中断，正在重连；任务仍在后台运行。"
                  : "已停止。已经完成的文件操作不会回滚。")}
            </AlertDescription>
          </Alert>
        )}
        <Thread components={components} />
      </div>
    </AssistantRuntimeProvider>
  );
}
