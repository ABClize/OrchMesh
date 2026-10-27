import dagre from "@dagrejs/dagre";
export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 104;
type Point = { x: number; y: number };
// Topology is the only input: stream/status updates cannot move nodes.
export function layoutRelations(topology: string) {
  const { nodes, edges } = JSON.parse(topology) as {
    nodes: string[];
    edges: { id: string; source: string; target: string }[];
  };
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({
    rankdir: "LR",
    ranksep: 100,
    nodesep: 36,
    marginx: 28,
    marginy: 36,
  });
  graph.setDefaultEdgeLabel(() => ({}));
  nodes.forEach((id) =>
    graph.setNode(id, { width: NODE_WIDTH, height: NODE_HEIGHT }),
  );
  edges.forEach((edge) =>
    graph.setEdge(
      edge.source,
      edge.target,
      { width: 64, height: 24, labelpos: "c" },
      edge.id,
    ),
  );
  dagre.layout(graph);
  return {
    width: graph.graph().width ?? 0,
    height: graph.graph().height ?? 0,
    nodes: new Map(nodes.map((id) => [id, graph.node(id)])),
    edges: new Map(
      edges.map((edge) => [
        edge.id,
        graph.edge({ v: edge.source, w: edge.target, name: edge.id }),
      ]),
    ),
  };
}
export function curvePath(points: Point[]) {
  if (!points.length) return "";
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i],
      next = points[i + 1];
    path += ` Q ${p.x} ${p.y} ${(p.x + next.x) / 2} ${(p.y + next.y) / 2}`;
  }
  const last = points.at(-1)!;
  return `${path} L ${last.x} ${last.y}`;
}
