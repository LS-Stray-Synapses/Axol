# Project 1: Containers (teaching plan)

> **How this plan is used:** Lenos builds every step. Claude teaches each lesson (the concepts, why it matters for security, what to decide) and reviews the result, but does not write the code or config. Work one lesson at a time and tick the boxes as you go.

**Goal:** Axol runs in two rootless containers, llama.cpp on the GPU and harness + built UI, with all data on the host, nothing running as your user, and llama.cpp unable to reach the internet.

**Architecture:** Two images and one compose file. `axol-llama` sits only on an internal network with no internet, has the GPU, and mounts the model read-only. `axol-harness` sits on the internal network plus an edge network, is published on `127.0.0.1:8000` only, serves the UI it was built with, and keeps its data in a host folder.

**Tech stack:** Podman 5.7 (rootless) with `podman compose`, NVIDIA Container Toolkit (CDI), CUDA base images, Python 3.11+ / FastAPI, Node 22 for the UI build stage, llama.cpp (official, then the prism fork).

**Spec:** [docs/superpowers/specs/2026-11-23-containerization-security-design.md](../specs/2026-11-23-containerization-security-design.md), §12 Project 1.

## What your machine has today (checked 2026-11-23)

- Ubuntu 26.04, RTX 5060 Laptop (8 GB), driver 595.99.
- **Podman 5.7, rootless, already working.** The `docker` command is Podman's Docker emulation (`podman-docker`). `docker.io` is also installed, but its service is inactive.
- `podman-compose` and `docker-compose` are both present.
- **NVIDIA Container Toolkit: not installed.**
- Your account is in the **`docker`** and **`lxd`** groups. Both are root-equivalent.
- Models: `~/Models/Bonsai-27B/` holds Q2_0 (7.2 GB) and PQ2_0 (6.8 GB).

## Global constraints

- Container engine: **rootless Podman**. Nothing in this project needs root at runtime.
- Processes inside every container run as a **non-root user**.
- Harness published on **`127.0.0.1:8000` only**. llama.cpp is **not published** at all.
- llama.cpp container: **no internet**, model mounted **read-only**.
- **No secrets or user data in any image.** Secrets come from `.env` (already gitignored). Commit `.env.example` with names only.
- `fetch` MCP server **off** in containers. `time` stays on, installed at build time (no `uvx` downloads at start).
- Ollama models are left out in containers.
- Host data folder: **`~/.local/share/axol/`**, with `sessions/`, `workspace/` and `memory.md` inside. This is the standard Linux place for app data, and the project 7 app will use it too.
- Outside containers, Axol keeps working exactly as today: same paths, same three-terminal dev setup.
- `mock_server.py` changes in 1.2 and 1.7 touch the backend you share with Stefanos. Tell him before you merge.

## File map

| Path | Lesson | Responsibility |
|---|---|---|
| `mock_server.py` (modify) | 1.2, 1.7 | read settings from env; report model readiness; `/health` |
| `modules/settings.py` (create) | 1.2 | one place that reads env vars and gives defaults |
| `tests/test_settings.py`, `tests/test_model_status.py` (create) | 1.2, 1.7 | pytest tests for the above |
| `requirements-dev.txt` (create) | 1.2 | pinned `pytest` (dev only, never in the image) |
| `deploy/harness/Containerfile` | 1.3 | harness image: UI build stage + Python runtime stage |
| `deploy/harness/mcp_server.json` | 1.3 | container MCP config: `time` only |
| `deploy/llama/Containerfile` | 1.4b | prism fork build stage + runtime stage |
| `.containerignore` | 1.3 | keep `.venv`, `.env`, `sessions/`, `workspace/`, `memory.md`, `node_modules`, `web/dist`, `docs/`, `.git` out of the build |
| `compose.yaml` | 1.5, 1.6 | two services, two networks, mounts, health, limits |
| `.env.example` | 1.5 | variable names, no values |
| `web/src/contract.ts` + UI (modify) | 1.7 | new `model_status` event, a "model loading" banner |
| `docs/Decisions/ADR-0005-containers.md` | 1.8 | what we chose and why, with the proof checklist |
| `docs/Architecture/Threat Model.md` | 1.8 | first version of the one-page threat model |

## Review focus (what's most likely to bite)

