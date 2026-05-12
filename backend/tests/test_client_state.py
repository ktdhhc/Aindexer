import json

from fastapi.testclient import TestClient

from app.main import create_app
from app.routers import system
from app.services import client_state


def test_client_state_service_persists_selected_storage(monkeypatch) -> None:
    stored: dict[str, str] = {}

    monkeypatch.setattr(client_state, "get_app_setting", lambda key, default="": stored.get(key, default))
    monkeypatch.setattr(client_state, "set_app_setting", lambda key, value: stored.__setitem__(key, value))

    saved = client_state.set_client_state(
        {
            "local_storage": {
                "aindexer_v35_chat_sessions": '{"ws_default":[]}',
                "untracked_key": "ignored",
                "ignored_non_string": 1,
            },
            "session_storage": {
                "aindexer_v35_page_sessions": "{}",
            },
        }
    )

    assert saved["schema_version"] == 1
    assert saved["local_storage"] == {"aindexer_v35_chat_sessions": '{"ws_default":[]}'}
    assert saved["session_storage"] == {"aindexer_v35_page_sessions": "{}"}

    raw = stored[client_state.CLIENT_STATE_SETTING_KEY]
    assert json.loads(raw)["local_storage"] == saved["local_storage"]
    assert client_state.get_client_state()["session_storage"] == saved["session_storage"]


def test_client_state_api_roundtrip(monkeypatch) -> None:
    stored = {"schema_version": 1, "local_storage": {}, "session_storage": {}}

    def fake_write(payload):
        stored.update(payload)
        return stored

    monkeypatch.setattr(system, "read_client_state", lambda: stored)
    monkeypatch.setattr(system, "write_client_state", fake_write)

    client = TestClient(create_app())
    payload = {
        "schema_version": 1,
        "local_storage": {"aindexer_v35_model_defaults": '{"indexing":"openai::gpt-5.4"}'},
        "session_storage": {"aindexer_v35_translator_state": "{}"},
    }
    response = client.put("/api/system/client_state", json=payload)

    assert response.status_code == 200
    assert response.json()["local_storage"] == payload["local_storage"]
    assert client.get("/api/system/client_state").json()["session_storage"] == payload["session_storage"]
