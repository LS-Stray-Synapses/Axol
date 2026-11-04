---
status: draft
tags: [architecture]
---
# Architecture overview

Axol is a model-agnostic agent architecture whose **harness adapts to the model**, not the other way round.

## System diagram
```mermaid
flowchart TB
    subgraph Axol
        subgraph H[Self-Adapting Harness]
            Loop[Agent Loop]
            Tools[Tools]
            Mem[Memory]
            Adapt[Adaptation Loop]
            Eval[Evaluation]
            Loop <--> Tools
            Loop <--> Mem
            Loop --> Eval --> Adapt --> Loop
        end
        MIL[Model Interface Layer]
        Loop <--> MIL
    end
    MIL <--> Local[Local models]
    MIL <--> API[API models]
```

## Request lifecycle
```mermaid
sequenceDiagram
    participant U as User / Caller
    participant L as Agent Loop
    participant M as Model Interface
    participant T as Tools
    participant E as Evaluation
    participant A as Adaptation
    U->>L: task
    loop until done
        L->>M: prompt (shaped by current adaptation profile)
        M-->>L: response / tool call
        opt tool call
            L->>T: execute
            T-->>L: result
        end
    end
    L->>E: trace of the run
    E->>A: signals (success, errors, format failures…)
    A-->>L: updated profile for this model
    L-->>U: result
```

## Components
| Component | Note | Status |
|-----------|------|--------|
| Agent loop / orchestration | [Harness](Harness.md) | draft |
| Model abstraction | [Model Interface Layer](Model%20Interface%20Layer.md) | draft |
| Self-adaptation | [Adaptation Loop](Adaptation%20Loop.md) | draft |
| Memory & context | [Memory](Memory.md) | draft |
| Tool system | [Tools](Tools.md) | draft |
| Evaluation & benchmarks | [Evaluation](Evaluation.md) | draft |

Visual map: [Axol.canvas](Axol.canvas) (open in Obsidian).
Inspiration: [DeepSeek harness notes](../Research/DeepSeek%20harness.md).