1. **Port open to the whole network.** Publishing `8000:8000` without `127.0.0.1` makes Axol reachable from Wi-Fi/VPN with no login. *Expected:* it's only reachable from this machine. Checked in 1.5 and 1.8.
2. **File ownership on mounts.** With rootless Podman and a non-root container user, writes to `sessions/` fail with "permission denied", or files show up on the host owned by a strange number instead of `lenos`. *Expected:* new files on the host belong to `lenos`. Checked in 1.5.
3. **First message while the model is still loading.** *Expected:* "model loading…" in the UI, not an error. Tested in 1.7.
4. **Secrets or data baked into the image** by a broad copy. *Expected:* no `.env`, `sessions/`, `memory.md`, `.venv` in the image. Checked in 1.3.
5. **Data lost on restart** because something wrote inside the container instead of the mount. *Expected:* deleting and recreating both containers keeps chats and memory. Checked in 1.5 and 1.8.

---

### Lesson 1.1: Host prep (engine, GPU, permissions)

**Why:** the container engine is the most powerful thing on your machine. Rootless Podman means even a container that breaks out lands as your normal user, not root. The `docker`/`lxd` groups quietly undo that, because anyone in them can become root.

**Learn first:** images vs containers · rootless vs rootful · user namespaces (how "root" inside a container maps to you outside) · what CDI is and how a GPU gets passed into a container · why group membership can equal root.

**Decisions locked:** rootless Podman. GPU through NVIDIA Container Toolkit + a CDI spec. Leave the `docker` and `lxd` groups unless something you use needs them (you decide after the lesson).

- [ ] Install the NVIDIA Container Toolkit from NVIDIA's apt repository.
- [ ] Generate the CDI spec for your GPU and list the devices it found.
- [ ] Run a throwaway CUDA base container, rootless, with the GPU device, that runs `nvidia-smi`.
- [ ] Decide about the `docker` and `lxd` groups and the unused `docker.io` package. Write down why.
- [ ] **Check:** inside the container, `nvidia-smi` shows the RTX 5060. `podman info` reports rootless `true`.
- [ ] Note in the vault what you installed and why (it goes into the ADR in 1.8).

**Pitfalls:** the CDI spec has to be regenerated after a driver update, or the GPU silently disappears from containers. The CUDA version in an image must not be newer than what driver 595 supports.

### Lesson 1.2: Config out of code

**Why:** an image should be the same everywhere. Where things are (model URL, data folder) is configuration, and inside a container `localhost` means the container itself, not your machine.

**Learn first:** environment variables · the "12-factor" config idea · defaults that keep old behaviour · writing a small test first (pytest).

**Decisions locked:**

