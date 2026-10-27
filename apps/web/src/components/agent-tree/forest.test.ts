import { expect, test } from "vitest";
import { buildForest, revealPath } from "./forest";
test("same agent invocations remain distinct, children attach by call id", () => {
  const items = [
    { id: "root", parentId: null },
    { id: "call1", parentId: "root" },
    { id: "call2", parentId: "root" },
    { id: "nested", parentId: "call1" },
  ];
  const forest = buildForest(items);
  expect(forest.roots.map((x) => x.id)).toEqual(["root"]);
  expect(forest.descendants("root").map((x) => x.id)).toEqual([
    "call1",
    "call2",
    "nested",
  ]);
  expect(forest.children.get("call1")?.map((x) => x.id)).toEqual(["nested"]);
});
test("missing parents, self cycles and multi-node cycles retain all nodes without recursion", () => {
  const items = [
    { id: "orphan", parentId: "missing" },
    { id: "self", parentId: "self" },
    { id: "a", parentId: "b" },
    { id: "b", parentId: "a" },
  ];
  const forest = buildForest(items);
  const rendered = forest.roots.flatMap((root) => [
    root.id,
    ...forest.descendants(root.id).map((x) => x.id),
  ]);
  expect(new Set(rendered).size).toBe(items.length);
  expect(rendered).toHaveLength(items.length);
  expect(forest.detached.has("orphan")).toBe(true);
  expect(forest.detached.has("self")).toBe(true);
});

test("revealing a selected leaf opens ancestors only and preserves stored folds", () => {
  const items = [
    { id: "root", parentId: null },
    { id: "middle", parentId: "root" },
    { id: "leaf", parentId: "middle" },
    { id: "other", parentId: "root" },
  ];
  const stored = new Set(["root", "middle", "other"]);
  expect([...revealPath(items, stored, "leaf")]).toEqual(["other"]);
  expect([...stored]).toEqual(["root", "middle", "other"]);
  expect([...revealPath(items, stored, null)]).toEqual([...stored]);
});
