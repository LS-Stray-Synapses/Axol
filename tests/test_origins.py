from modules.origins import origin_allowed

ALLOWED = ("http://localhost:5173", "http://127.0.0.1:8000")


def test_own_ui_is_allowed():
    assert origin_allowed("http://localhost:5173", ALLOWED)
    assert origin_allowed("http://127.0.0.1:8000", ALLOWED)


def test_other_website_is_refused():
    assert not origin_allowed("https://evil.example", ALLOWED)


def test_same_host_other_port_is_refused():
    # Another local dev server (or anything else on this machine) is a different origin.
    assert not origin_allowed("http://localhost:3000", ALLOWED)


def test_null_origin_is_refused():
    # Sandboxed iframes and local files send the literal text "null".
    assert not origin_allowed("null", ALLOWED)


def test_missing_origin_is_allowed():
    # Browsers always send Origin on a WebSocket. No Origin means the client
    # isn't a browser (a script, a test), which this check isn't meant to stop:
    # a local program could fake the header anyway. Logins (project 2) handle that.
    assert origin_allowed(None, ALLOWED)
