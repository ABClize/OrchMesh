export type TreeItem = { id: string; parentId: string | null };
/** Preserve all identities; missing parents and cyclic links become explicit roots. */
export function buildForest<T extends TreeItem>(items: T[]) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const parents = new Map(
    items.map((item) => [
      item.id,
      item.parentId && byId.has(item.parentId) ? item.parentId : null,
    ]),
  );
  const detached = new Set<string>();
  for (const item of items) {
    const seen = new Set([item.id]);
    let cursor = parents.get(item.id);
    while (cursor) {
      if (seen.has(cursor)) {
        parents.set(item.id, null);
        detached.add(item.id);
        break;
      }
      seen.add(cursor);
      cursor = parents.get(cursor);
    }
    if (item.parentId && !byId.has(item.parentId)) detached.add(item.id);
  }
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const item of items) {
    const parent = parents.get(item.id);
    if (!parent) roots.push(item);
    else children.set(parent, [...(children.get(parent) ?? []), item]);
  }
  const descendants = (id: string): T[] => {
    const result: T[] = [];
    const queue = [...(children.get(id) ?? [])];
    for (let i = 0; i < queue.length; i++) {
      result.push(queue[i]);
      queue.push(...(children.get(queue[i].id) ?? []));
    }
    return result;
  };
  return { roots, children, descendants, detached };
}

/** Temporarily reveal a selected descendant without opening unrelated branches. */
export function revealPath(
  items: TreeItem[],
  collapsed: ReadonlySet<string>,
  selected: string | null,
) {
  const visible = new Set(collapsed);
  const parents = new Map(items.map((item) => [item.id, item.parentId]));
  const seen = new Set<string>();
  let parent = selected ? parents.get(selected) : null;
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    visible.delete(parent);
    parent = parents.get(parent);
  }
  return visible;
}
