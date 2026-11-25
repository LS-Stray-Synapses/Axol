"""Is the model server ready? Lets the UI say "waking the model…" instead of failing.

llama-server's /health answers 503 while the model loads and 200 once it can
answer. The harness asks every few seconds and tells every connected browser
when the answer changes (the `model_status` event in web/src/contract.ts).
"""

import asyncio
import urllib.error
import urllib.request

READY, LOADING, UNREACHABLE = "ready", "loading", "unreachable"


def health_url(llama_url: str) -> str:
    """The OpenAI-style API address ("http://host:8080/v1") → its /health address."""
    base = llama_url.rstrip("/")
    if base.endswith("/v1"):
        base = base[: -len("/v1")]
    return base + "/health"


def classify_health(status_code: int | None) -> str:
    if status_code == 200:
        return READY
    if status_code == 503:
        return LOADING
    return UNREACHABLE


async def probe(url: str, timeout: float = 2.0) -> int | None:
    """The HTTP status code of a GET, or None when nothing answers."""

    def get() -> int | None:
        try:
            with urllib.request.urlopen(url, timeout=timeout) as response:
                return response.status
        except urllib.error.HTTPError as e:
            return e.code
        except (urllib.error.URLError, OSError):
            return None

    return await asyncio.to_thread(get)
