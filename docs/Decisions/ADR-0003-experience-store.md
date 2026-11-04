---
status: proposed
date: 2026-11-04
deciders: []
tags: [adr]
---
# ADR-0003: Record experiences for adaptation, benchmarks and training

## Context
Axol is private, so it can record its full behaviour. Problems a model has in a harness are valuable three times: to adapt the harness, to build benchmarks, and as future fine-tuning data for the [Model Forge](../Architecture/Model%20Forge.md).

## Decision
- Every run writes an **append-only run log**; every model-visible input is logged.
- An [Experience Store](../Architecture/Experience%20Store.md) curates notable runs (problems, successes, corrections) with labels: model, harness composition version, outcome, kind.
- The same labelled experience feeds adaptation signals, benchmark cases and training examples.

## Consequences
- Positive: one data pipeline serves three purposes; Model Forge can start later with data already collected.
- Negative: storage growth; need redaction of secrets before training export.
- Open: curation policy (automatic vs. human-approved).
