#!/usr/bin/env python3
"""axol: set up, start and stop Axol's containers on any machine.

Run it through ./axol from the repo root. It needs only Python 3 (no packages),
so it works before anything else is installed.

    ./axol setup        check this machine and write .env (asks, with defaults)
    ./axol doctor       check only
    ./axol start        start Axol and wait until it's ready
    ./axol stop         stop it (your data stays)
    ./axol status       what's running
    ./axol logs [name]  follow the logs (Ctrl+C stops watching, not Axol)
    ./axol rebuild      rebuild the images after changing code, then start
    ./axol autostart on|off   start Axol when this machine boots

Why each piece exists: docs/Architecture/Containers.md
"""

import argparse
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ENV_FILE = REPO / ".env"
HOME = Path.home()
STORAGE_CONF = HOME / ".config" / "containers" / "storage.conf"
UNIT_FILE = HOME / ".config" / "systemd" / "user" / "axol.service"

# The model image is built on CUDA 13.2.1, so the driver must support at least 13.2.
MIN_DRIVER_CUDA = (13, 2)
# Building the model image the first time needs this much free space (GB).
MIN_FREE_GB = 15

# Every setting in .env: (name, question, default). The defaults suit most machines.
SETTINGS = [
    ("AXOL_WORKSPACE_PATH", "Folder for your files (the agent reads and writes here)", str(HOME / "Axol-workspace")),
    ("AXOL_DATA_PATH", "Folder for Axol's chats and memory", str(HOME / ".local/share/axol")),
    ("AXOL_MODELS_PATH", "Folder that holds the model file (mounted read-only)", str(HOME / "Models/Bonsai-27B")),
    ("AXOL_MODEL_FILE", "Model file name inside that folder", "Ternary-Bonsai-2-27B-PQ2_0.gguf"),
    ("AXOL_PORT", "Port on this machine for the UI", "8000"),
    ("AXOL_GPU", "GPU to use (from `nvidia-ctk cdi list`)", "nvidia.com/gpu=0"),
    ("AXOL_CUDA_ARCH", "GPU architecture to compile for (detected)", "120"),
    ("AXOL_CTX_SIZE", "Context size in tokens (8192 fits 8 GB; more VRAM allows more)", "8192"),
]


# --------------------------------------------------------------------------- pure helpers (tested)

def cuda_arch(compute_cap: str) -> str:
    """nvidia-smi's compute capability ("12.0", "8.6") → CMake's architecture ("120", "86")."""
    major, _, minor = compute_cap.strip().partition(".")
    if not major.isdigit() or not (minor or "0").isdigit():
        raise ValueError(f"not a compute capability: {compute_cap!r}")
    return f"{major}{minor or '0'}"


def driver_cuda_version(nvidia_smi_output: str) -> tuple[int, int] | None:
    """The newest CUDA the driver supports, from `nvidia-smi`'s header ("CUDA Version: 13.2")."""
    m = re.search(r"CUDA Version:\s*(\d+)\.(\d+)", nvidia_smi_output)
    return (int(m.group(1)), int(m.group(2))) if m else None


def read_env(path: Path) -> dict[str, str]:
    """NAME=value lines; comments and blank lines are skipped."""
    values: dict[str, str] = {}
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                name, _, value = line.partition("=")
                values[name.strip()] = value.strip()
    return values


def env_text(values: dict[str, str]) -> str:
    lines = [
        "# Written by ./axol setup. Run it again to change these, or edit by hand.",
        "# Never committed (.gitignore) and never copied into an image (.containerignore).",
        "",
    ]
    for name, question, _ in SETTINGS:
        lines += [f"# {question}", f"{name}={values[name]}", ""]
    extra = {k: v for k, v in values.items() if k not in {s[0] for s in SETTINGS}}
    if extra:
        lines.append("# Other settings")
        lines += [f"{k}={v}" for k, v in extra.items()]
    return "\n".join(lines).rstrip() + "\n"


def storage_moved(xdg_data_home: str | None, home: Path, storage_conf_exists: bool) -> bool:
    """True when Podman would keep its storage somewhere unusual (a snap app's XDG_DATA_HOME)
    and nothing pins it: systemd, other terminals and the health checks would look elsewhere."""
    if storage_conf_exists or not xdg_data_home:
        return False
    return Path(xdg_data_home) != home / ".local" / "share"


