"""Fake back end for building and testing the UI without a model or API key.

It speaks the same event contract as the real server will (see
web/src/contract.ts). Each message picks a scripted scenario:

    /scenario tools        unknown text runs `basic`

Run it:
    .venv/bin/uvicorn mock_server:app --port 8000 --reload     (from the repo root)
"""

import asyncio
import contextlib
import json
import random
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

from modules import LocalTools, MCPTools, ModelConfig, Agent
import os
import asyncio
from contextlib import AsyncExitStack, asynccontextmanager


ROOT = Path(__file__).parent
WORKSPACE = ROOT / "workspace"
MEMORY_FILE = ROOT / "memory.md"
MCP_CONFIG = ROOT / "mcp_server.json"
PLUGINS_DIR = ROOT / "plugins"
DIST_DIR = ROOT / "web" / "dist"

MODELS: dict[str, ModelConfig] = {
    "bonsai-2:27b": ModelConfig(
        base_url="http://localhost:11434/v1",
        api_key="ollama",
        model="bonsai-2:27b"
    ),
    "qwen3.5:4b": ModelConfig(
        base_url="http://localhost:11434/v1",
        api_key="ollama",
        model="qwen3.5:4b"
    ),
    "qwen3.5:2b": ModelConfig(
        base_url="http://localhost:11434/v1",
        api_key="ollama",
        model="qwen3.5:2b"
    )
}

SYSTEM_PROMPT = """You are a helpful personal assistant running inside a \
custom harness named Axol. Be concise.

The user's workspace folder holds their personal files: notes, todo lists, \
ideas. You have tools to list, read and write those files. Never claim you \
lack access to user's files or tasks - use your tools to look.

Here is what you remember about the user from previous sessions:
{memory}

Memory management:
- When you learn a new, potentially useful and lasting fact about the user, \
check the existing memory above first.
- Save the fact using save_memory only if it is not already present.
- Do not save duplicate or redundant information.
- If a new fact updates or corrects an existing fact, update the memory \
rather than creating a duplicate.
- Prefer concise, standalone facts that will be useful in future sessions.
- Do not save temporary information, assumptions, or information that \
has no long-term value.
"""


def build_agent() -> Agent:
    mcp_tools = MCPTools(config_path=MCP_CONFIG)
    local_tools = LocalTools(workspace=WORKSPACE, memory_file=MEMORY_FILE)

    messages = [{"role": "system", "content": SYSTEM_PROMPT.format(memory=local_tools.load_memory())}]
    
    return Agent(
        local_tools=local_tools,
        mcp_tools=mcp_tools, 
        models=MODELS, 
        model_name="bonsai-2:27b", 
        messages=messages
    )

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.exit_stack = AsyncExitStack()
    await app.state.exit_stack.__aenter__()
    try:
        app.state.agent = build_agent()
        app.state.local_tools = app.state.agent.local_tools
        app.state.mcp_tools = app.state.agent.mcp_tools
        await app.state.mcp_tools.connect_mcp(app.state.exit_stack)
        yield
    finally:
        if hasattr(app.state, "exit_stack"):
            await app.state.exit_stack.__aexit__(None, None, None)

app = FastAPI(lifespan=lifespan)

# Instead of having 2 handlers we use the lifespan (look above)
# @app.on_event("startup")
# async def startup_event():
#     app.state.exit_stack = AsyncExitStack()
#     await app.state.exit_stack.__aenter__()

#     app.state.agent = build_agent()
#     app.state.local_tools = app.state.agent.local_tools
#     app.state.mcp_tools = app.state.agent.mcp_tools
#     await app.state.mcp_tools.connect_mcp(app.state.exit_stack)

# @app.on_event("shutdown")
# async def shutdown_event():
#     if hasattr(app.state, "exit_stack"):
#         await app.state.exit_stack.__aexit__(None, None, None)


