# Build prompt: harness front end (front end only + mock backend)

I'm learning how agent harnesses work by building one from scratch. The Python
back end lives in `harness.py` (agent loop, tools, MCP, memory, DeepSeek/OpenAI-
compatible models). **Do not modify `harness.py` or `v0.py`–`v4.py`.** Your job
is the **front end only**, plus a **mock server** that fakes the back end so
the UI can be built and tested without a model or API key.

The real back end will later replace the mock without the front end changing.
The event contract below is the only thing the two sides share, so follow it
exactly.

## Prerequisites (check first, stop and tell me if missing)

- Node.js ≥ 22 and npm (`node -v`). If missing, tell me how to install it. Don't install system software yourself.
- Python: use the existing venv at `../.venv` (`../.venv/bin/pip install fastapi uvicorn`).
  `uv` is not installed on this machine.

## Stack

- **React 19 + TypeScript (strict) + Vite**, in `web/`.
- **Tailwind CSS v4** for styling. Dark theme by default, CSS variables for theme tokens so plugins can inherit them.
- **Zustand** for the app store (chat state, connection, approvals). Plugins read it through a hook.
- **react-markdown + remark-gfm** for markdown (it doesn't render raw HTML, so no `dangerouslySetInnerHTML` anywhere),
  plus **shiki** for code highlighting.
- **htm** so plugins can write JSX-like UI in plain `.js` without a build step.
- Tests: **Vitest + Testing Library** (unit/component) and **Playwright** (end-to-end against the mock server).
- Mock server: FastAPI + uvicorn: WebSocket at `/ws`, plugins served at `/plugins/`.
  In dev, Vite proxies `/ws` and `/plugins` to it. `npm run build` outputs `web/dist`, which FastAPI also serves.
- Keep it small and readable. Comment the *why*, not the what. I'm reading this to learn.
  Keep dependencies to the list above unless you ask me first.

## Files

```
web/
  src/
    main.tsx, App.tsx       fixed shell: layout + slot mount points + approval dialog
    backend.ts              the ONLY module that touches the WebSocket
    contract.ts             TypeScript types for every event (single source of truth)
    store.ts                Zustand store, reduces events into state
    slots.tsx               slot registry + <Slot name=…/> component + error boundary
    plugins.ts              runtime plugin loader
    components/             Message, ThinkingBlock, ToolCard, ApprovalDialog, Composer, Sidebar …
    builtin/                built-in tabs, registered through slots like plugins
      MemoryTab.tsx, ToolsTab.tsx
    debug.ts                inspection + self-test functions (see below)
  plugin-api.d.ts           types for plugin authors (the `harness` object)
  tests/                    vitest + playwright
mock_server.py              fake back end with scripted scenarios
plugins/example-tab/ui.js   sample plugin: plain JS + htm, no build
```

## Event contract (define it in `contract.ts`)

Every message is one JSON object with a `type` field. Validate incoming events
at runtime. Anything that doesn't match goes to `getErrors()` and never crashes the UI.

**Server → browser**

| type | fields | meaning |
|---|---|---|
| `status` | `state: "idle" \| "running"` | agent busy or not |
| `thinking` | `text` | reasoning delta (stream, append) |
| `text` | `text` | answer delta (stream, append) |
| `tool_call` | `id, name, args` | tool started |
| `tool_result` | `id, name, result, is_error` | tool finished (match by `id`) |
| `approval_request` | `id, tool, args, reason` | agent waits for user yes/no |
| `done` | `usage?: {input_tokens, output_tokens}` | turn finished |
| `error` | `message` | turn failed |
| `operation_result` | `request_id, ok, result?, error?` | reply to `call_operation` |
| `plugin_loaded` | `name, ui_url` | browser should load that plugin |
| `plugin_unloaded` | `name` | browser should undo that plugin's registrations |

**Browser → server**

| type | fields |
|---|---|
| `user_message` | `text` |
| `approval_reply` | `id, approved` |
| `cancel` | — |
| `call_operation` | `request_id, name, args` |
| `plugin_error` | `name, slot, error` |

## `backend.ts`: functions the UI calls

Nothing else touches the socket. Export:

```ts
connect(url)                         // open WebSocket, auto-reconnect with backoff
onEvent(handler) => unsubscribe      // every validated incoming event
onConnectionChange(handler)          // "connecting" | "open" | "closed"
sendMessage(text)
replyApproval(id, approved)
cancel()
callOperation(name, args): Promise<unknown>   // request_id; rejects on ok:false or 10 s timeout
reportPluginError(name, slot, error)
```

## Slots and plugins: dynamic UI

- Slots: `sidebar.tabs` (list), `header.actions` (list), `composer.actions` (list),
  `tool.renderer` (keyed by tool name, falls back to the default ToolCard).
  Type them in a `SlotMap` interface so registering into an unknown slot or with wrong props fails typechecking.
- `register(slot, entry)` returns an **undo function**. List entries are sorted by `order` (default 100).
- `<Slot name="…"/>` renders the entries and re-renders when registrations change.
  **Each entry is wrapped in its own error boundary.** A crash shows a small error box
  in its place, calls `reportPluginError`, and the rest of the UI keeps working.
- Entries render only inside their own slot. No portals, no `document.*` access outside their element.
- The **approval dialog is core UI, not a slot.** Plugins must not be able to render, hide or answer it.
- Plugin loading: on `plugin_loaded`, `import(/* @vite-ignore */ ui_url)` and call its
  exported `activate(harness)`. `harness` provides `React`, `html` (htm bound to
  React.createElement), `slots.register`, `callOperation`, `useStore` and the theme tokens.
  Record every undo function the plugin creates; on `plugin_unloaded` (or a reload of
  the same name) run them all.
- The built-in Memory and Tools tabs register through `sidebar.tabs` exactly like a plugin
  would, using `callOperation("memory.read")` and `callOperation("tools.list")`.
- `plugin-api.d.ts` documents the `harness` object so a plugin file can use
  `// @ts-check` and be checked with `npx tsc --noEmit --allowJs`. That's how the agent
  will check its own plugins later.

## UI features

1. Chat with streaming text and markdown (GFM tables, highlighted code blocks with a copy button). Autoscroll unless I scrolled up.
2. Collapsible "Thinking…" block per turn (muted, collapses when the answer starts).
3. Tool cards: name, args, spinner until `tool_result`, then the result (collapsible, red if `is_error`). Use the `tool.renderer` slot if a renderer is registered for that tool.
4. Approval dialog (modal, keyboard: Enter = allow, Esc = deny).
5. Composer: Enter sends, Shift+Enter newline, disabled while running; Stop button sends `cancel`.
6. Header: connection indicator, `header.actions` slot. Token usage after `done`.
7. Sidebar with the tabs from `sidebar.tabs`.

## `mock_server.py`: scripted scenarios

Pick the scenario from the message text, e.g. typing `/scenario tools`.
Unknown text runs `basic`. Each scenario sends contract events with small delays:

- `basic`: thinking, then a streamed markdown answer (heading, list, table, code block), then done
- `tools`: two tool calls with results, one of them `is_error: true`
- `approval`: approval_request; continue on approve, send a "denied" text otherwise
- `error`: partial text, then `error`
- `long`: about 2,000 words streamed fast (performance + autoscroll)
- `xss`: text and tool result containing `<script>`, `<img onerror>`, a `javascript:` link
- `malformed`: unknown event type, missing fields, invalid JSON. The UI must not crash.
- `cancel`: long stream that stops when `cancel` arrives
- `plugin`: sends `plugin_loaded` for `plugins/example-tab`; `/scenario unplug` unloads it
- `plugin_crash`: loads a plugin whose render throws

It also answers `call_operation` for `memory.read`, `tools.list`, and one deliberately failing operation.

## `debug.ts`: functions to check behaviour

Expose `window.harnessDebug` (dev builds only) with:

```ts
getState()          // {connection, running, messages, pendingApprovals, plugins}
getEventLog(n?)     // last n raw events in both directions, with timestamps
listSlots()         // {slotName: [{id, order, plugin}]}
getErrors()         // render / plugin / validation errors caught so far
inject(event)       // feed a fake server event into the UI without the socket
runScenario(name)   // sends "/scenario <name>"
selfTest()          // runs the checks below, returns [{name, pass, detail}] and prints a table
```

`selfTest()` must check at least:
- streamed `text` deltas end up as one assistant message with rendered markdown
- `tool_call` followed by `tool_result` with the same id updates one card, not two
- XSS payloads render as inert text (no script runs, no `on*` attributes, no `javascript:` hrefs in the DOM)
- a malformed or unknown event is logged in `getErrors()` and nothing crashes
- `register()` adds an entry and its undo removes it
- a throwing slot entry shows an error box and the other entries still render
- loading then unloading a plugin leaves `listSlots()` as it was before
- the approval dialog can't be removed by code inside a slot entry

Mirror these as **Vitest** tests where possible (store reducer, slot registry, backend
with a fake socket). Add **Playwright** tests that start the mock server, run every
scenario, and assert on `harnessDebug.selfTest()` and `getState()`.

## How to work

1. Build in stages and run each before moving on: (a) scaffold + mock server +
   streaming chat, (b) thinking + tool cards, (c) approval + cancel, (d) slots +
   built-in tabs, (e) plugin loading + `plugin-api.d.ts`, (f) debug + selfTest +
   Vitest + Playwright.
2. After each stage, run `npm run typecheck`, the relevant tests and scenarios, and
   report what actually happened. If you can't see the page, say so and rely on
   `selfTest()` / Playwright output.
3. When done, tell me: how to run it (mock server command + `npm run dev` + URL),
   test results, and anything in the contract you think should change before I
   wire up the real back end. Don't change the contract on your own.
