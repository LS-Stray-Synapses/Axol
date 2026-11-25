import os
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent          # modules/settings.py → repo root

# The UI in dev (Vite) and when the harness serves the built UI itself.
DEFAULT_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
)


@dataclass(frozen=True)
class Settings:
    llama_url: str
    ollama_url: str | None
    data_dir: Path
    workspace_dir: Path
    mcp_config: Path
    allowed_origins: tuple[str, ...]


def load_settings() -> Settings:
    ollama = os.environ.get("AXOL_OLLAMA_URL", "http://localhost:11434/v1")

    return Settings(
        llama_url=os.environ.get("AXOL_LLAMA_URL", "http://localhost:8080/v1"),
        ollama_url=ollama or None,
        data_dir=Path(os.environ.get("AXOL_DATA_DIR", REPO_ROOT)),
        workspace_dir=Path(os.environ.get("AXOL_WORKSPACE_DIR", REPO_ROOT / "workspace")),
        mcp_config=Path(os.environ.get("AXOL_MCP_CONFIG", REPO_ROOT / "mcp_server.json")),
        allowed_origins=_origins(os.environ.get("AXOL_ALLOWED_ORIGINS")),
    )


def _origins(value: str | None) -> tuple[str, ...]:
    """Split "a, b/" into ("a", "b"). Unset gives the defaults."""
    if value is None:
        return DEFAULT_ORIGINS
    return tuple(o.strip().rstrip("/") for o in value.split(",") if o.strip())
