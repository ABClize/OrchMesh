# TraceWaterfall

Reusable desktop timeline; no API, task model, or event pairing dependencies.
Accepts stable span IDs, parent IDs, millisecond timestamps (null when unknown),
kind and completion state. `renderDetail` owns domain-specific disclosure.

The observation adapter pairs persisted tool events by callId and containers by
ordered start/end boundaries. Open spans under closed parents remain incomplete;
missing results are never treated as success. Orphan events remain visible.

`live` advances open intervals; `running` controls execution animation separately
from elapsed waiting time. Disconnect or terminal task disables live timing.
The clock is released on unmount. Collapse/selection survive streamed updates.
Reuse AnimatedDisclosure and AnimatedValue, theme tokens, 220ms transition,
and reduced-motion behavior shared with Agent Tree. No Pro source or new UI
library dependencies. Inspired by Affect UI's compact waterfall and AgentPrism's
hierarchical span inspection; neither library's source is copied.
