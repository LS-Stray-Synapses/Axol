# Axol

**A self-adapting agent architecture with a live prototype harness and web UI.**

Axol is a model-agnostic agent architecture built around a harness that can adapt to the model it is running. The project is no longer only a design document: the repo includes a working prototype backend, a browser client, and a real tool/model integration pattern that matches the intended runtime architecture.

> ⚠️ **Status: prototype in progress.** The system has a working Ollama-driven agent loop and live UI, but is not a finished production harness yet.

---

## What is implemented now

- **Web UI** in `web/` with a structured event protocol defined in `web/src/contract.ts`
- **Prototype harness backend** in `mock_server.py` that forwards the agent's stream through the server→browser event contract
- **Local workspace tools** in `modules/local_tools.py` for file reading/writing and memory persistence
- **MCP tool integration** in `modules/mcp_tools.py` for external tool servers described in `mcp_server.json`
- **Model abstraction** in `modules/models.py` and `modules/agent.py` using Ollama's native streaming client and tool execution
- **Plugin runtime patterns** in the browser and server for loading UI plugins from `plugins/`

## Why Axol?

Most agent frameworks are tuned for one model or provider, and switching models means re-tuning prompts, tools and workflows by hand. Axol takes the opposite approach: the **harness adapts to the model**, not the other way round.

## Core ideas

- **General agent architecture** – Not tied to one use case. Axol is meant to be a base for building any kind of agent.
- **Built from the ground up** – No wrapping of an existing agent framework. Every layer is designed for adaptability.
- **Model-agnostic** – Works with any model:
  - **Local models** (run on your own hardware)
  - **API models** (hosted providers)
- **Self-adapting harness** – The harness learns from how the current model performs and adapts its behaviour, such as prompting, tool use, context handling and control flow, so it doesn't depend on hand-tuning.
- **Prototype plugin runtime** – The current implementation already demonstrates plugin-style loading, tool execution, and browser/server event flow.

## Current architecture

```text
┌─────────────────────────────────────────────┐
│                 Axol prototype               │
│                                             │
│   ┌───────────────────────────────────────┐ │
│   │        Web UI / browser client       │ │
│   │   React app + socket event contract │ │
│   └──────────────────────┬────────────────┘ │
│                          │                  │
│   ┌──────────────────────▼────────────────┐ │
│   │   Prototype harness / runtime adapter  │ │
│   │ thinking/text stream, agent loop and  │ │
│   │      tool + plugin orchestration       │ │
│   └───────────────┬────────────────────────┘ │
│                   │                          │
│   ┌───────────────▼────────────────┐        │
│   │  Local tools + MCP tools +     │        │
│   │  model config / Ollama client  │        │
│   └────────────────────────────────┘        │
└─────────────────────────────────────────────┘
```

- **Web UI** – React-based front end that listens for harness events and renders them as thinking, text, tool calls and approvals.
- **Prototype harness** – `mock_server.py` runs agent turns and forwards their events through the contract the final server should adopt.
- **Model interface** – `ModelConfig` + Ollama `AsyncClient` provides streamed thinking, text, and tool calls from local Ollama models.
- **Tool layer** – `LocalTools` and `MCPTools` expose both workspace utilities and external MCP-capable tools.

## Roadmap / status

- [x] Browser event contract and mock runtime
- [x] Local workspace tools and memory
- [x] MCP tool connection pattern
- [x] Native Ollama streaming model adapter
- [x] UI plugin loading model
- [ ] Production harness runtime kernel
- [ ] Real adaptation loop + evaluation pipeline
- [ ] Model forge / custom model work

## Inspiration

Axol was inspired by the harness design behind **DeepSeek**.

## Getting started

The web UI runs against the **prototype backend** while the production harness is still being implemented. To see how the two sides talk, read [docs/Architecture/Front end.md](docs/Architecture/Front%20end.md).

**Prerequisites:** Python ≥ 3.11, Node.js ≥ 22 (`node -v`), and Ollama with one of the models configured in `mock_server.py`.

```bash
git clone https://github.com/LS-Stray-Synapses/Axol.git && cd Axol

# Python env
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# Web UI deps
cd web && npm ci && cd ..
```

**Run it** (two terminals, both from the repo root):

```bash
.venv/bin/uvicorn mock_server:app --port 8000 --reload   # prototype harness
cd web && npm run dev                                     # UI → http://localhost:5173
```

Select an available Ollama model in the composer and send a message. Thinking, answer text, tool calls, and tool results stream through the browser event contract.

**Checks** (from `web/`): `npm run typecheck`, `npm test` (unit), `npm run e2e` (end-to-end; first time: `npx playwright install chromium`).

### Repo layout

```text
web/              React + TypeScript UI   (web/src/contract.ts = the event contract)
plugins/          UI plugins the server can load at runtime (plain JS, no build)
mock_server.py    prototype FastAPI/WebSocket runtime adapter
modules/          Python tool + model + agent runtime layer
docs/             design notes (Obsidian vault)
requirements.txt  pinned Python deps
pyproject.toml    project metadata
```

## Contributing

Design notes, architecture diagrams and decision records live in [`docs/`](docs/Home.md), which is an [Obsidian](https://obsidian.md) vault. Open `docs/` as a vault, or read it on GitHub. See [docs/Contributing.md](docs/Contributing.md).

Axol is in an active prototype stage. Ideas, feedback and discussion are welcome: open an issue to get involved.

## License

Licensed under the [Apache License 2.0](LICENSE).
