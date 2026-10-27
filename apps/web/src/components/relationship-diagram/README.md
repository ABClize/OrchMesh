# Relationship diagram primitives

- `RelationshipDiagram`: presentational HTML nodes + SVG edges, no domain model, layout engine, viewport controls or data fetching. Supply stable IDs, geometry and accessible button content in `nodes[].content` / `edges[].label`. `running` controls edge motion; `selected` controls emphasis. Theme with `--diagram-accent`, `--diagram-line`, `--diagram-running`.
- `AnimatedDisclosure`: controlled `open`; child content unmounts immediately when closed, while the empty shell animates its measured height. ResizeObserver handles async content sizes; interrupted animations start from the current visible height. Observer, animation and media listeners are cleaned on unmount. No ResizeObserver means an immediate, functional disclosure.
- `AnimatedValue`: `value` is the semantic change key. Identical updates and initial mount do not animate; changed values receive one short transition. Children remain mounted, retaining their state.

Motion uses 220ms cubic-bezier(.2,.8,.2,1) for transitions and 1s linear flow for active edges. Stable IDs prevent stream updates from restarting node entry and edge loops. Reduced motion disables node entry, animated edges and measured transitions; changing that preference cancels active JavaScript animations.

The observation feature owns Dagre layout, AgentIdentity, activity labels and subscription lifecycles. Keep these out of the reusable diagram layer.
