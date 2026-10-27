import { ReasoningSettings } from "./ReasoningSettings";
import { TaskInputs } from "../platform/TaskInputs";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useAgentGraph } from "@/features/observation/hooks";
import { scopeGraph, isActive } from "@/features/observation/model";
import {
  FeedNotice,
  LoadingObservation,
} from "@/features/observation/Feedback";
import {
  ObservationWorkspace,
  type Selection,
} from "@/features/observation/ObservationWorkspace";
import { useFiles } from "@/features/workspace/files";
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
import { useIsMutating, useQueryClient } from "@tanstack/react-query";
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
  active = true,
  archived = false,
  reasoning = "default",
  modelId,
}: {
  id: string;
  onUnauthorized: () => void;
  active?: boolean;
  archived?: boolean;
  reasoning?: string;
  modelId?: string | null;
}) {
  const state = useChat();
  const savingModel =
    useIsMutating({ mutationKey: ["model-preference", id] }) > 0;
  const readOnly = !!state.read_only || archived;
  const [view, setView] = useState("chat");
  const [selection, setSelection] = useState<Selection>(null);
  const graph = useAgentGraph(id, active);
  const filesOpen = useFiles((s) => s.open);
  const latestRoot = graph.data.calls.filter((c) => !c.parent_id).at(-1);
  const latest = scopeGraph(graph.data, latestRoot?.id ?? null);
  const waiting = latest.calls.filter((c) => c.activity === "waiting_user");
  function showObservation(taskId?: string) {
    useFiles.getState().close();
    if (taskId) setSelection({ kind: "task", id: taskId });
    setView("observation");
  }
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
    isDisabled: readOnly || savingModel,
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
        throw error;
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
        {readOnly && (
          <Alert className="mx-auto mt-3 max-w-3xl">
            <AlertDescription>
              此对话为只读。历史对话请从菜单创建分支；归档对话可恢复后继续。
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
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
          <Tabs
            value={view}
            onValueChange={(value) => {
              if (value === "observation") showObservation();
              else setView(value);
            }}
          >
            <TabsList aria-label="对话视图">
              <TabsTrigger value="chat">对话</TabsTrigger>
              <TabsTrigger value="observation">协作</TabsTrigger>
            </TabsList>
          </Tabs>
          {waiting.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => showObservation(waiting[0].id)}
            >
              {waiting.length} 次调用待回答
            </Button>
          )}
        </div>
        <div className="px-4 pt-2">
          <FeedNotice {...graph} />
        </div>
        <div
          hidden={view !== "chat"}
          className="chat-conversation-view min-h-0 flex-1 flex-col"
        >
          {latest.calls.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-4 py-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => showObservation()}
              >
                {latest.nodes.length} 个智能体参与 ·{" "}
                {latest.calls.filter((c) => isActive(c.status)).length}{" "}
                次调用进行中 · 查看协作
              </Button>
            </div>
          )}
          <Thread
            components={components}
            readOnly={readOnly}
            composerActions={
              !readOnly ? (
                <>
                  <TaskInputs
                    id={id}
                    disabled={loading || state.status === "running"}
                  />
                  <ReasoningSettings
                    id={id}
                    value={reasoning}
                    modelId={modelId}
                    running={loading || state.status === "running"}
                  />
                </>
              ) : undefined
            }
          />
        </div>
        <div
          hidden={view !== "observation" || !active || filesOpen}
          className="min-h-0 flex-1 overflow-auto"
        >
          {graph.connection === "connecting" && !graph.data.calls.length ? (
            <LoadingObservation />
          ) : graph.connection === "error" &&
            !graph.data.calls.length ? null : (
            <ObservationWorkspace
              active={view === "observation" && active && !filesOpen}
              live={graph.connection === "live"}
              graph={graph.data}
              readOnly={readOnly}
              selection={selection}
              onSelect={setSelection}
            />
          )}
        </div>
        {view === "observation" && filesOpen && (
          <div className="p-6">
            <p className="mb-3 text-sm text-muted-foreground">
              正在预览调用中的文件。
            </p>
            <Button
              variant="outline"
              onClick={() => useFiles.getState().close()}
            >
              返回协作详情
            </Button>
          </div>
        )}
      </div>
    </AssistantRuntimeProvider>
  );
}