def storage_conf_text(home: Path, uid: int) -> str:
    return (
        "# Keep Podman's images and containers in one place, whoever starts Podman.\n"
        "# (Snap apps like VSCodium change XDG_DATA_HOME, which otherwise moves this.)\n"
        "[storage]\n"
        'driver = "overlay"\n'
        f'graphroot = "{home}/.local/share/containers/storage"\n'
        f'runroot = "/run/user/{uid}/containers"\n'
    )


def unit_text(repo: Path, compose: str) -> str:
    return (
        "[Unit]\n"
        "Description=Axol (model + harness containers)\n"
        "Wants=network-online.target\n"
        "After=network-online.target\n\n"
        "[Service]\n"
        "Type=oneshot\n"
        "RemainAfterExit=yes\n"
        f"WorkingDirectory={repo}\n"
        f"ExecStart={compose} up -d\n"
        f"ExecStop={compose} down\n"
        "TimeoutStartSec=600\n\n"
        "[Install]\n"
        "WantedBy=default.target\n"
    )


# --------------------------------------------------------------------------- checks

@dataclass
class Check:
    name: str
    ok: bool | None  # True = fine, False = must fix, None = warning
    detail: str = ""
    fix: str = ""


def run(cmd: list[str], timeout: int = 30) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        return subprocess.CompletedProcess(cmd, 127, "", str(e))


def checks(env: dict[str, str]) -> list[Check]:
    out: list[Check] = []

    # Podman, rootless, compose
    if shutil.which("podman"):
        rootless = run(["podman", "info", "--format", "{{.Host.Security.Rootless}}"]).stdout.strip()
        out.append(Check("Podman, rootless", rootless == "true", f"rootless={rootless or '?'}",
                         "run Podman as your normal user, never with sudo"))
    else:
        out.append(Check("Podman", False, "not installed", "sudo apt install podman"))
    out.append(Check("podman-compose", bool(shutil.which("podman-compose")), "",
                     "sudo apt install podman-compose"))

    # Groups that are root without a password
    groups = run(["id", "-nG"]).stdout.split()
    risky = [g for g in ("docker", "lxd") if g in groups]
    out.append(Check("No root-equivalent groups", None if risky else True,
                     f"you're in: {', '.join(risky)}" if risky else "",
                     " ; ".join(f"sudo gpasswd -d $USER {g}" for g in risky) + " (then log out and in)" if risky else ""))

    # Spare user IDs for rootless containers
    user = os.environ.get("USER", "")
    subuid = Path("/etc/subuid").read_text() if Path("/etc/subuid").exists() else ""
    out.append(Check("Spare user IDs (/etc/subuid)", any(l.startswith(f"{user}:") for l in subuid.splitlines()),
                     "", f"sudo usermod --add-subuids 100000-165535 --add-subgids 100000-165535 {user}"))

    # Podman storage pinned when a snap app moved it
    moved = storage_moved(os.environ.get("XDG_DATA_HOME"), HOME, STORAGE_CONF.exists())
    out.append(Check("Podman storage in one place", None if moved else True,
                     "XDG_DATA_HOME points into a snap folder" if moved else "",
                     "./axol setup writes ~/.config/containers/storage.conf"))

    # GPU, driver, container toolkit
    smi = run(["nvidia-smi"])
    if smi.returncode == 0:
        version = driver_cuda_version(smi.stdout)
        ok = version is not None and version >= MIN_DRIVER_CUDA
        need = ".".join(map(str, MIN_DRIVER_CUDA))
        out.append(Check(f"NVIDIA driver supports CUDA ≥ {need}", ok,
                         f"supports {'.'.join(map(str, version))}" if version else "unknown",
                         "update the NVIDIA driver (sudo ubuntu-drivers install)"))
    else:
        out.append(Check("NVIDIA GPU and driver", False, "nvidia-smi not working",
                         "install the NVIDIA driver (sudo ubuntu-drivers install)"))
    if shutil.which("nvidia-ctk"):
        cdi = run(["nvidia-ctk", "cdi", "list"]).stdout
        gpu = env.get("AXOL_GPU", "nvidia.com/gpu=0")
        out.append(Check(f"GPU visible to containers ({gpu})", gpu in cdi, "",
                         "sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml"))
    else:
        out.append(Check("NVIDIA Container Toolkit", False, "nvidia-ctk not installed",
                         "install it from NVIDIA's apt repository: "
                         "https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html"))

    # Settings, folders, model
    missing = [name for name, _, _ in SETTINGS if not env.get(name)]
    out.append(Check("Settings (.env)", not missing, f"missing: {', '.join(missing)}" if missing else "",
                     "./axol setup"))
    for name in ("AXOL_WORKSPACE_PATH", "AXOL_DATA_PATH"):
        if env.get(name):
            out.append(Check(f"Folder {env[name]}", Path(env[name]).is_dir(), "", f"mkdir -p {env[name]}"))
    if env.get("AXOL_MODELS_PATH") and env.get("AXOL_MODEL_FILE"):
        model = Path(env["AXOL_MODELS_PATH"]) / env["AXOL_MODEL_FILE"]
        out.append(Check("Model file", model.is_file(), str(model),
                         "hf download prism-ml/Ternary-Bonsai-2-27B-gguf Ternary-Bonsai-2-27B-PQ2_0.gguf "
                         f"--local-dir {env['AXOL_MODELS_PATH']}"))

    # Disk space for the first build
    free = shutil.disk_usage(HOME).free / 1e9
    out.append(Check(f"Free disk space (≥ {MIN_FREE_GB} GB for the first build)",
                     True if free >= MIN_FREE_GB else None, f"{free:.0f} GB free", "free some space"))
    return out


