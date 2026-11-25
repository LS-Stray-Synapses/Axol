---
status: active
owner: Lenos
tags: [architecture, security]
---
# Threat model

> [!note] One page, updated at the end of every project
> What or who we defend against, what stops each threat **today**, and what's still open. Last updated: **2026-11-25, end of project 1 (containers).** See [Secure Axol](Secure%20Axol.md) for the direction and [Containers](Containers.md) for how project 1 works.

## What we protect

1. **Your files and memory:** `~/Axol-workspace`, `~/.local/share/axol`.
2. **The rest of the machine:** your home folder, other projects, the system.
3. **The locked core:** Axol's own code, images and settings.
4. **Later:** one user's data from another (project 2), and secrets such as API keys (project 3).

## Threats

| # | Threat | Stopped today by | Still open → project |
|---|---|---|---|
| 1 | **A web page with hidden instructions** (prompt injection) | The agent has no internet tool at all: `fetch` is off, and neither container can reach the internet | When web access returns, the split internet / files jobs, and memory that needs approval → 3 |
| 2 | **A website you have open drives the agent** through `ws://localhost` | `Origin` allow-list on `/ws` (HTTP 403 for others) | — |
| 3 | **A confused or looping model** | Container limits on memory, CPU and processes; a read-only root filesystem for the harness, non-root users in both | A watchdog, per-job limits, and undo → 3, 5 |
| 4 | **The agent escapes the workspace** (`../` in a filename) | The harness container only sees `/data` and `/workspace`, so the rest of the machine is out of reach | Path confinement in the file tools (gate before a second user) → 2 |
| 5 | **A container breaks out** | Rootless Podman: an escape lands as an unprivileged user. Non-root users, no capabilities, `no-new-privileges`. The user isn't in `docker` or `lxd` | — |
| 6 | **Someone else on the network** | The port is published on `127.0.0.1` only. The model has no published port | Logins before opening it to the VPN → 2 |
| 7 | **A tampered image, package or source** | Images pinned by digest, the fork by commit, packages by version. Build context deny-by-default. NVIDIA's apt key scoped with `signed-by` | Image signature checks; checksums of model files checked before loading → 4 |
| 8 | **Secrets or personal data leak into git or an image** | `.gitignore` and `.containerignore` (deny-by-default) cover `.env`, `memory.md`, `workspace/`, `sessions/`. Checked: 0 files in the images | A secret broker, so the agent never holds keys → 3 |
| 9 | **The model server is used to fetch things** | Built without an HTTPS client or the bundled chat page; internal network only | — |
| 10 | **A crash, or a broken container** | Data on the host; containers are disposable; health checks and `restart: unless-stopped` | Job records and resume → 3, 5 |
| 11 | **Axol "improves" itself into something unsafe** | It can't today: the core is read-only images, and there's no self-change path yet | Plugin trust levels, attack tests, approval, rollback → 6 |
| 12 | **A dead disk or stolen laptop** | Nothing yet | Backups on another machine → 5 |
| 13 | **A stolen user account** | Not applicable yet (no accounts) | Login rate limits, session expiry, ending open sessions on removal → 2 |

## Assumptions

- The server sits in a trusted place, and whoever owns it can read its disk.
- Access will only ever be over the VPN, never the open internet.
- The NVIDIA driver, the kernel and Podman are kept up to date by the OS.

Back to [Overview](Overview.md)
