import { useMemo } from "react";
import { TraceWaterfall } from "@/components/trace-waterfall/TraceWaterfall";
import { Button } from "@/components/ui/button";
import {
  collaborationOperation,
  executionSpans,
  spanTaskIds,
} from "./traceModel";
import { activityLabel, type ObservedEvent } from "./model";
export function ExecutionHistory({
  events,
  available,
  live = false,
  running = false,
  activity,
  onSelectTask,
}: {
  events: ObservedEvent[];
  available: boolean | null;
  live?: boolean;
  running?: boolean;
  activity?: string;
  onSelectTask?: (id: string) => void;
}) {
  const spans = useMemo(() => executionSpans(events), [events]);
  if (!events.length)
    return (
      <p className="p-4 text-sm text-muted-foreground">
        {available === false
          ? "执行记录尚未可用。"
          : "暂无已持久保存的执行记录。实时输出可能先于记录出现。"}
      </p>
    );
  return (
    <TraceWaterfall
      spans={spans}
      live={live}
      running={running}
      statusLabel={activity ? activityLabel(activity) : undefined}
      renderDetail={(span) => (
        <ExecutionRecordDetail span={span} onSelectTask={onSelectTask} />
      )}
    />
  );
}

export function ExecutionRecordDetail({
  span,
  onSelectTask,
}: {
  span: import("./traceModel").ExecutionSpan;
  onSelectTask?: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {collaborationOperation(span) && (
        <p className="text-sm text-muted-foreground">
          {collaborationOperation(span)}
        </p>
      )}
      {onSelectTask &&
        spanTaskIds(span).map((id) => (
          <Button
            key={id}
            variant="link"
            className="justify-start"
            onClick={() => onSelectTask(id)}
          >
            查看协作调用 · {id.slice(-6)}
          </Button>
        ))}
      {span.events.map((event) => (
        <details key={event.seq}>
          <summary className="cursor-pointer py-2">
            {event.type} · #{event.seq} ·{" "}
            {new Date(event.time).toLocaleTimeString("zh-CN")}
          </summary>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">
            {JSON.stringify(event.data, null, 2)}
          </pre>
        </details>
      ))}
    </div>
  );
}
