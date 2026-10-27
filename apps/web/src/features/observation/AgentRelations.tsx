import { RelationshipDiagram } from "@/components/relationship-diagram/RelationshipDiagram";
import { useMemo, type ReactNode } from "react";
import {
  layoutRelations,
  curvePath,
  NODE_WIDTH,
  NODE_HEIGHT,
} from "./graphLayout";
import { GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button-clean";
import type { AgentGraph, AgentNode } from "./model";
import { countsLabel } from "./model";
import {
  AgentIdentity,
  ObservationStatus,
  leadingActivity,
  activityTone,
} from "./ObservationStatus";

function AgentSummary({
  agent,
  root,
  selected,
  onClick,
}: {
  agent: AgentNode;
  root: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="observation-agent-summary"
      aria-expanded={selected}
      data-running={Object.entries(agent.activity_counts).some(
        ([activity, count]) =>
          count > 0 && activityTone(activity) === "running",
      )}
      onClick={onClick}
      aria-label={`${agent.name}，${agent.call_count} 次调用，${countsLabel(agent.activity_counts)}`}
    >
      <AgentIdentity name={agent.name} root={root} />
      <span className="min-w-0 flex-1">
        <span className="observation-agent-name">{agent.name}</span>
        <span className="observation-agent-caption">
          {root ? "任务发起" : "协作智能体"} · {agent.call_count} 次调用
          {Object.values(agent.activity_counts).filter((count) => count > 0)
            .length > 1 && (
            <span className="block">{countsLabel(agent.activity_counts)}</span>
          )}
        </span>
      </span>
      <ObservationStatus activity={leadingActivity(agent.activity_counts)} />
    </button>
  );
}

// A fixed, document-sized diagram. No viewport, pan, zoom or editing state.
export function AgentRelations({
  graph,
  selected,
  onSelect,
  details,
}: {
  graph: AgentGraph;
  selected: string | null;
  onSelect: (kind: "node" | "edge", id: string) => void;
  details?: ReactNode;
}) {
  const topology = JSON.stringify({
    nodes: graph.nodes.map((node) => node.id).sort(),
    edges: graph.edges
      .map(({ id, source, target }) => ({ id, source, target }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
  const layout = useMemo(() => layoutRelations(topology), [topology]);
  const roots = new Set(
    graph.calls.filter((call) => !call.parent_id).map((call) => call.id),
  );
  return (
    <section className="observation-relations" aria-label="智能体调用关系">
      <div className="observation-relations-intro">
        <GitBranch size={16} aria-hidden="true" />
        <span>协作关系</span>
        <span className="observation-agent-caption">
          点击节点或调用次数展开详情
        </span>
      </div>
      <RelationshipDiagram
        width={layout.width}
        height={layout.height}
        nodes={graph.nodes.map((node) => {
          const point = layout.nodes.get(node.id)!;
          return {
            id: node.id,
            x: point.x - NODE_WIDTH / 2,
            y: point.y - NODE_HEIGHT / 2,
            width: NODE_WIDTH,
            height: NODE_HEIGHT,
            content: (
              <AgentSummary
                agent={node}
                root={node.task_ids.some((id) => roots.has(id))}
                selected={selected === node.id}
                onClick={() => onSelect("node", node.id)}
              />
            ),
          };
        })}
        edges={graph.edges.map((edge) => {
          const point = layout.edges.get(edge.id)!;
          const source = graph.nodes.find(
            (node) => node.id === edge.source,
          )?.name;
          const target = graph.nodes.find(
            (node) => node.id === edge.target,
          )?.name;
          return {
            id: edge.id,
            path: curvePath(point.points),
            x: point.x,
            y: point.y,
            selected: selected === edge.id,
            running: graph.calls.some(
              (call) =>
                edge.task_ids.includes(call.id) &&
                activityTone(call.activity) === "running",
            ),
            label: (
              <Button
                variant="secondary"
                size="sm"
                aria-expanded={selected === edge.id}
                onClick={() => onSelect("edge", edge.id)}
                aria-label={`查看 ${source} 调用 ${target} 的 ${edge.call_count} 次调用`}
              >{`${edge.source === edge.target ? "自调用 · " : ""}${edge.call_count} 次调用`}</Button>
            ),
          };
        })}
      />
      {details}
    </section>
  );
}
