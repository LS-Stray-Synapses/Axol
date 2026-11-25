import asyncio
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from modules.model_status import classify_health, health_url, probe


def test_ready_loading_unreachable():
    assert classify_health(200) == "ready"
    assert classify_health(503) == "loading"  # llama-server answers 503 while it loads
    assert classify_health(None) == "unreachable"  # nothing listening


def test_other_answers_count_as_unreachable():
    # A 404 or 500 means something is there, but it isn't a working model server.
    assert classify_health(404) == "unreachable"
    assert classify_health(500) == "unreachable"


def test_health_url_from_api_url():
    assert health_url("http://localhost:8080/v1") == "http://localhost:8080/health"
    assert health_url("http://axol-llama:8080/v1/") == "http://axol-llama:8080/health"
    assert health_url("http://gpu-box:9000") == "http://gpu-box:9000/health"


def test_probe_reads_the_status_code():
    class Loading(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(503)
            self.end_headers()

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Loading)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        url = f"http://127.0.0.1:{server.server_port}/health"
        assert asyncio.run(probe(url)) == 503
    finally:
        server.shutdown()


def test_probe_returns_none_when_nothing_listens():
    assert asyncio.run(probe("http://127.0.0.1:9/health", timeout=1)) is None
