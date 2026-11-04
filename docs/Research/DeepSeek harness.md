---
date: 2026-11-04
source: https://github.com/deepseek-ai/deepseek-harness
tags: [research]
---
# DeepSeek Harness (dsh)

> Concept notes only. **We do not copy code from dsh.** Axol is built from scratch; this note records ideas we may adapt.

## Summary
DeepSeek Harness (`dsh`) is an open-source (MIT) agent runtime released 2026-08-13 alongside DeepSeek-V4-Pro, still in developer preview. Its core idea is **"everything is a plugin"**: the model adapter, tool registry, session log, sandbox, UI, and even the **agent loop itself** are plugins on a micro-kernel framework called **Cordis**. A product is just a *composition* of plugins described in YAML.

## Key ideas

### 1. Micro-kernel + plugin context (Cordis)
- A **context** is a registry of services (`ctx.tools`, `ctx.llm`, `ctx.sessions`…). Plugins find capabilities by key, never by importing a concrete implementation.
- Plugins **declare dependencies** ("inject"); load order falls out of the dependency graph instead of hand-written boot sequences.
- **Registrations are reversible effects**: every tool, prompt section, adapter or listener a plugin installs is undone when the plugin unloads → hot reload and live swapping are safe.
- **Typed events with explicit dispatch modes**: `emit` (observe), `waterfall` (middleware that wraps/rewrites via `next()`), `parallel`, `serial`, `bail` (first answer wins). The mode is part of the event's contract.

### 2. Composition: profiles → bundles → patches
- A **bundle** = a reusable layer of plugin config rows (e.g. base: models, tools, persistence, sandbox, approval policy).
- A **profile** = a named, ordered stack of bundles + user patches (`web`, `headless`, `sdk`, `sdk-minimal`, `acp`).
- **Patches** target a row by id and replace or insert, applied in precedence order. Any row of the booted tree can be overridden.
- Presets/modes: Standard (full agent), Code (programmatic batched tool calls), Minimal (shell + editor only), Creator (author/test plugins by prompting).

### 3. Capability seams
A **seam** is a swappable capability with three roles: **Service Definition** (the interface), **Provider(s)** (implementations), **Consumer(s)** (often a model-facing tool). Example: shell definition → local bash / sandboxed bash providers → bash tool. Swapping one provider (e.g. local → remote sandbox) moves every consumer with it.

### 4. Loop hierarchy: round ⊃ turn ⊃ step
- **Step** = one model request + the tools it calls.
- **Turn** = zero or more steps, draining the agent's inbox until nothing is owed.
- **Round** = an outer policy iteration (e.g. a goal round, or a "Ralph" fresh-agent retry with a structured handoff).
- Each step passes through interception points: pre-step (accept/rewrite/reject input), request, LLM stream, tool pre/execute/post, request-error (retry), turn-stopping.

### 5. Session log is the source of truth
- **Append-only event log**: every system prompt, user message, assistant message (with its exact stream), failed attempt, tool call/result, sub-agent dispatch, token metrics.
- **"Model-visible means logged"**: every model request must be reconstructable from the log. Fork, resume, replay, transcripts and telemetry are all *projections* of the log.
- Versioned on-disk format with one-step migrations.

### 6. Scopes
Registrations are either **global** or **scoped to one agent**. Scoped ones *shadow* same-named globals (per-agent persona / tool variants); **restrictions** filter the global tool set per agent. Parent/child relationships are data (lineage), not visibility.

### 7. Context management
Compaction runs on context pressure (pre-step) or on overflow errors: prune tool results first, then summarize, then retry within the same step.

### 8. "Super agent" design (published 2026-11-03)
- Bottleneck is **human attention** (people track ~3–5 agent sessions), not the model.
- **Router agent**: one persistent session humans talk to (chat, GitHub); routes and tracks tasks, no shell access, can be a cheap model.
- **Worker agents**: one task each, isolated context, disposable, strongest model; report only to the router.
- **Triggers** (chat, PR comments, CI) pass **two filters**: cheap code rules first, then a model checking team-written rules.
- Context as a **cache**: ID + summary first, details on demand, long material behind pointers.
- Delegation must be **structural** (separate sessions, restricted tools), not prompted.

## What Axol might adopt
- Micro-kernel + reversible plugin registrations → lets the **adaptation loop swap harness parts live**.
- Composition-as-data (profiles/bundles/patches) → a harness configuration is something Axol can **generate, mutate and evaluate**.
- Append-only trajectory log → the natural input for **evaluation and adaptation signals**.
- Explicit interception points with dispatch modes → where adaptations hook in.
- Seams → the Model Interface Layer is just the "model" seam.

## Where Axol goes further / differs
- dsh is a configurable harness for (mostly) one model at a time; Axol wants the **harness to be created and tuned automatically per model**, and later **models created for the harness**.
- Open question: TypeScript like dsh, or Python (closer to model training)?

## Links
- Repo: https://github.com/deepseek-ai/deepseek-harness (`docs/architecture.md`, `docs/cordis-primer.md`, `docs/glossary.md`)
- InfoQ: https://www.infoq.com/news/2026/08/deep-seek-harness/
- The New Stack: https://thenewstack.io/deepseek-harness-open-source-plugins/
- Super agent design: https://www.mindstudio.ai/blog/deepseek-super-agent-harness-design
- Related: [Adaptation Loop](../Architecture/Adaptation%20Loop.md), [Harness](../Architecture/Harness.md)
