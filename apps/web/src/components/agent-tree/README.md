# AgentTree

A controlled, presentation-only branching layout. `items` require only `id` and `parentId`; `renderCard(item, branch)` supplies the domain-specific content. No fetching, agent runtime, task status mapping or selection state lives here.

`collapsed` is a caller-owned set of stable invocation IDs. `onToggle` receives the node ID and all descendants, allowing the caller to close a detail subscription when its node becomes hidden. Branch state includes direct-child count, descendant items and a detached-parent flag. Keep collapse state above view switches to preserve it during streaming and navigation.

`buildForest` retains orphan records and breaks cyclic parent links into explicit roots. It never groups by display name or agent identity. Labels for missing/cyclic parents are owned by the card renderer.

Ordinary HTML lists and CSS connectors provide fixed tree layout, with native overflow scrolling. Card buttons support standard Tab/Enter navigation; folding buttons expose aria-expanded. Measured height transitions reuse AnimatedDisclosure, which unmounts children immediately on close. Reduced-motion disables entrance and expansion animations. Customize card width and line color with --agent-tree-card-width and --agent-tree-line.

OrchMesh's `CallTree` adapter uses authoritative task parent_id, activity, prompt, version_id and created_at. No invented cost, model identity, duration or progress. Desktop only in the initial integration.
