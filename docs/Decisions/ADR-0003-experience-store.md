---
status: accepted
date: 2026-11-04
deciders: [Lenos]
tags: [adr]
---
# ADR-0003: Record experiences for adaptation, benchmarks and training

## Context

Axol is private, so it can record its full behaviour. Problems a model has in a harness are valuable in multiple ways: they help adapt the harness, build benchmarks, and eventually create fine-tuning data for the [Model Forge](../Architecture/Model%20Forge.md).

The current repo already contains the basic ingredients for that pipeline: turn events, tool calls, memory writes, and scenario traces. The long-term store is not yet implemented as a production database, but the design direction is already reflected in the codebase.

## Decision

- Every run writes an **append-only run log**; model-visible inputs are logged.
- An [Experience Store](../Architecture/Experience%20Store.md) will curate notable runs (problems, successes, corrections) with labels: model, harness composition, outcome, and kind.
- The same labelled experience feeds adaptation signals, benchmark cases, and future training examples.

## Consequences

- Positive: one data pipeline serves multiple downstream consumers; the Model Forge can start later with data already being collected.
- Negative: storage growth; need redaction of secrets before training export.
- Follow-up: define curation policy (automatic vs. human-approved) and storage format.
