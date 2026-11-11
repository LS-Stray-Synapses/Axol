---
status: planned
owner:
tags: [component]
---
# Experience Store

## Purpose

The long-term design is for Axol to record raw runs and curate them into valuable experiences: model behaviour, failure modes, successful trajectories, and benchmark candidates. That pipeline is still a future architecture goal, but the repo already has the basic ingredients for it: tool calls, memory, model calls, and the mock scenario stream.

## Current foundation

The current codebase naturally produces run data:

- `mock_server.py` emits turn-level events (`thinking`, `text`, `tool_call`, `tool_result`, `done`, `error`)
- `modules/agent.py` tracks the actual tool call + model response cycle
- `modules/local_tools.py` records user-relevant state in `memory.md`
- browser events are already structured enough to replay and inspect later

This means the core data model for a future Experience Store is already emerging, even though the store itself is not yet implemented as a persistent curated database.

## Future design

The architectural intent is still:

| Consumer | Uses experiences as |
|----------|---------------------|
| [Adaptation Loop](Adaptation%20Loop.md) / [Harness Forge](Harness%20Forge.md) | signals about how a model behaves in a harness |
| [Evaluation](Evaluation.md) | benchmark cases |
| [Model Forge](Model%20Forge.md) | training examples |

## Kinds of experience

- **Problem**: tool-call errors, malformed output, loops, wrong answers, or failed approvals
- **Success**: good solutions or useful tool-use patterns
- **Correction**: a failure followed by a fix or adjusted behavior

## Design notes

- The **run log is the raw source of truth**. The Experience Store should be a curated layer over it.
- Each experience should record the model, harness version or configuration, outcome, and labels.
- Experiences should be reusable across adaptation, benchmark generation, and future fine-tuning.

## Depends on / used by

- Depends on: [Harness](Harness.md), [Tools](Tools.md), [Memory](Memory.md)
- Used by: [Adaptation Loop](Adaptation%20Loop.md), [Harness Forge](Harness%20Forge.md), [Evaluation](Evaluation.md), [Model Forge](Model%20Forge.md)

## Related decisions

- [ADR-0003](../Decisions/ADR-0003-experience-store.md)

## Open questions

- [ ] curation policy: automatic, human-approved, or both
- [ ] storage format: SQLite, JSONL, or Parquet export
- [ ] secret redaction before any training export
- [ ] deduplication of similar failures

Back to [Overview](Overview.md)
