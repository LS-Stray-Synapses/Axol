---
status: proposed
owner: Lenos
author: Lenos
reviewer: Stefanos
date: 2026-11-19
branch: feature/conversations-sessions
tags: [review]
---
# Review: conversations, per-chat sessions and speed stats

**Author:** Lenos. **Reviewer:** Stefanos.
Branch `feature/conversations-sessions`, based on `main` at `b6510e6` ("Update readme").

This branch adds chat history management to the web UI, gives each chat its own model memory on the server, and shows how fast the model streams. Most of it is front end, but it touches the backend in one place (per-chat sessions), and that part needs your review most.

## TL;DR for review

1. **Backend (please read closely):** each chat now has its own model history, kept in `sessions/<id>.jsonl`. It is a small, backwards-compatible change to `mock_server.py` and `modules/agent.py`, plus a new `modules/sessions.py`. See [ADR-0004](../Decisions/ADR-0004-per-conversation-sessions.md) (status *proposed*: accept or push back).
2. **Contract:** `user_message` gains an optional `conversation_id`. Without it, the server behaves exactly as before.
3. **Front end:** conversations, folders, multi-select, drag-to-reorder and tokens-per-second stats. No new dependencies.
4. **Open question for both of us:** when to move storage to a database (see the end of this note).

## 1. Backend: one model history per chat

**Before:** the server had a single `agent.messages` list for the whole process. Every chat in the UI shared one context, so the model "remembered" other chats, and a restart forgot everything.

**Now:**
- The browser sends `conversation_id` with every `user_message`.
- `run_turn` loads that chat's log, puts a **freshly built** system prompt in front of it (so `memory.md` updates reach every chat), runs the agent, and appends what the turn added. It also appends when the turn is cancelled or errors.
- `modules/sessions.py` (`SessionStore`) has `load` / `append` / `delete`. Logs are append-only JSONL, one message per line, in OpenAI format.
- Ids are validated (`[A-Za-z0-9_-]{1,100}`) because they become file names.
- A tool call cut off by Stop gets a synthetic `"cancelled by the user"` result, so the history stays valid for llama.cpp / OpenAI-compatible servers.
- New operation `sessions.delete`: deleting a chat in the UI deletes its log.
- `sessions/` is gitignored.

**`modules/agent.py`:** `run_agent(user_message, messages=None)`. With `messages` it uses and appends to that list; without it, it uses `self.messages` as before. No other behaviour changed.

**Please check:**
- [ ] Is appending on cancel/error what we want? Right now a failed turn still logs your message.
- [ ] Rebuilding the system prompt every turn, instead of logging it, vs. our "model-visible means logged" goal ([ADR-0003](../Decisions/ADR-0003-experience-store.md)). It's a trade-off; see ADR-0004.
- [ ] `self.messages` stays as a fallback. Should it go once every client sends ids?

## 2. Contract change

`web/src/contract.ts`: `{ type: "user_message"; text: string; conversation_id?: string }`.
Rule 9 in [Front end](../Architecture/Front%20end.md) is updated to match. Nothing else in the contract changed.

## 3. Front end

| What | Where |
|---|---|
| Conversations + folders, saved in the browser (localStorage `axol.conversations.v1`) | `web/src/conversations.ts` |
| Chats sidebar tab: new chat, folders (indented), search, rename, delete | `web/src/builtin/ChatsTab.tsx` |
| Multi-select: Ctrl/⌘+click, Shift+click range, ☑ mode, folder checkbox; bulk move (incl. "new folder"), bulk delete; Esc clears | same |
| Manual order: drag to reorder, a drop line shows where it lands, new chats go on top | same + `placeConversations` |
| Tokens/sec, time to first token, duration, tool count per answer; live readout in the header; per-chat totals | `web/src/metrics.ts`, `components/TurnStats.tsx`, `components/ConversationBar.tsx` |

