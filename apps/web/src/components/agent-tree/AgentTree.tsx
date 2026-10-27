import { useMemo, type ReactNode } from "react";
import { AnimatedDisclosure } from "@/components/relationship-diagram/AnimatedDisclosure";
import { buildForest, type TreeItem } from "./forest";
import "./agent-tree.css";
export type BranchState<T> = {
  descendants: T[];
  childCount: number;
  collapsed: boolean;
  detached: boolean;
  toggle: () => void;
};
/** Controlled, data-agnostic branching layout. Renderers own card content and actions. */
export function AgentTree<T extends TreeItem>({
  items,
  collapsed,
  onToggle,
  renderCard,
  label,
}: {
  items: T[];
  collapsed: ReadonlySet<string>;
  onToggle: (id: string, descendants: T[]) => void;
  renderCard: (item: T, branch: BranchState<T>) => ReactNode;
  label: string;
}) {
  const forest = useMemo(() => buildForest(items), [items]);
  const branch = (item: T): ReactNode => {
    const children = forest.children.get(item.id) ?? [];
    const folded = collapsed.has(item.id);
    return (
      <li key={item.id} className="agent-tree-branch">
        <div className="agent-tree-card-slot">
          {renderCard(item, {
            descendants: forest.descendants(item.id),
            childCount: children.length,
            collapsed: folded,
            detached: forest.detached.has(item.id),
            toggle: () => onToggle(item.id, forest.descendants(item.id)),
          })}
        </div>
        {children.length > 0 && (
          <AnimatedDisclosure open={!folded}>
            <ul className="agent-tree-children" aria-label="子调用">
              {children.map(branch)}
            </ul>
          </AnimatedDisclosure>
        )}
      </li>
    );
  };
  return (
    <section aria-label={label} className="agent-tree-scroll">
      <ul className="agent-tree-roots">{forest.roots.map(branch)}</ul>
    </section>
  );
}
