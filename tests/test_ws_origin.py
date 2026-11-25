"""The real /ws endpoint refuses web pages from other sites.

The server is started against throwaway folders and an empty MCP config, so the
test needs no model, no network and none of your data.
"""

import importlib
import json

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("axol")
    mcp_config = tmp / "mcp.json"
    mcp_config.write_text(json.dumps({"mcpServers": {}}))

    with pytest.MonkeyPatch.context() as mp:
        mp.setenv("AXOL_DATA_DIR", str(tmp / "data"))
        mp.setenv("AXOL_WORKSPACE_DIR", str(tmp / "workspace"))
        mp.setenv("AXOL_MCP_CONFIG", str(mcp_config))
        mp.setenv("AXOL_OLLAMA_URL", "")
        mp.setenv("AXOL_ALLOWED_ORIGINS", "http://localhost:5173")
        mp.setenv("AXOL_LLAMA_URL", "http://127.0.0.1:9/v1")  # nothing there

        import mock_server
        mock_server = importlib.reload(mock_server)  # read the settings above

        with TestClient(mock_server.app) as c:
            yield c


def test_own_ui_can_connect(client):
    with client.websocket_connect("/ws", headers={"origin": "http://localhost:5173"}) as ws:
        assert ws.receive_json()["type"] == "model_list"


def test_connect_tells_the_model_status(client):
    with client.websocket_connect("/ws", headers={"origin": "http://localhost:5173"}) as ws:
        ws.receive_json()  # model_list
        status = ws.receive_json()

    assert status["type"] == "model_status"
    assert status["model"] == "bonsai-2:27b"
    assert status["state"] in ("loading", "ready", "unreachable")


def test_health_endpoint(client):
    # Liveness for the container: the harness process is up (not: the model is ready).
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_other_website_is_refused(client):
    with pytest.raises(WebSocketDisconnect) as refused:
        with client.websocket_connect("/ws", headers={"origin": "https://evil.example"}) as ws:
            ws.receive_json()

    assert refused.value.code == 1008  # "policy violation"
