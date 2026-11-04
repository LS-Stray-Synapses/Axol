---
status: draft
owner:
tags: [component]
---
# Adaptation Loop

## Purpose
Watches how the current model behaves (via [Evaluation](Evaluation.md) signals) and adjusts the harness: prompt format, tool-use style, context handling and control flow, so Axol does not depend on hand-tuning per model.

## Interface
```python
# TODO: sketch the public API
```

## Diagram
```mermaid
flowchart LR
    Run[Agent runs] --> Signals[Collect signals]
    Signals --> Analyze[Analyze per-model behaviour]
    Analyze --> Profile[Update adaptation profile]
    Profile --> Run
```

## Depends on / used by
- Depends on: [Evaluation](Evaluation.md)
- Used by: [Harness](Harness.md)

## Related decisions
-

## Open questions
- [ ]

Back to [Overview](Overview.md)
