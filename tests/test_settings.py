from pathlib import Path

from modules.settings import load_settings

REPO_ROOT = Path(__file__).parent.parent

AXOL_VARS = [
    "AXOL_LLAMA_URL",
    "AXOL_OLLAMA_URL",
    "AXOL_DATA_DIR",
    "AXOL_WORKSPACE_DIR",
    "AXOL_MCP_CONFIG",
    "AXOL_ALLOWED_ORIGINS",
]

FAKE_VALUES = {
    "AXOL_LLAMA_URL": "http://fake-llama:1/v1",
    "AXOL_OLLAMA_URL": "http://fake-ollama:1/v1",
    "AXOL_DATA_DIR": "/fake",
    "AXOL_WORKSPACE_DIR": "/fake/workspace",
    "AXOL_MCP_CONFIG": "/fake/config",
    "AXOL_ALLOWED_ORIGINS": "http://fake-ui:1",
}


def test_defaults_match_today(monkeypatch):
    for var in AXOL_VARS:
        monkeypatch.delenv(var, raising=False)

    settings = load_settings()

    assert settings.llama_url == "http://localhost:8080/v1"
    assert settings.ollama_url == "http://localhost:11434/v1"
    assert settings.data_dir == REPO_ROOT
    assert settings.workspace_dir == REPO_ROOT / "workspace"
    assert settings.mcp_config == REPO_ROOT / "mcp_server.json"
    assert settings.allowed_origins == (
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    )


def test_empty_ollama_disables_it(monkeypatch):
    monkeypatch.setenv("AXOL_OLLAMA_URL", "")

    settings = load_settings()

    assert settings.ollama_url is None


def test_paths_are_paths(monkeypatch):
    monkeypatch.setenv("AXOL_DATA_DIR", "test")

    settings = load_settings()

    assert isinstance(settings.data_dir, Path)


def test_env_overrides(monkeypatch):
    for name, value in FAKE_VALUES.items():
        monkeypatch.setenv(name, value)

    settings = load_settings()

    assert settings.llama_url == FAKE_VALUES["AXOL_LLAMA_URL"]
    assert settings.ollama_url == FAKE_VALUES["AXOL_OLLAMA_URL"]
    assert settings.data_dir == Path(FAKE_VALUES["AXOL_DATA_DIR"])
    assert settings.workspace_dir == Path(FAKE_VALUES["AXOL_WORKSPACE_DIR"])
    assert settings.mcp_config == Path(FAKE_VALUES["AXOL_MCP_CONFIG"])
    assert settings.allowed_origins == (FAKE_VALUES["AXOL_ALLOWED_ORIGINS"],)


def test_origins_are_a_comma_separated_list(monkeypatch):
    monkeypatch.setenv("AXOL_ALLOWED_ORIGINS", " http://a:1 , http://b:2/ ,")

    settings = load_settings()

    assert settings.allowed_origins == ("http://a:1", "http://b:2")
