import { useId, type ReactNode } from "react";
import "./relationship-diagram.css";
export type DiagramNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  content: ReactNode;
};
export type DiagramEdge = {
  id: string;
  path: string;
  x: number;
  y: number;
  running?: boolean;
  selected?: boolean;
  label: ReactNode;
};
/** Presentation only: callers supply layout, accessible controls and domain state. */
export function RelationshipDiagram({
  width,
  height,
  nodes,
  edges,
}: {
  width: number;
  height: number;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}) {
  const marker = useId().replaceAll(":", "");
  return (
    <div className="relationship-diagram-scroll">
      <div className="relationship-diagram" style={{ width, height }}>
        <svg
          width={width}
          height={height}
          className="relationship-connectors"
          aria-hidden="true"
        >
          <defs>
            <marker
              id={marker}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path
                d="M 0 0 L 10 5 L 0 10 z"
                fill="var(--diagram-accent, currentColor)"
              />
            </marker>
          </defs>
          {edges.map((edge) => (
            <g
              key={edge.id}
              className="relationship-connector"
              data-running={edge.running}
              data-selected={edge.selected}
            >
              <path
                d={edge.path}
                className="relationship-line"
                markerEnd={`url(#${marker})`}
              />
              {edge.running && (
                <path d={edge.path} className="relationship-flow" />
              )}
            </g>
          ))}
        </svg>
        {nodes.map((node) => (
          <div
            key={node.id}
            className="relationship-node"
            style={{
              left: node.x,
              top: node.y,
              width: node.width,
              height: node.height,
            }}
          >
            {node.content}
          </div>
        ))}
        {edges.map((edge) => (
          <div
            key={edge.id}
            className="relationship-label"
            data-selected={edge.selected}
            style={{ left: edge.x, top: edge.y }}
          >
            {edge.label}
          </div>
        ))}
      </div>
    </div>
  );
}