| Variable | Default (today's behaviour) | In compose |
|---|---|---|
| `AXOL_LLAMA_URL` | `http://localhost:8080/v1` | `http://axol-llama:8080/v1` |
| `AXOL_OLLAMA_URL` | `http://localhost:11434/v1`; **empty string = leave Ollama models out** | empty |
| `AXOL_DATA_DIR` | repo root (so `sessions/`, `workspace/`, `memory.md` stay where they are) | `/data` |
| `AXOL_MCP_CONFIG` | repo `mcp_server.json` | `/app/deploy/harness/mcp_server.json` |

`modules/settings.py` holds one function, `load_settings() -> Settings`, where `Settings` is a small frozen dataclass or pydantic model with `llama_url: str`, `ollama_url: str | None`, `data_dir: Path`, `mcp_config: Path`. `mock_server.py` builds `WORKSPACE`, `MEMORY_FILE`, `SESSIONS`, `MCP_CONFIG` and `MODELS` from it. `PLUGINS_DIR` and `DIST_DIR` stay relative to the code, because they're part of the app, not data.

- [ ] Add `requirements-dev.txt` with a pinned `pytest`, and install it into `.venv`.
- [ ] Write `tests/test_settings.py` first:
  - `test_defaults_match_today`: with no env vars set, the URLs equal today's values and `data_dir` is the repo root.
  - `test_env_overrides`: with all four vars set, each field equals the var.
  - `test_empty_ollama_disables_it`: `AXOL_OLLAMA_URL=""` gives `ollama_url is None`.
- [ ] Run the tests and watch them fail. Then write `load_settings`, then watch them pass.
- [ ] Wire `mock_server.py` to use it. When `ollama_url` is `None`, the Qwen entries aren't added to `MODELS`.
- [ ] **Check:** the normal three-terminal setup still works end to end (send a message, get an answer, memory still loads).
- [ ] Commit, and tell Stefanos.

### Lesson 1.3: The harness image

**Why:** the image is what you trust. Whatever goes into it ships everywhere. A small, non-root image with pinned dependencies and nothing secret is the first wall.

**Learn first:** Containerfile basics · layers and caching (why you copy `requirements.txt` before the code) · multi-stage builds · build context and `.containerignore` · non-root `USER` · why `uvx` at runtime is a supply-chain and network problem.

**Decisions locked:**
- **Stage 1** (Node 22) runs `npm ci` and `npm run build` in `web/`.
- **Stage 2** (slim Python) installs `requirements.txt` plus `mcp-server-time` (pinned), copies `modules/`, `mock_server.py`, `plugins/`, `deploy/harness/mcp_server.json` and **only** `web/dist` from stage 1, then switches to a non-root user and runs uvicorn on `0.0.0.0:8000` *inside* the container. Publishing to `127.0.0.1` happens in compose.
- `deploy/harness/mcp_server.json` lists only `time`, launched by its installed command, not `uvx`.
- Image name: `axol-harness`.

- [ ] Write `.containerignore`.
- [ ] Write the Containerfile, build it, and run it alone with `AXOL_DATA_DIR` pointed at a temporary mount.
- [ ] **Check:** the UI loads at `http://127.0.0.1:8000`. The Tools tab shows `time` and the file tools, not `fetch`.
- [ ] **Check (review focus 4):** list the files inside the image. No `.env`, `sessions/`, `memory.md`, `.venv`, `node_modules` or `docs/`. The process user is not root.
- [ ] Note the image size. Then commit.

**Pitfall:** with no model running, a chat message errors here. That's expected until 1.5.

### Lesson 1.4: The llama.cpp image (two parts)

**Why:** llama.cpp is the part with the GPU. It needs nothing else: no internet, no write access, no files except the model.

**Learn first:** CUDA base vs runtime images · GPU compute architecture (the RTX 5060 is Blackwell, `sm_120`) · read-only mounts · pinning an image by digest, not by tag · health checks (`llama-server` has `/health`, which answers "not ready" while the model loads).

**1.4a: Official prebuilt image** (learn the moving parts before building your own)
- [ ] Pull the official llama.cpp CUDA server image and **pin it by digest**.
- [ ] Run it rootless with the GPU, `~/Models/Bonsai-27B` mounted read-only, the Q2_0 model, `-c 8192`, `--jinja`, alias `bonsai-2:27b`, and no network except a port for testing.
- [ ] **Check:** `/health` goes from "loading" to "ok". Speed is close to the official Q2_0 numbers in `~/llama/RESULTS.md` (about 24 tok/s, 60/64 layers).

**1.4b: Build the prism fork yourself** (your fastest setup)
- [ ] `deploy/llama/Containerfile`: a CUDA *devel* stage builds the fork with architecture `120`. A CUDA *runtime* stage gets only the built binaries and libraries it needs, runs as a non-root user, and has a health check on `/health`.
- [ ] Solve the fork's library path inside the image (today it borrows the official build's CUDA libs).
- [ ] Image name: `axol-llama`.
- [ ] **Check:** PQ2_0, all layers on the GPU, 8K context, around 36 tok/s.
- [ ] Commit.

**Pitfalls:** building for the wrong architecture compiles fine but then runs on the CPU, or crashes. The runtime image needs the matching CUDA libs. Too little VRAM shows up as partial offload, so watch the load log.

### Lesson 1.5: Compose: both together

**Why:** this is where the network walls get built. The internal network is what keeps llama.cpp off the internet, and `127.0.0.1` keeps Axol off your LAN.

**Learn first:** compose services · user-defined networks and `internal: true` · service names as hostnames · bind mounts vs named volumes · `userns` / `keep-id` for rootless file ownership · `depends_on` with `condition: service_healthy` · restart policies · env files.

**Decisions locked:**
- Networks: `axol-internal` (`internal: true`, both services) and `axol-edge` (harness only, so its port can be published).
- `axol-llama`: on `axol-internal` only, no published ports, GPU device, `~/Models/Bonsai-27B` read-only.
- `axol-harness`: `127.0.0.1:8000:8000`, `~/.local/share/axol` mounted at `/data`, env from `.env`, starts after llama is healthy, restart `unless-stopped`.
- Rootless ownership: use `keep-id` (or an equivalent UID mapping), so files the container writes belong to `lenos` on the host.

