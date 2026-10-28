import { useQuery } from "@tanstack/react-query";
import { platformRequest } from "@/lib/platform";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
type Snapshot = {
  captured_at: string;
  model: string;
  sections: { name: string; source: string; text: string }[];
  system_messages: unknown[];
  runtime_context: unknown;
  continuation_messages: unknown[];
  continuation_configured: string;
  tools: { name: string; source: string; description?: string }[];
  tool_history: unknown;
  bound_skills?: unknown[];
  skill_messages?: unknown[];
};
function JsonContent({ value }: { value: unknown }) {
  return (
    <pre className="max-h-96 overflow-auto rounded-lg bg-muted/40 p-3 text-xs whitespace-pre-wrap break-words">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
function readable(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(readable);
  if (!value || typeof value !== "object") return [];
  const item = value as Record<string, unknown>;
  if (typeof item.text === "string") return [item.text];
  if (item.content) return readable(item.content);
  return [];
}
function ReadableContent({ value }: { value: unknown }) {
  const text = readable(value).join("\n\n");
  return (
    <div className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-sm leading-6">
      {text || "没有可显示的文本。原始记录可在调试信息中查看。"}
    </div>
  );
}
function sectionTitle(name: string) {
  const titles: Record<string, string> = {
    "orchmesh-definition": "智能体职责",
    "orchmesh-task_prompt": "本次任务",
    "orchmesh-conversation_history": "对话历史",
    "orchmesh-user_memory": "个人记忆",
    "orchmesh-collaboration": "协作信息",
    "orchmesh-platform": "公共规则",
    "harness:identity": "基础身份",
    "deployment:persona-prefix": "基础行为规则",
    "deployment:persona-suffix": "补充行为规则",
  };
  return (
    titles[name] ??
    (name.startsWith("tool:") ? "工具说明 · " + name.slice(5) : "运行指令")
  );
}
export function EffectivePrompt({ taskId }: { taskId: string }) {
  const query = useQuery({
    queryKey: ["effective-prompt", taskId],
    queryFn: ({ signal }) =>
      platformRequest<{ available: boolean; snapshot: Snapshot | null }>(
        `/tasks/${taskId}/effective-prompt`,
        "GET",
        undefined,
        signal,
      ),
  });
  const snapshot = query.data?.snapshot;
  return (
    <section aria-label="最终提示词" className="flex min-w-0 flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          这里显示这次任务实际发送给模型的指令，供核对和排查问题。只能查看，修改请前往「提示词设置」。
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          刷新记录
        </Button>
      </div>
      {query.isPending && <p role="status">正在读取实际提示词…</p>}
      {query.error && (
        <Alert variant="destructive">
          <AlertDescription>{query.error.message}</AlertDescription>
        </Alert>
      )}
      {query.data && !query.data.available && (
        <p role="status">
          暂无记录。任务开始调用模型后，这里会显示实际使用的指令；较早的任务可能没有记录。
        </p>
      )}
      {snapshot && (
        <>
          <p className="text-xs text-muted-foreground">
            模型：{snapshot.model} · 记录时间：
            {new Date(snapshot.captured_at).toLocaleString()}
          </p>
          <details open>
            <summary className="cursor-pointer font-medium">
              系统提示词分段与来源（{snapshot.sections.length}）
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              {snapshot.sections.map((part) => (
                <details key={part.name} className="rounded-lg border p-3">
                  <summary className="cursor-pointer text-sm">
                    {sectionTitle(part.name)}
                  </summary>
                  <p className="mt-2 text-xs text-muted-foreground">
                    来源：{part.source}
                  </p>
                  <pre className="mt-3 max-h-80 overflow-auto text-sm whitespace-pre-wrap break-words">
                    {part.text}
                  </pre>
                </details>
              ))}
            </div>
          </details>
          <details>
            <summary className="cursor-pointer">
              实际系统消息 · 完整内容
            </summary>
            <ReadableContent value={snapshot.system_messages} />
          </details>
          <details>
            <summary className="cursor-pointer">本次执行参考的信息</summary>
            <ReadableContent value={snapshot.runtime_context} />
          </details>
          <details>
            <summary className="cursor-pointer">
              任务恢复提示 ·{" "}
              {snapshot.continuation_messages.length
                ? "已发送"
                : "此请求历史中未发送"}
            </summary>
            <p className="my-2 text-xs text-muted-foreground">
              任务中断后继续执行时使用的指令：
            </p>
            <pre className="whitespace-pre-wrap break-words text-xs">
              {snapshot.continuation_configured}
            </pre>
            <p className="my-2 text-xs text-muted-foreground">
              请求历史中的实际恢复消息：
            </p>
            <ReadableContent value={snapshot.continuation_messages} />
          </details>
          <details>
            <summary className="cursor-pointer">
              工具定义与来源（{snapshot.tools.length}）
            </summary>
            {snapshot.tools.map((tool) => (
              <details key={tool.name} className="mt-2 rounded-lg border p-3">
                <summary className="cursor-pointer text-sm">
                  {tool.name} · {tool.source}
                </summary>
                <p className="mt-2 text-sm">
                  {tool.description || "无补充说明"}
                </p>
              </details>
            ))}
          </details>
          <details>
            <summary className="cursor-pointer">
              本次使用的 Skills 与读取内容（{snapshot.bound_skills?.length ?? 0}
              ）
            </summary>

            <ReadableContent value={snapshot.skill_messages ?? []} />
          </details>
          <details>
            <summary className="cursor-pointer">调试信息 · 原始记录</summary>
            <JsonContent value={snapshot} />
          </details>
        </>
      )}
    </section>
  );
}
