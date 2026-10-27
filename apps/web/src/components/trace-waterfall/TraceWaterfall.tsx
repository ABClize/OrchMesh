import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  Circle,
  Wrench,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatedDisclosure } from "@/components/relationship-diagram/AnimatedDisclosure";
import { AnimatedValue } from "@/components/relationship-diagram/AnimatedValue";
import { buildForest } from "@/components/agent-tree/forest";
import "./trace-waterfall.css";
export type TraceSpan = {
  id: string;
  parentId: string | null;
  name: string;
  kind: string;
  start: number | null;
  end: number | null;
  state: "open" | "complete" | "error" | "incomplete";
};
export const durationLabel = (ms: number) =>
  ms < 1000
    ? `${Math.round(ms)} ms`
    : ms < 60000
      ? `${(ms / 1000).toFixed(1)} s`
      : `${(ms / 60000).toFixed(1)} min`;
/** A data-only timeline: callers own event pairing, connection state and detail content. */
export function TraceWaterfall<T extends TraceSpan>({
  spans,
  live,
  running,
  renderDetail,
  statusLabel,
}: {
  spans: T[];
  live: boolean;
  statusLabel?: string;
  running: boolean;
  renderDetail: (span: T) => ReactNode;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const forest = useMemo(() => buildForest(spans), [spans]);
  const open = spans.some((s) => s.state === "open");
  useEffect(() => {
    if (!live || !open) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [live, open]);
  const times = spans.flatMap((s) =>
    [s.start, s.end].filter((t): t is number => t !== null),
  );
  const start = times.length ? Math.min(...times) : 0;
  const recordedEnd = times.length ? Math.max(...times) : start;
  const end = live && open ? Math.max(now, recordedEnd) : recordedEnd;
  const range = Math.max(1, end - start);
  const detail = spans.find((s) => s.id === selected);
  const rows = (items: T[], depth = 0): ReactNode =>
    items.map((span) => {
      const children = forest.children.get(span.id) ?? [];
      const expanded = !collapsed.has(span.id);
      const ongoing = span.state === "open" && live;
      const finish = span.end ?? (ongoing ? end : span.start);
      const valid =
        span.start !== null && finish !== null && finish >= span.start;
      const label = !valid
        ? "时间未知"
        : span.end === null && !ongoing
          ? "未闭合"
          : durationLabel(finish! - span.start!);
      const state = ongoing
        ? running
          ? "执行中"
          : "等待中"
        : span.state === "open" || span.state === "incomplete"
          ? "未闭合"
          : span.state === "error"
            ? "错误"
            : "已记录";
      const Icon =
        span.kind === "tool" ? Wrench : span.kind === "event" ? Circle : Layers;
      return (
        <div key={span.id}>
          <div
            className="trace-row"
            data-selected={selected === span.id}
            data-kind={span.kind}
            data-state={span.state}
            data-running={ongoing && running}
          >
            <div className="trace-name" style={{ paddingLeft: 8 + depth * 16 }}>
              {children.length ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`${expanded ? "折叠" : "展开"}${span.name}`}
                  aria-expanded={expanded}
                  onClick={() =>
                    setCollapsed((old) => {
                      const next = new Set(old);
                      if (next.has(span.id)) next.delete(span.id);
                      else next.add(span.id);
                      return next;
                    })
                  }
                >
                  {expanded ? <ChevronDown /> : <ChevronRight />}
                </Button>
              ) : (
                <span className="trace-indent" />
              )}
              <Button
                variant="ghost"
                className="min-w-0 justify-start"
                aria-label={`查看记录：${span.name}`}
                aria-pressed={selected === span.id}
                onClick={() =>
                  setSelected(selected === span.id ? null : span.id)
                }
              >
                <Icon />
                <span className="truncate">{span.name}</span>
              </Button>
            </div>
            <button
              className="trace-track"
              aria-label={`${span.name} · ${state} · ${label}`}
              onClick={() => setSelected(selected === span.id ? null : span.id)}
            >
              {valid && (
                <span
                  className="trace-bar"
                  style={{
                    left: `${(100 * (span.start! - start)) / range}%`,
                    width: `${(100 * (finish! - span.start!)) / range}%`,
                  }}
                />
              )}
              <span className="trace-duration">
                <AnimatedValue value={state}>{state}</AnimatedValue> · {label}
              </span>
            </button>
          </div>
          {!!children.length && (
            <AnimatedDisclosure open={expanded}>
              {rows(children, depth + 1)}
            </AnimatedDisclosure>
          )}
        </div>
      );
    });
  return (
    <section className="trace-waterfall" aria-label="执行时间瀑布图">
      <div className="trace-summary">
        <strong>Trace</strong>
        <span>{spans.filter((s) => s.kind === "tool").length} 次工具调用</span>
        <span>{spans.filter((s) => s.state === "error").length} 错误</span>
        <span>观测跨度 {durationLabel(end - start)}</span>
        {statusLabel ? (
          <AnimatedValue value={statusLabel}>{statusLabel}</AnimatedValue>
        ) : (
          live && open && <span>{running ? "实时执行" : "等待中"}</span>
        )}
      </div>
      <div className="trace-scroll">
        <div className="trace-grid">
          <div className="trace-axis">
            <span>轮次 / 步骤 / 工具</span>
            <div>
              {[0, 0.25, 0.5, 0.75, 1].map((t) => (
                <span key={t}>{durationLabel(range * t)}</span>
              ))}
            </div>
          </div>
          {rows(forest.roots)}
        </div>
      </div>
      <AnimatedDisclosure open={!!detail}>
        {detail && (
          <div className="trace-detail">
            <div className="flex items-center justify-between">
              <strong>{detail.name}</strong>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelected(null)}
              >
                关闭记录详情
              </Button>
            </div>
            {renderDetail(detail)}
          </div>
        )}
      </AnimatedDisclosure>
      <p className="trace-note">
        耗时包含等待时间；未闭合表示缺少结束记录。时间轴来自已保存事件。
      </p>
    </section>
  );
}
