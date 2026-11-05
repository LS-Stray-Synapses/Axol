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

The web UI is built. It runs against a **mock back end** while we build the real harness step by step.
To see how the two sides talk, read [docs/Architecture/Front end.md](docs/Architecture/Front%20end.md).

**Prerequisites:** Python ≥ 3.11 and Node.js ≥ 22 (`node -v`).

```bash
git clone https://github.com/LS-Stray-Synapses/Axol.git && cd Axol

# Python env
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# Web UI deps (exact versions from package-lock.json)
cd web && npm ci && cd ..
```

**Run it** (two terminals, both from the repo root):

```bash
.venv/bin/uvicorn mock_server:app --port 8000 --reload   # fake harness
cd web && npm run dev                                     # UI → http://localhost:5173
```

Type `/scenario tools` (or `approval`, `error`, `cancel`, …) in the chat to play a scripted scenario.

**Checks** (from `web/`): `npm run typecheck`, `npm test` (unit), `npm run e2e` (end-to-end; first time: `npx playwright install chromium`).

### Repo layout

```
web/              React + TypeScript UI   (web/src/contract.ts = the event contract)
plugins/          UI plugins the server can load at runtime (plain JS, no build)
mock_server.py    fake back end with scripted scenarios
docs/             design notes (Obsidian vault)
requirements.txt  pinned Python deps     pyproject.toml: project metadata
```

## Contributing

Design notes, architecture diagrams and decision records live in [`docs/`](docs/Home.md), which is an [Obsidian](https://obsidian.md) vault. Open `docs/` as a vault, or read it on GitHub. See [docs/Contributing.md](docs/Contributing.md).

Axol is in its early stages. Ideas, feedback and discussion are welcome: open an issue to get involved.

## License

Licensed under the [Apache License 2.0](LICENSE).