def print_checks(results: list[Check]) -> bool:
    for c in results:
        mark = {True: "✓", False: "✗", None: "!"}[c.ok]
        print(f"  {mark} {c.name}" + (f"  ({c.detail})" if c.detail else ""))
        if c.ok is not True and c.fix:
            print(f"      fix: {c.fix}")
    failed = [c for c in results if c.ok is False]
    print("\nReady." if not failed else f"\n{len(failed)} thing(s) to fix before Axol can start.")
    return not failed


# --------------------------------------------------------------------------- commands

def compose(*args: str, timeout: int | None = None) -> int:
    return subprocess.run(["podman-compose", *args], cwd=REPO, timeout=timeout).returncode


def detected_arch() -> str | None:
    r = run(["nvidia-smi", "--query-gpu=compute_cap", "--format=csv,noheader"])
    try:
        return cuda_arch(r.stdout.splitlines()[0]) if r.returncode == 0 and r.stdout.strip() else None
    except ValueError:
        return None


def cmd_setup(args) -> int:
    current = read_env(ENV_FILE)
    defaults = {name: default for name, _, default in SETTINGS}
    arch = detected_arch()
    if arch:
        defaults["AXOL_CUDA_ARCH"] = arch
    values = dict(current)
    print("Axol setup. Press Enter to keep the value in [brackets].\n")
    for name, question, _ in SETTINGS:
        suggestion = current.get(name) or defaults[name]
        if name == "AXOL_CUDA_ARCH" and arch and current.get(name) and current[name] != arch:
            print(f"  note: this machine's GPU is {arch}, .env says {current[name]}")
        answer = "" if args.yes else input(f"{question}\n  [{suggestion}] ").strip()
        values[name] = answer or suggestion
    ENV_FILE.write_text(env_text(values), encoding="utf-8")
    print(f"\nWrote {ENV_FILE}")

    for name in ("AXOL_WORKSPACE_PATH", "AXOL_DATA_PATH"):
        Path(values[name]).mkdir(parents=True, exist_ok=True)

    if storage_moved(os.environ.get("XDG_DATA_HOME"), HOME, STORAGE_CONF.exists()):
        print("\nPodman's storage would move with this app's XDG_DATA_HOME (a snap app).")
        answer = "y" if args.yes else input(f"Pin it in {STORAGE_CONF}? [Y/n] ").strip().lower()
        if answer in ("", "y", "yes"):
            STORAGE_CONF.parent.mkdir(parents=True, exist_ok=True)
            STORAGE_CONF.write_text(storage_conf_text(HOME, os.getuid()), encoding="utf-8")
            print(f"Wrote {STORAGE_CONF}")

    print("\nChecking this machine:")
    return 0 if print_checks(checks(values)) else 1


def cmd_doctor(_args) -> int:
    print("Checking this machine:")
    return 0 if print_checks(checks(read_env(ENV_FILE))) else 1


