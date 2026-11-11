---
status: planned
owner:
tags: [component]
---
# Evaluation

## Purpose

Evaluation is how Axol scores runs, compares harness versions, and creates benchmark cases from real behavior. This is still a planned system, but the project is already producing the raw inputs it needs: tool calls, model outputs, errors, and scenario traces.

## Current starting point

The prototype already emits enough structured events to evaluate behavior:

- `thinking` and `text` events show how the agent is reasoning and responding
- `tool_call` and `tool_result` show operational correctness
- `error` and `approval_request` capture failure and approval flows
- `done` provides completion markers and usage metadata

That is enough to start building metrics such as:

- success vs. failure
- tool error rate
- approval override rate
- token / latency cost
- prompt or output format failures

## Future design

The long-term evaluation pipeline is:

```mermaid
flowchart LR
    Trace[Run trace] --> Metrics[Metrics: success, tool errors, format errors, tokens, latency]
    Metrics --> Signals[Adaptation signals]
    Metrics --> Bench[Benchmark reports]
```

The purpose is to turn real runs into repeatable benchmark cases and adaptation signals.

## Depends on / used by

- Depends on: [Harness](Harness.md) traces
- Used by: [Adaptation Loop](Adaptation%20Loop.md), [Harness Forge](Harness%20Forge.md), [Model Forge](Model%20Forge.md)

## Related decisions

- [ADR-0003](../Decisions/ADR-0003-experience-store.md)

## Open questions

- [ ] which metrics should be considered authoritative
- [ ] how to treat approval flows in scoring
- [ ] whether benchmark cases should be human-authored or derived automatically
- [ ] how to compare model versions across different harness compositions

Back to [Overview](Overview.md)
