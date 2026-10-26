import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useChat, type PiMessage } from "./store";
import { RequestCard, QueueItem } from "./ActivityCards";
import type { Action, Activity } from "./activity-types";

export function ActivityPanel({
  id,
  running,
  enabled,
}: {
  id: string;
  running: boolean;
  enabled: boolean;
}) {
  const saved = useChat((state) => state.activity);
  const query = useQueryClient();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [childId, setChildId] = useState<string | null>(null);
  const activity = useQuery({
    queryKey: ["activity", id, running],
    enabled: enabled && running,
    refetchInterval: running ? 1200 : false,
    retry: 2,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/conversations/{conversation_id}/activity",
        { params: { path: { conversation_id: id } } },
      );
      if (error) throw new Error("运行状态暂不可用，稍后重试");
      return data as unknown as Activity;
    },
  });
  const child = useQuery({
    queryKey: ["child-history", id, childId],
    enabled: !!childId,
    refetchInterval: running ? 2000 : false,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/conversations/{conversation_id}/activity/children/{child_id}",
        { params: { path: { conversation_id: id, child_id: childId! } } },
      );
      if (error) throw new Error("子任务历史读取失败");
      return data as { messages: PiMessage[] };
    },
  });
  async function act(body: Action) {
    setPending(true);
    setError("");
    try {
      const { error } = await api.POST(
        "/api/conversations/{conversation_id}/activity",
        {
          params: { path: { conversation_id: id } },
          body: { mode: "queue", ...body },
        },
      );
      if (error)
        throw new Error("操作未成功，任务或请求可能已结束，请刷新后重试。");
      await query.invalidateQueries({ queryKey: ["activity", id] });
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setPending(false);
    }
  }
  const data = running ? activity.data : saved;
  if (!running && !data?.children.length && !error) return null;
  return (
    <section
      aria-label="运行面板"
      className="mx-auto w-full max-w-3xl shrink-0 space-y-2 px-4 pt-2 text-sm"
    >
      {(error || activity.isError) && (
        <p role="alert" className="text-destructive">
          {error || activity.error?.message}{" "}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void activity.refetch()}
          >
            刷新状态
          </Button>
        </p>
      )}
      <div className="max-h-[38vh] space-y-2 overflow-y-auto">
        {data?.requests.map((request) => (
          <RequestCard
            key={request.id}
            request={request}
            actor={
              request.sessionId === id
                ? undefined
                : data?.children.find((child) => child.id === request.sessionId)
                    ?.label || "子任务"
            }
            disabled={pending}
            act={act}
          />
        ))}
        {!!data?.children.length && (
          <details className="rounded-xl border p-3" open>
            <summary className="cursor-pointer font-medium">
              子任务 · {data.children.length}
            </summary>
            {data.children.map((item) => (
              <div key={item.id} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate">
                  {item.label || item.id}
                </span>
                <span className="text-muted-foreground">
                  {item.kind === "diagnostic"
                    ? "状态不可用"
                    : item.running
                      ? "运行中"
                      : item.projections?.values?.subagentTiming
                            ?.lastTurnCompleted === false
                        ? "未完成"
                        : item.projections?.values?.subagentTiming
                              ?.lastTurnCompleted === true
                          ? "已完成"
                          : "空闲"}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={
                    item.kind === "diagnostic" || item.mode === "external"
                  }
                  onClick={() =>
                    setChildId(childId === item.id ? null : item.id)
                  }
                >
                  查看过程
                </Button>
                {running && item.running && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      void act({ kind: "child-stop", child_id: item.id })
                    }
                  >
                    停止子任务
                  </Button>
                )}
              </div>
            ))}
            {childId && (
              <div
                aria-label="子任务过程"
                className="max-h-48 space-y-2 overflow-auto rounded-lg bg-muted p-3"
              >
                {child.isError
                  ? child.error.message
                  : child.isPending
                    ? "正在读取…"
                    : child.data?.messages.map((m, i) => (
                        <div key={i}>
                          <span className="text-xs text-muted-foreground">
                            {m.role}
                          </span>
                          <pre className="whitespace-pre-wrap text-xs">
                            {typeof m.content === "string"
                              ? m.content
                              : m.content
                                  .map(
                                    (p) =>
                                      p.text ||
                                      p.thinking ||
                                      (p.name
                                        ? `${p.name} ${JSON.stringify(p.arguments)}`
                                        : ""),
                                  )
                                  .join("\n")}
                          </pre>
                        </div>
                      ))}
              </div>
            )}
          </details>
        )}
        {(["next-step", "next-turn"] as const).map((target) =>
          data?.inbox[target]?.map((item) => (
            <QueueItem
              key={item.id}
              item={item}
              target={target}
              disabled={pending}
              act={act}
            />
          )),
        )}
      </div>
      {running && (
        <form
          className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/30 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            void act({ kind: "prompt", text, mode: "queue" }).then((ok) => {
              if (ok) setText("");
            });
          }}
        >
          <Input
            aria-label="运行中补充消息"
            placeholder="补充要求，等待当前轮结束后执行…"
            value={text}
            maxLength={32000}
            onChange={(e) => setText(e.target.value)}
            className="min-w-40 flex-1"
          />
          <Button size="sm" type="submit" disabled={pending || !text.trim()}>
            加入队列
          </Button>
          <Button
            size="sm"
            type="button"
            variant="outline"
            disabled={pending || !text.trim()}
            onClick={() =>
              void act({ kind: "prompt", text, mode: "steer" }).then((ok) => {
                if (ok) setText("");
              })
            }
          >
            插入下一步
          </Button>
        </form>
      )}
    </section>
  );
}