- [ ] Create `~/.local/share/axol/` and copy in your current `memory.md` and `workspace/` if you want to keep them.
- [ ] Write `compose.yaml` and `.env.example`.
- [ ] Bring it up, open the UI, chat, save a memory.
- [ ] **Check (review focus 2):** the new session file on the host belongs to `lenos`.
- [ ] **Check (review focus 5):** take both containers down and remove them, bring them back up, and the conversation and memory are still there.
- [ ] **Check (review focus 1):** `:8000` answers on `127.0.0.1` but not on your machine's LAN/VPN address.
- [ ] Commit.

### Lesson 1.6: Hardening

**Why:** if something inside a container goes wrong, these limits decide how much it can do: freeze the machine, fill the disk, gain more privileges.

**Learn first:** Linux capabilities and dropping all of them · `no-new-privileges` · read-only root filesystem plus `tmpfs` for scratch space · memory, CPU and `pids` limits (the `pids` limit is what stops a fork bomb).

**Decisions locked:** both services get all capabilities dropped, `no-new-privileges`, a read-only root filesystem, `tmpfs` for `/tmp`, and a `pids` limit. Harness: memory and CPU limits sized from what you see it use. llama.cpp: memory limit sized to the model plus headroom.

- [ ] Add one restriction at a time, and restart after each one, so you know which restriction broke something.
- [ ] **Check:** everything from 1.5 still works. Show each restriction is active (inspect the running container; try writing outside `/data` and `/tmp` inside the harness, and it fails).
- [ ] Commit.

### Lesson 1.7: Ready signal

**Why:** a big model takes many seconds to load. The UI should say so instead of failing. The project 7 app's loading screen will use this same signal.

**Learn first:** liveness ("the process is up") vs readiness ("it can do work") · polling a health endpoint · adding an event to the contract on both sides.

**Decisions locked:**
- Harness `GET /health` returns `{"ok": true}` when the process is up. Compose uses it for the harness health check.
- The harness polls `AXOL_LLAMA_URL`'s server `/health` every 2 s and tracks `model_status`: `"loading" | "ready" | "unreachable"`.
- New server event in `web/src/contract.ts`: `{ type: "model_status"; state: "loading" | "ready" | "unreachable" }`. It's sent on connect and whenever the state changes, and added to `SERVER_CHECKS`.
- The UI shows a banner while the state isn't `ready`, and the send button is disabled.

- [ ] Write `tests/test_model_status.py` first, against a small function `classify_health(status_code: int | None) -> str`:
  - `200` gives `"ready"`
  - `503` gives `"loading"`
  - `None` (connection refused) gives `"unreachable"`
- [ ] Add a unit test in `web/tests/unit/contract.test.ts`: a valid `model_status` event passes the checks, and an unknown `state` is rejected.
- [ ] Implement, then watch both test suites pass.
- [ ] **Check (review focus 3):** restart only `axol-llama` while the UI is open. The banner shows "loading" and then goes away, and nothing errors.
- [ ] Commit, and tell Stefanos (it's a contract change).

### Lesson 1.8: Prove it, write it down

**Why:** security you haven't tested is a guess. The ADR keeps the reasons for when you or Stefanos come back to this later.

- [ ] From inside `axol-llama`, any attempt to reach the internet fails.
- [ ] From inside `axol-harness`, your home folder isn't visible. Only `/data` and the app are.
- [ ] `:8000` isn't reachable from another device on your network.
- [ ] Neither image contains `.env` or user data (repeat the 1.3 check on the final images).
- [ ] Remove both containers, bring them back up, and everything is still there.
- [ ] Write `docs/Decisions/ADR-0005-containers.md`: what was chosen in 1.1 to 1.7, why, the known gap (the harness can still reach the internet; closed in project 3), and this checklist with results.
- [ ] Write the first one-page threat model, `docs/Architecture/Threat Model.md`: who or what we defend against, and which part of the design stops each one (design §5.3, item 10).
- [ ] Update `README.md`'s "Run it" section with the container way, keeping the dev way.
- [ ] Commit.

**When 1.8 is done, project 1 is done.** Next is either project 2 (people and logins) or project 7 (the app) if you want the nice start sooner.
