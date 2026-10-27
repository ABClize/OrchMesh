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
};
function JsonContent({ value }: { value: unknown }) {
  return (
    <pre className="max-h-96 overflow-auto rounded-lg bg-muted/40 p-3 text-xs whitespace-pre-wrap break-words">
      {JSON.stringify(value, null, 2)}
    </pre>
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
          只读 · 最近一次 DSH
          模型请求边界记录。不是当前设置的预览，也不是供应商内部提示词。
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
          暂无实际请求记录。任务尚未请求模型，或来自启用此功能之前；不会用当前设置补造历史。
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
                    {part.name} · {part.source}
                  </summary>
                  <pre className="mt-3 max-h-80 overflow-auto text-xs whitespace-pre-wrap break-words">
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
            <JsonContent value={snapshot.system_messages} />
          </details>
          <details>
            <summary className="cursor-pointer">
              DSH 动态上下文 · 最近生效消息
            </summary>
            <JsonContent value={snapshot.runtime_context} />
          </details>
          <details>
            <summary className="cursor-pointer">
              任务恢复提示 ·{" "}
              {snapshot.continuation_messages.length
                ? "已发送"
                : "此请求历史中未发送"}
            </summary>
            <p className="my-2 text-xs text-muted-foreground">
              配置快照（仅恢复执行时使用）：
            </p>
            <pre className="whitespace-pre-wrap break-words text-xs">
              {snapshot.continuation_configured}
            </pre>
            <p className="my-2 text-xs text-muted-foreground">
              请求历史中的实际恢复消息：
            </p>
            <JsonContent value={snapshot.continuation_messages} />
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
                <JsonContent value={tool} />
              </details>
            ))}
          </details>
          <details>
            <summary className="cursor-pointer">DSH 工具历史元数据</summary>
            <JsonContent value={snapshot.tool_history} />
          </details>
        </>
      )}
    </section>
  );
}
