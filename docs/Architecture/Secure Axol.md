---
status: planned
owner: Lenos
tags: [component, security]
---
# Secure Axol: how it will work (the simple version)

> The short story. The full design, with every decision and the roadmap, is in [the design doc](../superpowers/specs/2026-11-23-containerization-security-design.md).

## The idea in one line

Axol can still change itself: its loop, its models, its UI. But a **locked core** it can never touch decides what it's allowed to do, notices when something goes wrong, and can always undo.

## The pieces

```
  You (app window or browser)
        │  VPN + login
        ▼
  ┌─────────────── LOCKED CORE ───────────────┐
  │  Harness   who you are, what a job may do,│
  │            the queue, the logs, watchdog  │
  │  GPU server  which model runs, and when   │
  │  Launcher    starts a sandbox, nothing else│
  └───────────────────────────────────────────┘
        │                         │
        ▼                         ▼
  Job sandboxes              llama.cpp workers
  (one per job, thrown       (no internet,
   away after)                model read-only)
        │
        ▼
  Your files: only yours, only the folders the job needs
```

- **Harness:** the front desk. Checks your login, gives each job a permission list, puts it in the queue, writes everything to a log the agent can't edit.
- **GPU server:** the model manager. Knows which models you approved, loads and swaps them, decides who goes next on the GPU.
- **Launcher:** the only piece allowed to start containers, and it can only start sandboxes.
- **Job sandbox:** a fresh, empty box for one job. It sees only what that job's permission list allows, then it's deleted.
- **Adjustable layer:** loop strategies, prompts, model choices, UI plugins. Axol may change these, but each change is a new version that gets tested, benchmarked, approved by you, and can be rolled back.

## A day with Axol

1. **You click the Axol icon.** A window says *"waking the model…"* while the containers start in the background. Then the chat appears.
2. **You log in.** Stefanos does the same from his laptop over the VPN. You each see only your own chats, memory and files.
3. **You ask:** *"Find the llama.cpp release notes and add a summary to my notes."*
4. **Axol splits it into two jobs**, because a job never gets the internet and your files at the same time:
   - a **researcher** sandbox with internet and no files reads the web and returns plain text, which you can see;
   - a **file** sandbox with your `notes/` folder and no internet saves the summary.
5. **If Stefanos is also using the GPU**, your job waits its turn and the UI tells you so.
6. **The agent wants a different model for one step.** The core checks it's allowed, and the GPU server swaps it in when the GPU is free.
7. **Something goes wrong**, say the agent repeats the same tool call in a loop. The watchdog notices, retries once, falls back to the last version that worked, and if that fails it stops and tells you what happened, with the log.
8. **You don't like what it wrote?** "Undo this job" puts your files back. Nothing is ever really deleted, only moved to history.

## The rules underneath

1. The core enforces permissions. The model never decides its own.
2. Internet and private files never meet in one job, unless you mark a project as trusted.
3. Undo instead of nagging: approvals only for things that can't be undone.
4. Containers are disposable. Your data lives outside them.
5. Every container gets the least power it needs and hard limits on CPU, memory and disk.
6. Logs only grow, and the agent can't write to them.
7. Secrets never go in an image or in git.

## How we get there

Seven projects, one at a time:

1. Containers
2. People and logins
3. Job sandboxes
4. GPU server
5. Watchdog and recovery
6. Safe evolution
7. The desktop app

We're on **project 1**.

Back to [Overview](Overview.md)
