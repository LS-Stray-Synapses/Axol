---
status: accepted
date: 2026-11-25
deciders: [Lenos]
tags: [adr, security]
---
# ADR-0005: Run Axol as two rootless, internal-only containers

## Context

Axol ran as three processes under the user's own account: the agent and its file tools could reach the whole home folder, the internet (the `fetch` MCP server) and the GPU at once. Before more people use it (project 2), each part needs walls that the code can't talk its way through. See the [design](../superpowers/specs/2026-11-23-containerization-security-design.md) and the how-to in [Containers](../Architecture/Containers.md).

## Options considered

1. **Two containers, tools in the harness** (chosen for now): simple, and it fits the "harness + model" split. Job tools still run where the harness's data lives, which project 3 fixes.
2. **Per-job sandbox containers** (the target, project 3): the strongest walls, but more moving parts.
3. **One tools container with process sandboxes** (bubblewrap/nsjail): thinner walls, and harder to debug.

## Decision

- **Engine:** rootless Podman with podman-compose. The user is not in `docker` or `lxd`, because both are root-equivalent.
- **GPU:** NVIDIA Container Toolkit, using CDI (`nvidia.com/gpu=0`), kept fresh by `nvidia-cdi-refresh`.
- **Images:** multi-stage builds. Bases are pinned by digest, the fork's source by commit, packages by version. The build context is deny-by-default. Users are non-root, 10001:10001.
  - `axol-harness`: python:3.14-slim, the built UI, and the MCP `time` server only.
  - `axol-llama`: the PrismML fork `prism-b12128-d7b2896`, built static for `sm_120a` on CUDA 13.2.1, with no HTTPS client and no bundled chat page.
- **Network:** one `internal: true` network. Only the harness port is published, on `127.0.0.1`. Neither container can reach the internet, so the agent has no `fetch` until sandboxes exist.
- **Data:** on the host, outside the images: `~/Axol-workspace` (user files), `~/.local/share/axol` (chats, memory), `~/Models` (read-only). The harness is mapped with `keep-id:uid=10001,gid=10001`.
- **Hardening:** read-only root filesystems, a 64 MB tmpfs `/tmp`, all capabilities dropped, `no-new-privileges`, memory, CPU and process limits.
- **Readiness:** liveness `/health` for the health checks; a `model_status` event for the UI.
- **Storage:** Podman's `graphroot` is pinned in `~/.config/containers/storage.conf`, because snap-packaged editors otherwise move it.

## Consequences

- Positive: proven on 2026-11-25. No internet from either container, the port is unreachable from the LAN, there are no secrets in the images, and the processes are read-only with no capabilities. Data survives a full `down`/`up`. 37.4 tok/s, the same as bare metal.
- Negative: no web access for the agent until project 3. The first model build downloads ~5.6 GB and compiles for ~6 min. Folders are fixed `${HOME}` paths, because podman-compose can't nest defaults.
- Follow-ups: logins and per-user folders, with file-tool path confinement before a second user (project 2). Job sandboxes and disk quotas (project 3). Systemd user services behind the desktop app (project 7).
