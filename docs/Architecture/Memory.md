---
status: draft
owner:
tags: [component]
---
# Memory

## Purpose
Manages what the model sees: short-term context (conversation, scratchpad), long-term memory, and context compression strategies tuned per model.

## Interface
```python
# TODO: sketch the public API
```

## Diagram
```mermaid
flowchart TB
    Ctx[Context window builder] --> ST[Short-term / working memory]
    Ctx --> LT[Long-term store]
    Ctx --> Comp[Compression / summarization]
```

## Depends on / used by
- Depends on: storage backend (TBD)
- Used by: [Harness](Harness.md)

## Related decisions
-

## Open questions
- [ ]

Back to [Overview](Overview.md)