class Turn:
    """Per-connection state: the running scenario and approvals it waits on."""

    def __init__(self, ws: WebSocket):
        self.ws = ws
        self.task: asyncio.Task | None = None
        self.approvals: dict[str, asyncio.Future[bool]] = {}
        self.plugin_errors: list[dict] = []
        self.loaded: set[str] = set()  # plugins this browser has been told to load

    async def load_plugin(self, name: str) -> None:
        if name not in available_plugins():
            raise KeyError(f"no plugin '{name}' in plugins/")
        self.loaded.add(name)
        await self.send({"type": "plugin_loaded", "name": name, "ui_url": f"/plugins/{name}/ui.js"})

    async def unload_plugin(self, name: str) -> None:
        self.loaded.discard(name)
        await self.send({"type": "plugin_unloaded", "name": name})

    async def send(self, event: dict) -> None:
        await self.ws.send_text(json.dumps(event))

    async def send_raw(self, frame: str) -> None:
        await self.ws.send_text(frame)

    async def stream(self, kind: str, text: str, chunk: int = 4, delay: float = 0.02) -> None:
        """Send `text` as many small deltas, like a model streaming tokens."""
        for i in range(0, len(text), chunk):
            await self.send({"type": kind, "text": text[i : i + chunk]})
            await asyncio.sleep(delay)

    async def ask(self, call_id: str, tool: str, args: dict, reason: str) -> bool:
        """Send approval_request and wait for the user's answer.

        The contract doesn't say how an approval relates to its tool_call, so
        we reuse the tool call's id: that lets the UI mark the right card as
        "waiting for approval". (Worth making explicit in the contract.)
        """
        future = asyncio.get_running_loop().create_future()
        self.approvals[call_id] = future
        await self.send({"type": "approval_request", "id": call_id, "tool": tool, "args": args, "reason": reason})
        try:
            return await future
        finally:
            self.approvals.pop(call_id, None)


# ---------------------------------------------------------------------------
# Scenarios. Each one is just a sequence of contract events with delays.
# ---------------------------------------------------------------------------

BASIC_ANSWER = """## A streamed answer

This is the **basic** scenario. Text arrives in small deltas and is
rendered as markdown as it streams.

- a list item
- another one, with `inline code`
- and a [link](https://example.com)

| model | where | cost |
|---|---|---|
| qwen3.5:4b | local (ollama) | free |
| deepseek-chat | cloud | cheap |

```python
def run_agent(message: str) -> str:
    messages.append({"role": "user", "content": message})
    while True:
        reply = model(messages, tools=TOOLS)
        if not reply.tool_calls:
            return reply.content
```

Try `/scenario tools`, `approval`, `error`, `long`, `xss`, `malformed`,
`cancel`, `plugin`, `unplug`, `plugin_crash` or `plugin_healthy`.
"""


async def basic(t: Turn, _: str) -> None:
    await t.stream("thinking", "The user said something. I'll answer with a bit of every markdown feature.", chunk=6)
    await asyncio.sleep(0.2)
    await t.stream("text", BASIC_ANSWER)
    await t.send({"type": "done", "usage": {"input_tokens": 812, "output_tokens": 164}})


async def tools(t: Turn, _: str) -> None:
    await t.stream("thinking", "I should look at the workspace first, then read the notes file.", chunk=6)
    await t.send({"type": "tool_call", "id": "call_1", "name": "list_files", "args": {}})
    await asyncio.sleep(0.6)
    await t.send(
        {"type": "tool_result", "id": "call_1", "name": "list_files", "result": "notes.md\ntodo.txt", "is_error": False}
    )
    await t.send({"type": "tool_call", "id": "call_2", "name": "read_file", "args": {"filename": "secret.txt"}})
    await asyncio.sleep(0.6)
    await t.send(
        {"type": "tool_result", "id": "call_2", "name": "read_file", "result": "error: no secret.txt", "is_error": True}
    )
    await t.stream("text", "I found `notes.md` and `todo.txt`, but there is no `secret.txt`.")
    await t.send({"type": "done", "usage": {"input_tokens": 1430, "output_tokens": 61}})


async def approval(t: Turn, _: str) -> None:
    await t.stream("thinking", "Writing a file changes the user's workspace, so I need permission.", chunk=6)
    args = {"filename": "todo.txt", "content": "- buy milk\n- learn harnesses\n"}
    # Same order the real server should use: the card appears, then the question.
    await t.send({"type": "tool_call", "id": "call_w", "name": "write_file", "args": args})
    if await t.ask("call_w", "write_file", args, "Writes to todo.txt in your workspace."):
        await asyncio.sleep(0.3)
        await t.send({"type": "tool_result", "id": "call_w", "name": "write_file", "result": "wrote todo.txt", "is_error": False})
        await t.stream("text", "Done. I wrote `todo.txt`.")
    else:
        await t.send(
            {"type": "tool_result", "id": "call_w", "name": "write_file", "result": "user denied this action", "is_error": True}
        )
        await t.stream("text", "Okay, denied. I did not write the file.")
    await t.send({"type": "done"})


async def error(t: Turn, _: str) -> None:
    await t.stream("text", "Let me check that for you. The answer is")
    await asyncio.sleep(0.3)
    await t.send({"type": "error", "message": "model API returned HTTP 500 (simulated)"})


WORDS = "agent loop tool call stream token model memory harness context prompt result plugin slot event socket".split()


async def long(t: Turn, _: str) -> None:
    rng = random.Random(42)
    paragraphs = []
    for p in range(40):
        words = " ".join(rng.choice(WORDS) for _ in range(50))
        paragraphs.append(f"**{p + 1}.** {words.capitalize()}.")
    await t.stream("text", "# A long answer\n\n" + "\n\n".join(paragraphs), chunk=12, delay=0.002)
    await t.send({"type": "done", "usage": {"input_tokens": 300, "output_tokens": 2600}})


