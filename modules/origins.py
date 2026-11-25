"""Which web pages may open the harness WebSocket.

Browsers send an Origin header on every WebSocket ("http://localhost:5173"),
but, unlike normal web requests, they don't stop a page from one site
connecting to another. Without this check any website you have open could
connect to ws://localhost:8000/ws and drive the agent. The harness accepts its
own UI's origins and refuses the rest.
"""


def origin_allowed(origin: str | None, allowed: tuple[str, ...]) -> bool:
    if origin is None:
        return True  # not a browser; see tests/test_origins.py for why
    return origin in allowed
