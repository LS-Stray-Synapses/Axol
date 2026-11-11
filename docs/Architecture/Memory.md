---
status: active
owner:
tags: [component]
---
# Memory

## Purpose

The current memory model is intentionally lightweight: it stores facts the user wants the agent to remember and exposes them to the model as a simple system prompt memory block. The repo already implements this pattern with a `memory.md` file and a `save_memory` tool.

## Current implementation

The working memory system is based on:

- `memory.md` as a persistent long-term memory file
- `LocalTools.save_memory(fact)` for appending structured facts
- `LocalTools.load_memory()` for reading the stored memory back into the model context

This is used by `mock_server.py` as part of the system prompt:

```python
SYSTEM_PROMPT = """You are a helpful personal assistant...\n{memory}\n"""
```

This is a minimal but real implementation of long-term memory that is already useful for prototype testing.

## Runtime flow

```mermaid
flowchart TB
    Agent[Agent] --> Load[load_memory()]
    Load --> File[memory.md]
    File --> Prompt[System prompt context]
    Agent --> Save[save_memory(fact)]
    Save --> File
```

## Design intent

The future architecture still expects richer memory layers, such as:

- short-term conversation state
- scratchpad / working memory
- summarization or compaction strategies
- memory-scoping by task or domain

But the current repo already contains the concrete beginning of that system.

## Depends on / used by

- Depends on: local workspace storage (`memory.md`)
- Used by: [Harness](Harness.md), [Front end](Front%20end.md)

Back to [Overview](Overview.md)
