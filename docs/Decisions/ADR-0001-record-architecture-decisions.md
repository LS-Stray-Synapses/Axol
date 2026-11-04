---
status: accepted
date: 2026-11-04
deciders: []
tags: [adr]
---
# ADR-0001: Record architecture decisions

## Context
Axol is built by more than one contributor and the architecture is still taking shape. Decisions made in chats or calls get lost, and later it is unclear *why* something is the way it is.

## Decision
We keep Architecture Decision Records in `docs/Decisions/`, in the repo, using the ADR template. Accepted ADRs are not edited. A changed decision gets a new ADR that supersedes the old one.

## Consequences
- Design history lives next to the code and is reviewed in PRs.
- Small overhead per significant decision.
