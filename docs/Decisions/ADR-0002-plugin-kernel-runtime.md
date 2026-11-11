---
status: accepted
date: 2026-11-04
deciders: [Lenos]
tags: [adr]
---
# ADR-0002: Plugin micro-kernel runtime, inspired by DeepSeek Harness, written from scratch

## Context

Axol needs a runtime whose parts (loop, tools, memory, model adapters, context strategy) can be swapped automatically per model by the [Harness Forge](../Architecture/Harness%20Forge.md). The current prototype reflects that direction even if it is still smaller than the final architecture.

The repository already contains the beginnings of the pattern:

- `mock_server.py` manages runtime orchestration and scenario driving
- `modules/agent.py` centralizes the agent loop and tool routing
- tool providers split local vs. MCP sources
- browser plugins and event contracts are modeled as runtime-loadable components

## Options considered

1. **Use / fork dsh**: fast start, but ties us to their stack and scope.
2. **Monolithic harness with config flags**: simple, but adaptation is limited to known variables.
3. **Own plugin micro-kernel, dsh-inspired**: more work, but gives us the flexibility needed for Axol's long-term Architecture.

## Decision

Option 3. We adopt the underlying pattern: kernel + pluggable services, reversible registrations, explicit runtime boundaries, and an event-driven harness model. We are writing our own implementation rather than copying the DeepSeek code.

## Status in the repo today

The implementation is currently a prototype, not the final runtime kernel, but the structure of the decision is already reflected in the codebase:

- event-driven browser/server contract
- modular local + MCP tool systems
- central model registry and agent loop
- plugin-like loading patterns for UI components and tool sources

## Consequences

- Positive: the runtime can evolve toward harness generation, adaptation loops, and reusable plugin registration.
- Negative: the kernel infrastructure still needs to be expanded before it is feature-complete.
- Follow-ups: define the full runtime registration contract, append-only run logs, and the adaptation signal pipeline.
