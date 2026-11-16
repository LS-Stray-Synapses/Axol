---
status: active
owner:
tags: [component]
---
# Tools

## Purpose

The current tool system is simple but real: it combines workspace utilities with a generic MCP entry point. Tool schemas are exposed to the model and tool calls are routed through the agent runtime.

## Current implementation

The repo contains two concrete tool providers:

### 1. Local tools

`modules/local_tools.py` defines `LocalTools`, which manages:

- `list_files()`
- `read_file(filename)`
- `write_file(filename, content)`
- `delete_file(filename)`
- `save_memory(fact)`

These actions operate against the project workspace and a memory file. The class also provides:

- `tool_registry()` — callable functions by tool name
- `tool_schemas()` — OpenAI-compatible function definitions for model tool calling

### 2. MCP tools

`modules/mcp_tools.py` defines `MCPTools`, which:

- reads `mcp_server.json`
- starts configured MCP servers via stdio
- initializes each `ClientSession`
- lists exposed tools and stores them under a session registry
- exposes `schemas()` so the model sees them alongside local tools

`mock_server.py` starts those servers once, from the FastAPI `lifespan`, before it accepts requests. The same lifespan closes their sessions when the process stops. They are not opened per chat turn.

This gives the runtime a combined tool surface without hard-coding each external tool.

## Runtime flow

```mermaid
flowchart LR
    Agent[Agent] --> Local[LocalTools.tool_registry]
    Agent --> MCP[MCPTools.sessions]
    Local --> Exec[Tool call execution]
    MCP --> Exec
    Exec --> Model[Model receives result + tool output]
```

The actual agent routing is in `modules/agent.py`:

- `all_tool_schemas()` merges local and MCP tool definitions
- `call_tool()` resolves a tool name and invokes the matching local handler or MCP session; local handlers may be synchronous or asynchronous
- results are appended back into the model message history

## Current contract

OpenAI-compatible servers stream tool-call IDs, function names, and arguments in fragments. The agent reconstructs each call by stream index, keeps the provider's call ID for model history, assigns a separate UUID for the browser event pair, and emits:

- `tool_call` with `id`, `name`, and parsed `args`
- `tool_result` with the same `id`, `name`, result, and error flag

The result is also appended to model history with the provider's `tool_call_id`, allowing either llama.cpp or Ollama to continue the turn.

## Design status

This is the working prototype tool layer. The long-term goal is still a richer plugin-based, composable runtime, but the repo already includes a concrete implementation that can be used for prototype development and testing.

Back to [Overview](Overview.md)
