import { useMemo } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AgentTree } from "@/components/agent-tree/AgentTree";
import { Button } from "@/components/ui/button-clean";
import {
  AgentIdentity,
  ObservationStatus,
  activityTone,
} from "./ObservationStatus";
import { countsLabel, formatTime, type Call } from "./model";
export function CallTree({
  calls,
  collapsed,
  onToggle,
  selected,
  onSelect,
}: {
  calls: Call[];
  collapsed: ReadonlySet<string>;
  onToggle: (id: string, descendants: string[]) => void;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const items = useMemo(
    () =>
      [...calls]
        .sort(
          (a, b) =>
            a.created_at.localeCompare(b.created_at) ||
            a.id.localeCompare(b.id),
        )
        .map((call) => ({ ...call, parentId: call.parent_id })),
    [calls],
  );
  return (
    <AgentTree
      items={items}
      collapsed={collapsed}
      onToggle={(id, descendants) =>
        onToggle(
          id,
          descendants.map((item) => item.id),
        )
      }
      label="智能体调用树"
      renderCard={(call, branch) => {
        const counts = branch.descendants.reduce<Record<string, number>>(
          (result, child) => {
            result[child.activity] = (result[child.activity] ?? 0) + 1;
            return result;
          },
          {},
        );
        return (
          <article
            className="call-tree-card"
            data-selected={selected === call.id}
            data-running={activityTone(call.activity) === "running"}
          >
            <button
              type="button"
              className="call-tree-select"
              aria-expanded={selected === call.id}
              aria-label={`查看调用：${call.name} · ${call.id.slice(-6)}`}
              onClick={() => onSelect(call.id)}
            >
              <span className="call-tree-heading">
                <AgentIdentity name={call.name} root={!call.parent_id} />
                <span className="min-w-0">
                  <strong title={call.name}>{call.name}</strong>
                  <span className="observation-agent-caption">
                    {call.version_id
                      ? `版本 ${call.version_id.length > 20 ? call.version_id.slice(0, 8) : call.version_id}`
                      : "版本未提供"}
                  </span>
                </span>
              </span>
              <ObservationStatus activity={call.activity} />
              <span className="call-tree-prompt" title={call.prompt}>
                {call.prompt || "未提供任务目标"}
              </span>
              <span className="call-tree-meta">
                创建于 {formatTime(call.created_at)}
                {branch.detached && " · 上级关系不可用"}
              </span>
            </button>
            {branch.childCount > 0 && (
              <div className="call-tree-footer">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={
                    branch.collapsed ? (
                      <ChevronRight size={13} />
                    ) : (
                      <ChevronDown size={13} />
                    )
                  }
                  aria-expanded={!branch.collapsed}
                  aria-label={`${branch.collapsed ? "展开" : "折叠"}${call.name}的分支`}
                  onClick={branch.toggle}
                >{`${branch.descendants.length} 个子调用`}</Button>
                {branch.collapsed && (
                  <span className="call-tree-folded-status">
                    {countsLabel(counts)}
                  </span>
                )}
              </div>
            )}
          </article>
        );
      }}
    />
  );
}
