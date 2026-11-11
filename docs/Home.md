---
tags: [index]
---
# Axol Vault

This vault contains the design notes, architecture docs, and decision records for **Axol**, a model-agnostic agent architecture with a working prototype runtime and browser UI.

This folder is an [Obsidian](https://obsidian.md) vault. Open `docs/` as a vault in Obsidian, or just read it on GitHub. Everything is plain Markdown.

## Current status

The repo is no longer only a concept document. It currently includes:

- a working React web UI in `web/`
- a mock harness backend in `mock_server.py`
- model + tool layers in `modules/`
- local memory persistence via `memory.md`
- MCP tool integration via `mcp_server.json`

The project is still a prototype, but the architecture is already concrete enough to test the event contract and runtime flow.

## Map

| Area | What lives there |
|------|------------------|
| [Architecture](Architecture/Overview.md) | One note per component, plus diagrams |
| [Decisions](Decisions/README.md) | Architecture Decision Records (ADRs): *why* we built it this way |
| [Research](Research/README.md) | Papers, prior art, experiments |
| [Meetings](Meetings/README.md) | Sync notes between contributors |
| [Templates](Templates/) | Note templates (insert with `Ctrl/Cmd+P → Templates: Insert template`) |

## Start here

1. [Architecture overview](Architecture/Overview.md)
2. [Visual map (Canvas)](Architecture/Axol.canvas): open in Obsidian
3. [Front end / harness protocol](Architecture/Front%20end.md)
4. [How we work in this vault](Contributing.md)