Design notes:
- The chat reducer in `store.ts` is unchanged and stays pure. `conversations.ts` mirrors the chat store into the active conversation and loads another one on switch. Switching is blocked while a turn runs.
- **Speed is measured in the browser:** the server doesn't send timing or `usage`. llama.cpp and Ollama stream about one token per delta, so tokens are counted deltas (marked "≈"); a real `usage` wins if sent. Tok/s counts only time spent streaming, not tool or approval time. Checked against a stream of known speed (40 tok/s set, 40.3 shown) and against `llama-bench` on Bonsai (36.2 bench, 35.6–36.4 shown).
- Message ids now carry a per-page-load tag, since restored chats would otherwise collide with fresh `a-1` ids.
- `ChatMessage` gains an optional `stats` field in `plugin-api.d.ts`. It's additive, so plugins can read it.

## 4. Tests

- Unit: **92/92** pass (21 new: conversations, folders, ordering, bulk actions, metrics, storage migration, the `conversation_id` payload). Typecheck clean.
- E2E: the new `chats:` test passes. I fixed a stale tab count in "many tabs".
- **Heads-up, not caused by this branch:** 16 e2e tests already failed on `main`. They use `/scenario …`, which went away when the mock became a real agent; `operations` also expects 5 tools but there are now 9. We should decide whether to bring back a scripted mode for tests or rewrite them.
- Manually checked with the real model: separate memories per chat, memory survives a server restart, deleting a chat removes its log, tool calls work.

## 5. Bonsai 2 27B on llama.cpp (FYI)

Tested on my laptop (RTX 5060, 8 GB). The official `b12532` and PrismML fork `prism-b12128` builds were both prebuilt CUDA 12.8, and all three runs below answered the check questions correctly.

| setup (as Axol uses it: llama-server, 8K context) | layers on GPU | prompt | generate |
|---|---:|---:|---:|
| official llama.cpp + `Q2_0` | 60 of 64 (max that fits) | 665 tok/s | 24.3 tok/s |
| PrismML fork + `PQ2_0` | all | 698 tok/s | **36.2 tok/s** |

On the same file and the same layer count they're within about 5–7% (the official build reads prompts faster, the fork writes faster). The big win is that `PQ2_0` is small enough to fit entirely in 8 GB. **Note:** the README's run command (official build, `Q2_0`, all layers, 8K) runs out of GPU memory on an 8 GB card. I haven't changed the README yet; let's agree on the recommended setup first.

## 6. Open question: when do we move to a database?

My proposal: **not a database server, but SQLite (Python's built-in `sqlite3`, one file) when we start the logging / Experience Store work. That's the next step, not this branch.**

- Today's data is tiny and append-only. JSONL per chat is the right shape for a run log: easy to read, diff and replay.
- A database pays off when we need **queries across runs**: list and search chats server-side, filter runs by model, outcome or harness version, aggregate token metrics, label experiences ([ADR-0003](../Decisions/ADR-0003-experience-store.md)). That's exactly what logging and evaluation need.
- SQLite with WAL gives that without a server or new dependency. Postgres only if several machines ever write at once.
- **The schema is the real decision, not the engine:** what an event is (message, thinking, tool call, token metrics, model, harness config), and stable ids. It should be an ADR before any code. A single append-only `events(session_id, seq, ts, kind, payload JSON)` table plus a `sessions` table would keep dsh's "log is the source of truth" idea.
- `SessionStore` (`load` / `append` / `delete`) is the seam: a SQLite version can replace the JSONL one without touching `run_turn`.
- Once the server has `sessions`, titles and folders should move there too (ADR-0004 follow-up), so the browser stops being a second store.

## How to try it

```bash
git fetch && git checkout feature/conversations-sessions
cd web && npm ci && cd ..
# model on :8080 as before, then:
.venv/bin/uvicorn mock_server:app --port 8000 --reload
cd web && npm run dev        # http://localhost:5173
```
Open two chats, tell each something different, and check that each answers only from its own history. Then restart the server: they still remember. Checks: `npm run typecheck`, `npm test` (in `web/`).
