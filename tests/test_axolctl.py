from pathlib import Path

import pytest

from deploy import axolctl

NVIDIA_SMI_HEADER = """
+-----------------------------------------------------------------------------------------+
| NVIDIA-SMI 595.99.02              Driver Version: 595.99.02      CUDA Version: 13.2     |
+-----------------------------------------+------------------------+----------------------+
"""


def test_cuda_arch_from_compute_capability():
    assert axolctl.cuda_arch("12.0") == "120"  # RTX 50xx (Blackwell)
    assert axolctl.cuda_arch("8.6") == "86"  # RTX 30xx
    assert axolctl.cuda_arch(" 8.9\n") == "89"


def test_cuda_arch_rejects_garbage():
    with pytest.raises(ValueError):
        axolctl.cuda_arch("[N/A]")


def test_driver_cuda_version_from_nvidia_smi():
    assert axolctl.driver_cuda_version(NVIDIA_SMI_HEADER) == (13, 2)
    assert axolctl.driver_cuda_version("no header here") is None


def test_env_round_trip(tmp_path):
    values = {name: f"value-{i}" for i, (name, _, _) in enumerate(axolctl.SETTINGS)}
    values["EXTRA_KEY"] = "kept"
    env = tmp_path / ".env"

    env.write_text(axolctl.env_text(values))

    assert axolctl.read_env(env) == values


def test_read_env_skips_comments_and_blanks(tmp_path):
    env = tmp_path / ".env"
    env.write_text("# comment\n\nAXOL_PORT = 8001\n#AXOL_GPU=x\n")

    assert axolctl.read_env(env) == {"AXOL_PORT": "8001"}


def test_read_env_missing_file_is_empty(tmp_path):
    assert axolctl.read_env(tmp_path / "nope") == {}


def test_storage_moved_only_for_unusual_data_home():
    home = Path("/home/u")
    assert axolctl.storage_moved("/home/u/snap/codium/495/.local/share", home, storage_conf_exists=False)
    assert not axolctl.storage_moved("/home/u/snap/codium/495/.local/share", home, storage_conf_exists=True)
    assert not axolctl.storage_moved("/home/u/.local/share", home, storage_conf_exists=False)
    assert not axolctl.storage_moved(None, home, storage_conf_exists=False)


def test_storage_conf_uses_this_user():
    text = axolctl.storage_conf_text(Path("/home/u"), 1234)

    assert 'graphroot = "/home/u/.local/share/containers/storage"' in text
    assert 'runroot = "/run/user/1234/containers"' in text


def test_unit_starts_and_stops_compose_in_the_repo():
    text = axolctl.unit_text(Path("/srv/axol"), "/usr/bin/podman-compose")

    assert "WorkingDirectory=/srv/axol" in text
    assert "ExecStart=/usr/bin/podman-compose up -d" in text
    assert "ExecStop=/usr/bin/podman-compose down" in text
    assert "WantedBy=default.target" in text


def test_every_setting_used_by_compose_is_asked_for():
    compose = (axolctl.REPO / "compose.yaml").read_text()
    used = set(__import__("re").findall(r"\$\{(AXOL_[A-Z_]+)", compose))

    assert used <= {name for name, _, _ in axolctl.SETTINGS}


# --------------------------------------------------------------------------- the model download

import hashlib
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

CONTENT = bytes(range(256)) * 4096  # 1 MiB
CONTENT_SHA = hashlib.sha256(CONTENT).hexdigest()


@pytest.fixture
def file_server():
    """A tiny local server that, like Hugging Face, honours Range for resuming."""

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            start = 0
            if rng := self.headers.get("Range"):
                start = int(rng.removeprefix("bytes=").split("-")[0])
                self.send_response(206)
            else:
                self.send_response(200)
            body = CONTENT[start:]
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}/model.gguf"
    server.shutdown()


def test_download_checks_the_fingerprint(tmp_path, file_server):
    dest = tmp_path / "model.gguf"

    axolctl.download(file_server, dest, CONTENT_SHA, len(CONTENT))

    assert dest.read_bytes() == CONTENT
    assert not (tmp_path / "model.gguf.part").exists()


def test_download_resumes_a_partial_file(tmp_path, file_server):
    dest = tmp_path / "model.gguf"
    (tmp_path / "model.gguf.part").write_bytes(CONTENT[:1000])

    axolctl.download(file_server, dest, CONTENT_SHA, len(CONTENT))

    assert dest.read_bytes() == CONTENT


def test_download_with_wrong_fingerprint_keeps_nothing(tmp_path, file_server):
    dest = tmp_path / "model.gguf"

    with pytest.raises(ValueError, match="fingerprint mismatch"):
        axolctl.download(file_server, dest, "0" * 64, len(CONTENT))

    assert not dest.exists()
    assert not (tmp_path / "model.gguf.part").exists()


def test_known_model_matches_this_setup():
    url, sha, size = axolctl.KNOWN_MODELS["Ternary-Bonsai-2-27B-PQ2_0.gguf"]

    assert url.startswith("https://huggingface.co/prism-ml/")
    assert len(sha) == 64 and size > 7e9


def test_rebuild_only_when_an_image_changes():
    assert axolctl.needs_rebuild(["mock_server.py"])
    assert axolctl.needs_rebuild(["web/src/store.ts", "README.md"])
    assert axolctl.needs_rebuild(["deploy/llama/Containerfile"])
    assert axolctl.needs_rebuild(["compose.yaml"])
    assert not axolctl.needs_rebuild(["README.md", "docs/Home.md", "tests/test_settings.py"])
    assert not axolctl.needs_rebuild(["deploy/axolctl.py"])  # the tool itself isn't in an image
    assert not axolctl.needs_rebuild([])
