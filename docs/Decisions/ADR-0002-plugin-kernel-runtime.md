---
status: proposed
date: 2026-11-04
deciders: []
tags: [adr]
---
# ADR-0002: Plugin micro-kernel runtime, inspired by DeepSeek Harness, written from scratch

## Context
Axol needs a runtime whose parts (loop, tools, memory, model adapters, context strategy) can be swapped automatically per model by the [Harness Forge](../Architecture/Harness%20Forge.md). [DeepSeek Harness](../Research/DeepSeek%20harness.md) shows a strong pattern for this: a micro-kernel where everything, including the agent loop, is a plugin with reversible registrations, and harnesses are compositions described as data.

## Options considered
1. **Use / fork dsh**: fast start, but ties us to their stack (TypeScript/Cordis), their scope, and a preview API with breaking changes.
2. **Monolithic harness with config flags**: simple, but adaptation is limited to the flags we foresee.
3. **Own plugin micro-kernel, dsh-inspired**: more work, but harnesses become generatable data and the scope (harness creation, model creation, experience store) is ours.

## Decision
Option 3. We adopt the *ideas* (kernel + services, reversible registrations, typed interception points, composition-as-data, append-only run log, step ⊂ turn ⊂ round) and **write all code ourselves. No code is copied from dsh.**

## Consequences
- Positive: harness compositions are data the Forge can generate and evaluate; any part is replaceable.
- Negative: we build kernel infrastructure before features.
- Follow-ups: choose implementation language; define the plugin contract and event dispatch modes; define the composition format.