XSS = """Here are some payloads; none of them should run.

<script>window.__harnessXss = "script"</script>

<img src=x onerror="window.__harnessXss='img'">

[click me](javascript:window.__harnessXss='link')

<a href="javascript:window.__harnessXss='a'">raw anchor</a>

![tracking pixel](https://example.com/pixel.png?q=secret)
"""


async def xss(t: Turn, _: str) -> None:
    await t.stream("text", XSS, chunk=16)
    payload = "<img src=x onerror=\"window.__harnessXss='tool'\"><script>window.__harnessXss='tool'</script>"
    await t.send({"type": "tool_call", "id": "call_x", "name": "read_file", "args": {"filename": payload}})
    await t.send({"type": "tool_result", "id": "call_x", "name": "read_file", "result": payload, "is_error": False})
    await t.send({"type": "done"})


async def malformed(t: Turn, _: str) -> None:
    await t.send({"type": "no_such_event", "text": "?"})  # unknown type
    await t.send({"type": "text"})  # missing field
    await t.send({"type": "tool_result", "id": 7, "name": "x"})  # wrong types, missing fields
    await t.send_raw("{this is not json")
    await t.send_raw("[1, 2, 3]")
    await t.send_raw("null")
    await t.send({"type": "status", "state": "sleeping"})  # value not in the enum
    await t.stream("text", "Seven bad frames went by. The UI should still be standing.")
    await t.send({"type": "done"})


async def cancel(t: Turn, _: str) -> None:
    # Slow, endless-feeling stream; the cancel handler cancels this task.
    for i in range(1, 600):
        await t.send({"type": "text", "text": f"chunk {i}. "})
        await asyncio.sleep(0.05)
    await t.send({"type": "done"})


async def plugin(t: Turn, _: str) -> None:
    await t.load_plugin("example-tab")
    await t.stream("text", "Loaded the **example-tab** plugin. Look for a new sidebar tab and header button. "
                   "`/scenario unplug` removes it again.")
    await t.send({"type": "done"})


async def unplug(t: Turn, _: str) -> None:
    await t.unload_plugin("example-tab")
    await t.stream("text", "Unloaded **example-tab**.")
    await t.send({"type": "done"})


async def plugin_crash(t: Turn, _: str) -> None:
    await t.load_plugin("crash-tab")
    await t.stream("text", "Loaded **crash-tab**: open its sidebar tab, it throws while rendering. "
                   "The rest of the UI should keep working. Compare with `/scenario plugin_healthy`.")
    await t.send({"type": "done"})


async def plugin_healthy(t: Turn, _: str) -> None:
    await t.load_plugin("healthy-tab")
    await t.stream("text", "Loaded **healthy-tab**: same shape as crash-tab (a sidebar tab + a header entry), "
                   "but its tab works. Use the **💥 break tab** button in the header to crash it on purpose, "
                   "then **🔧 fix tab** and *retry* to bring it back. Unload plugins from the **Plugins** tab.")
    await t.send({"type": "done"})


SCENARIOS = {
    f.__name__: f
    for f in (basic, tools, approval, error, long, xss, malformed, cancel, plugin, unplug, plugin_crash, plugin_healthy)
}


def pick_scenario(text: str):
    if text.startswith("/scenario"):
        name = text.removeprefix("/scenario").strip()
        return SCENARIOS.get(name, basic)
    return basic


async def run_turn(t: Turn, text: str) -> None:
    """Wrap a scenario in status events, and handle cancel/crash like a real server must."""
    await t.send({"type": "status", "state": "running"})
    try:
        # await pick_scenario(text)(t, text)
        agent = app.state.agent
        reply = await agent.run_agent(text)
        await t.stream("text", str(reply), chunk=8, delay=0.2)
        await t.send({"type": "done"})
    except asyncio.CancelledError:
        # Cancelled by the user. The turn still ends cleanly with `done`.
        # (suppress: if the socket itself went away, there's nobody to tell.)
        with contextlib.suppress(Exception):
            await t.send({"type": "done"})
    except Exception as e:  # a bug in a scenario shouldn't kill the socket
        with contextlib.suppress(Exception):
            await t.send({"type": "error", "message": f"mock server bug: {e!r}"})
    finally:
        with contextlib.suppress(Exception):
            await t.send({"type": "status", "state": "idle"})


# ---------------------------------------------------------------------------
# Operations: request/response calls from the UI (call_operation).
# ---------------------------------------------------------------------------

# FAKE_MEMORY = "- The user is learning how agent harnesses work.\n- They prefer short answers.\n"

