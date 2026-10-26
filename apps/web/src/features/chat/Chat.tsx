import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { useQueryClient } from "@tanstack/react-query";
import { Welcome, suggestions } from "./Welcome";
import { AffectTool } from "./AffectTool";
import { sendPrompt } from "./commands";
import { Thread } from "@/components/assistant-ui/elements/thread.aui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { api } from "@/lib/api";
import { connectEvents } from "@/lib/events";
import { toThreadMessages, useChat, type Snapshot } from "./store";

class HistoryBusy extends Error {}

function ToolCards({ children }: PropsWithChildren) {
  return <div className="flex flex-col gap-2">{children}</div>;
}
const components = { Welcome, ToolFallback: AffectTool, ToolGroup: ToolCards };

export function Chat({
  id,
  onUnauthorized,
}: {
  id: string;
  onUnauthorized: () => void;
}) {
  const state = useChat();
  const mounted = useRef(true);
  const query = useQueryClient();
  const source = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState(false);
  const messages = useMemo(
    () => toThreadMessages(state.messages, state.status),
    [state.messages, state.status],
  );

  function subscribe() {
    if (!mounted.current) return;
    source.current?.abort();
    source.current = connectEvents(`/api/conversations/${id}/events`, {
      update(data) {
        setConnectionError(false);
        const value = JSON.parse(data);
        if (value.type === "snapshot") {
          useChat.getState().snapshot(value);
          if (value.status !== "running") {
            void query.invalidateQueries({ queryKey: ["workspace"] });
            void query.invalidateQueries({ queryKey: ["conversations"] });
            return true;
          }
        } else if (value.type === "agent")
          useChat.getState().event(value.event);
        return false;
      },
      disconnected: () => setConnectionError(true),
      failed: (message) => {
        setConnectionError(false);
        useChat.setState({ error: message });
      },
      unauthorized: onUnauthorized,
    });
  }

  useEffect(() => {
    let alive = true;
    mounted.current = true;
    useChat.getState().reset();
    setLoading(true);
    void query
      .fetchQuery({
        queryKey: ["snapshot", id],
        staleTime: 0,
        retry: (count, error) => error instanceof HistoryBusy && count < 3,
        retryDelay: 1000,
        queryFn: async ({ signal }) => {
          const { data, error, response } = await api.GET(
            "/api/conversations/{conversation_id}",
            { params: { path: { conversation_id: id } }, signal },
          );
          if (response.status === 409)
            throw new HistoryBusy("执行环境正在读取，请重新打开对话。");
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
      mounted.current = false;
      source.current?.abort();
      useChat.getState().reset();
    };
    // Chat is keyed by conversation, keeping subscription ownership local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const runtime = useExternalStoreRuntime({
    messages,
    suggestions: messages.length === 0 ? suggestions : [],
    convertMessage: (message) => message,
    isRunning: state.status === "running",
    isLoading: loading,
    isDisabled: state.read_only,
    onNew: async (message) => {
      const text = message.content
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("\n");
      useChat.setState({ status: "running", error: null });
      try {
        await sendPrompt(id, text);
        if (!mounted.current) return;
        subscribe();
        void query.invalidateQueries({ queryKey: ["conversations"] });
      } catch (error) {
        if (!mounted.current) return;
        useChat.setState({ status: "failed", error: (error as Error).message });
      }
    },
    onCancel: async () => {
      const { error } = await api.POST(
        "/api/conversations/{conversation_id}/stop",
        { params: { path: { conversation_id: id } } },
      );
      if (error && mounted.current)
        useChat.setState({ error: "停止请求失败，请重试。" });
    },
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex min-h-0 flex-1 flex-col">
        {state.read_only && (
          <Alert className="mx-auto mt-3 max-w-3xl">
            <AlertDescription>
              此对话为只读。归档项目或会话请在侧栏恢复；旧 Pi
              历史请新建对话继续。
            </AlertDescription>
          </Alert>
        )}
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