def project_status() -> dict[str, str]:
    r = run(["podman", "ps", "--filter", "label=io.podman.compose.project=axol",
             "--format", "{{.Names}}\t{{.Status}}"])
    return dict(line.split("\t", 1) for line in r.stdout.splitlines() if "\t" in line)


def cmd_start(args) -> int:
    if not ENV_FILE.is_file():
        print("No settings yet: run ./axol setup first.")
        return 1
    have_images = all(run(["podman", "image", "exists", f"localhost/{i}:latest"]).returncode == 0
                      for i in ("axol-llama", "axol-harness"))
    if not have_images:
        print("Building the images first (the first time: ~5.6 GB download, a few minutes)…")
    rc = compose("up", "-d", *([] if have_images and not args.build else ["--build"]))
    if rc != 0:
        return rc
    port = read_env(ENV_FILE).get("AXOL_PORT", "8000")
    print("Waiting for both containers to be ready", end="", flush=True)
    deadline = time.time() + 180
    while time.time() < deadline:
        st = project_status()
        if len(st) >= 2 and all("(healthy)" in s for s in st.values()):
            print(f"\nAxol is ready: http://127.0.0.1:{port}")
            return 0
        if any("Exited" in s for s in st.values()):
            break
        print(".", end="", flush=True)
        time.sleep(3)
    print("\nNot ready yet. See ./axol status and ./axol logs")
    return 1


def cmd_stop(_args) -> int:
    return compose("down")


def cmd_status(_args) -> int:
    st = project_status()
    if not st:
        print("Axol isn't running. Start it with ./axol start")
    for name, status in st.items():
        print(f"  {name:24} {status}")
    return 0


def cmd_logs(args) -> int:
    try:
        return compose("logs", "-f", *([args.service] if args.service else []))
    except KeyboardInterrupt:
        return 0


def cmd_rebuild(args) -> int:
    args.build = True
    return cmd_start(args)


def cmd_autostart(args) -> int:
    if args.state == "on":
        exe = shutil.which("podman-compose") or "/usr/bin/podman-compose"
        UNIT_FILE.parent.mkdir(parents=True, exist_ok=True)
        UNIT_FILE.write_text(unit_text(REPO, exe), encoding="utf-8")
        run(["systemctl", "--user", "daemon-reload"])
        rc = run(["systemctl", "--user", "enable", "axol.service"]).returncode
        # Lingering: your user services start at boot, before (and without) logging in.
        linger = run(["loginctl", "enable-linger", os.environ.get("USER", "")]).returncode
        print(f"Wrote {UNIT_FILE}")
        print("Axol will start when this machine boots." if rc == 0 else "Could not enable the service.")
        if linger != 0:
            print("Could not enable lingering: Axol will start when you log in, not at boot.")
        return rc
    run(["systemctl", "--user", "disable", "axol.service"])
    UNIT_FILE.unlink(missing_ok=True)
    run(["systemctl", "--user", "daemon-reload"])
    print("Axol won't start at boot any more. (Lingering is left as it was: "
          "`loginctl disable-linger $USER` turns it off.)")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="axol", description="Set up, start and stop Axol.")
    sub = p.add_subparsers(dest="command", required=True)
    s = sub.add_parser("setup", help="check this machine and write .env")
    s.add_argument("--yes", action="store_true", help="accept every default without asking")
    sub.add_parser("doctor", help="check this machine")
    st = sub.add_parser("start", help="start Axol and wait until it's ready")
    st.add_argument("--build", action="store_true", help="rebuild the images first")
    sub.add_parser("stop", help="stop Axol (your data stays)")
    sub.add_parser("status", help="what's running")
    lg = sub.add_parser("logs", help="follow the logs")
    lg.add_argument("service", nargs="?", choices=["axol-llama", "axol-harness"])
    sub.add_parser("rebuild", help="rebuild the images, then start")
    au = sub.add_parser("autostart", help="start Axol when this machine boots")
    au.add_argument("state", choices=["on", "off"])
    args = p.parse_args(argv)
    commands = {"setup": cmd_setup, "doctor": cmd_doctor, "start": cmd_start, "stop": cmd_stop,
                "status": cmd_status, "logs": cmd_logs, "rebuild": cmd_rebuild, "autostart": cmd_autostart}
    return commands[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
