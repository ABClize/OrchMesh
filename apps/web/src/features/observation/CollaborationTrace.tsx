import { useState } from "react";
import { TraceWaterfall } from "@/components/trace-waterfall/TraceWaterfall";
import { Button } from "@/components/ui/button";
import { type Call, isActive, countsLabel } from "./model";
import { collaborationSpans, type CollaborationSpan } from "./fullTraceModel";
import { useTraceHistory } from "./useTraceHistory";
export function CollaborationTrace({
  calls,
  live,
  onSelect,
  selectedId,
}: {
  calls: Call[];
  live: boolean;
  onSelect: (span: CollaborationSpan) => void;
  selectedId?: string | null;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { histories, retry } = useTraceHistory(calls, expanded);
  const spans = collaborationSpans(calls, histories, expanded);
  return (
    <div className="collaboration-trace">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          所有 Agent 共用时间轴 · 展开查看工具与等待
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const selected = spans.find((span) => span.id === selectedId);
            if (selected?.kind !== "agent" && selected) {
              const agent = spans.find((span) => span.id === selected.taskId);
              if (agent) onSelect(agent);
            }
            setExpanded(new Set());
          }}
        >
          收起执行记录
        </Button>
      </div>
      <TraceWaterfall
        spans={spans}
        live={live && calls.some((call) => isActive(call.status))}
        running={false}
        title="全链路 Trace"
        statusLabel={
          live
            ? countsLabel(
                calls.reduce<Record<string, number>>((counts, call) => {
                  counts[call.activity] = (counts[call.activity] ?? 0) + 1;
                  return counts;
                }, {}),
              )
            : "状态同步暂停"
        }
        summary={
          <>
            <span>{calls.length} 次 Agent 调用</span>
            <span>
              已显示 {spans.filter((s) => s.kind === "tool").length} 个工具记录
            </span>
          </>
        }

        axisLabel="Agent / 工具 / 等待"
        expandedIds={expanded}
        selectedId={selectedId}
        onToggle={(id) => {
          if (expanded.has(id)) {
            const selected = spans.find((span) => span.id === selectedId);
            const agent = spans.find((span) => span.id === id);
            if (selected?.taskId === id && selected.kind !== "agent" && agent)
              onSelect(agent);
          }
          setExpanded((old) => {
            const next = new Set(old);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          });
        }}
        onSelectSpan={(span) => {
          if (span.kind === "notice") retry();
          else onSelect(span);
        }}
      />
    </div>
  );
}
