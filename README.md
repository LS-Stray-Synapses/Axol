# Axol

**A self-adapting agent architecture with its own harness.**

Axol is a general-purpose agent architecture built from the ground up. It is model-agnostic, so it runs with any model, local or API-based. Its harness watches how a model behaves and adjusts itself to get the best out of that model.

> ⚠️ **Status: early development.** Axol is being designed and built. Expect frequent changes; APIs and structure aren't stable yet.

---

## Why Axol?

Most agent frameworks are tuned for one model or provider, and switching models means re-tuning prompts, tools and workflows by hand. Axol takes the opposite approach: the **harness adapts to the model**, not the other way round.

## Core ideas

- **General agent architecture** – Not tied to one use case. Axol is meant to be a base for building any kind of agent.
- **Built from the ground up** – No wrapping of an existing agent framework. Every layer is designed for adaptability.
- **Model-agnostic** – Works with any model:
  - **Local models** (run on your own hardware)
  - **API models** (hosted providers)
- **Self-adapting harness** – The harness learns from how the current model performs and adapts its behaviour, such as prompting, tool use, context handling and control flow, so it doesn't depend on hand-tuning.
- **Custom model (future)** – Later on, we plan to train a custom model built specifically for the Axol harness.

## Architecture overview

```
┌─────────────────────────────────────────┐
│                  Axol                   │
│                                         │
│   ┌─────────────────────────────────┐   │
│   │      Self-Adapting Harness      │   │
│   │  (orchestration, tools, memory, │   │
│   │   feedback & adaptation loop)   │   │
│   └────────────────┬────────────────┘   │
│                    │                    │
│   ┌────────────────▼────────────────┐   │
│   │       Model Interface Layer     │   │
│   └───────┬─────────────────┬───────┘   │
└───────────┼─────────────────┼───────────┘
            │                 │
     ┌──────▼──────┐   ┌──────▼──────┐
     │ Local models│   │ API models  │
     └─────────────┘   └─────────────┘
```

- **Self-Adapting Harness** – Runs the agent loop: planning, tool calls, memory and evaluation. It feeds results back in to adjust how it works with the current model.
- **Model Interface Layer** – One common interface over every model backend, so the harness can swap models without code changes.
- **Model backends** – Any local or API model that plugs into the interface layer.

## Roadmap

- [ ] Core harness and agent loop
- [ ] Unified model interface (local and API backends)
- [ ] Self-adaptation loop
- [ ] Tooling and memory systems
- [ ] Evaluation and benchmarks
- [ ] Custom Axol model

## Inspiration

Axol was inspired by the harness design behind **DeepSeek**.

## Getting started

Setup and usage instructions will be added once the first working version lands.

## Contributing

Axol is in its early stages. Ideas, feedback and discussion are welcome: open an issue to get involved.

## License

Licensed under the [Apache License 2.0](LICENSE).