# FAKE_TOOLS = [
#     {"name": "list_files", "description": "List the files in the user's workspace folder.", "origin": "local"},
#     {"name": "read_file", "description": "Read one file from the user's workspace folder.", "origin": "local"},
#     {"name": "write_file", "description": "Write a file in the user's workspace folder.", "origin": "local"},
#     {"name": "save_memory", "description": "Save one short fact about the user to long-term memory.", "origin": "local"},
#     {"name": "get_current_time", "description": "Get the current time in a timezone.", "origin": "mcp"},
# ]

def workspace_snapshot(root: Path) -> list[str]:
    return sorted(
        str(p.relative_to(root))
        for p in root.rglob("*")
        if p.is_file()
    )

def available_plugins() -> list[str]:
    """Every plugins/<name>/ui.js. Folders starting with _ or . are scratch space."""
    return sorted(p.parent.name for p in PLUGINS_DIR.glob("*/ui.js") if not p.parent.name.startswith(("_", ".")))


async def operation(t: Turn, name: str, args: dict):
    if name == "memory.read":
        return app.state.local_tools.load_memory()

    if name == "tools.list":
        return app.state.agent.all_tool_schemas()
    
    if name == "workspace.list":
        return workspace_snapshot(WORKSPACE)

    if name == "workspace.read":
        rel = str(args.get("path", ""))
        path = (WORKSPACE / rel).resolve()
        if not str(path).startswith(str(WORKSPACE.resolve())):
            raise ValueError("path outside workspace")
        if not path.exists() or not path.is_file():
            return None
        return path.read_text()
    
    if name == "plugins.list":
        return [
            {"name": n, "ui_url": f"/plugins/{n}/ui.js", "loaded": n in t.loaded}
            for n in available_plugins()
        ]

    if name == "plugins.load":
        await t.load_plugin(str(args.get("name")))
        return True

    if name == "plugins.unload":
        await t.unload_plugin(str(args.get("name")))
        return True

    if name == "debug.fail":
        raise RuntimeError("this operation always fails (on purpose)")

    if name == "debug.plugin_errors":
        return t.plugin_errors

    if name == "debug.echo":
        return args

    raise KeyError(f"unknown operation '{name}'")

# ---------------------------------------------------------------------------
# The socket
# ---------------------------------------------------------------------------


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()

    await ws.send_json({
        "type": "model_list",
        "models": [
            {"name": name, "label": cfg.model}
            for name, cfg in app.state.agent.models.items()
        ],
        "selected": app.state.agent.model_name
    })
    
    t = Turn(ws)
    try:
        while True:
            try:
                msg = json.loads(await ws.receive_text())
            except json.JSONDecodeError:
                continue
            kind = msg.get("type") if isinstance(msg, dict) else None

            if kind == "user_message":
                if t.task and not t.task.done():
                    continue  # one turn at a time; the UI disables input anyway
                t.task = asyncio.create_task(run_turn(t, str(msg.get("text", ""))))

            elif kind == "model_change":
                selected_model_name = str(msg.get("model"))
                if selected_model_name in app.state.agent.models:
                    previous_model = app.state.agent.model_name
                    if previous_model != selected_model_name:
                        app.state.agent.model_name = selected_model_name
                        print(f"[model switch] {previous_model} -> {app.state.agent.models[selected_model_name].model}")
                        
            elif kind == "approval_reply":
                future = t.approvals.get(msg.get("id"))
                if future and not future.done():
                    future.set_result(bool(msg.get("approved")))

            elif kind == "cancel":
                if t.task and not t.task.done():
                    t.task.cancel()

            elif kind == "call_operation":
                # Run as a task so a slow operation never blocks this read loop.
                asyncio.create_task(answer_operation(t, msg))

            elif kind == "plugin_error":
                t.plugin_errors.append(msg)
                print(f"  [plugin_error] {msg.get('name')} in {msg.get('slot')}: {msg.get('error')}")

    except WebSocketDisconnect:
        pass
    finally:
        if t.task and not t.task.done():
            t.task.cancel()


async def answer_operation(t: Turn, msg: dict) -> None:
    request_id = msg.get("request_id")
    try:
        result = await operation(t, str(msg.get("name")), msg.get("args") or {})
        await t.send({"type": "operation_result", "request_id": request_id, "ok": True, "result": result})
    except Exception as e:
        await t.send({"type": "operation_result", "request_id": request_id, "ok": False, "error": str(e)})


# Plugins: plain JS files the browser import()s.
app.mount("/plugins", StaticFiles(directory=PLUGINS_DIR), name="plugins")

# The built UI (npm run build). Mounted last so /ws and /plugins win.
if DIST_DIR.is_dir():
    app.mount("/", StaticFiles(directory=DIST_DIR, html=True), name="ui")
