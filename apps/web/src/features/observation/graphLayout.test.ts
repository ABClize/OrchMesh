import { expect, test } from "vitest";
import {
  layoutRelations,
  curvePath,
  NODE_WIDTH,
  NODE_HEIGHT,
} from "./graphLayout";
test("branch, return, self and isolated nodes have bounded finite diagram geometry", () => {
  const topology = JSON.stringify({
    nodes: ["a", "b", "c", "isolated"],
    edges: [
      { id: "ab", source: "a", target: "b" },
      { id: "ac", source: "a", target: "c" },
      { id: "ba", source: "b", target: "a" },
      { id: "aa", source: "a", target: "a" },
    ],
  });
  const layout = layoutRelations(topology);
  expect(layout.nodes.size).toBe(4);
  for (const node of layout.nodes.values()) {
    expect(node.x - NODE_WIDTH / 2).toBeGreaterThanOrEqual(0);
    expect(node.y - NODE_HEIGHT / 2).toBeGreaterThanOrEqual(0);
    expect(node.x + NODE_WIDTH / 2).toBeLessThanOrEqual(layout.width);
    expect(node.y + NODE_HEIGHT / 2).toBeLessThanOrEqual(layout.height);
  }
  for (const edge of layout.edges.values()) {
    expect(curvePath(edge.points)).not.toMatch(/NaN|undefined/);
    expect(edge.points.length).toBeGreaterThan(1);
  }
  expect(curvePath(layout.edges.get("ab")!.points)).not.toBe(
    curvePath(layout.edges.get("ba")!.points),
  );
  expect(layoutRelations(topology)).toEqual(layout);
});
