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
