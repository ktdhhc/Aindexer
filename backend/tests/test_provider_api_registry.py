from fastapi.testclient import TestClient

from app.main import create_app


def test_list_providers_includes_registry_metadata() -> None:
    client = TestClient(create_app())

    response = client.get("/api/providers")

    assert response.status_code == 200
    items = response.json()
    deepseek = next(item for item in items if item["provider"] == "deepseek")
    assert deepseek["registry"]["provider"]["found"] is True
    assert deepseek["registry"]["provider"]["recommended_base_url"] == "https://api.deepseek.com"
    assert deepseek["registry"]["provider"]["models"]
    assert deepseek["registry"]["model"]["found"] is True
    assert deepseek["registry"]["model"]["resolved"]["provider_id"] == "deepseek"
    assert deepseek["registry"]["model"]["resolved"]["supports_streaming"] is True


def test_get_provider_returns_enriched_registry_metadata() -> None:
    client = TestClient(create_app())

    response = client.get("/api/providers/deepseek")

    assert response.status_code == 200
    payload = response.json()
    assert payload["provider"] == "deepseek"
    assert payload["registry"]["provider"]["found"] is True
    assert payload["registry"]["model"]["resolved"]["supports_streaming"] is True
    assert payload["registry"]["model"]["resolved"]["context_window_tokens"] == 1000000


def test_resolve_model_registry_entries_uses_model_name_only() -> None:
    client = TestClient(create_app())

    response = client.post(
        "/api/providers/model_registry/resolve",
        json={"names": ["kimi-k2.5", "Kimi K2.6", "unknown-model"]},
    )

    assert response.status_code == 200
    items = response.json()
    assert items[0]["input_name"] == "kimi-k2.5"
    assert items[0]["found"] is True
    assert items[0]["resolved"]["provider_model_id"] == "kimi-k2.5"
    assert items[0]["resolved"]["supports_multimodal_input"] is True
    assert items[1]["input_name"] == "Kimi K2.6"
    assert items[1]["found"] is True
    assert items[1]["resolved"]["provider_model_id"] == "kimi-k2.6"
    assert items[2] == {"input_name": "unknown-model", "found": False, "resolved": None}


def test_update_provider_can_autofill_openai_compatible_base_url() -> None:
    client = TestClient(create_app())
    provider_name = "mistral"

    try:
        response = client.put(
            f"/api/providers/{provider_name}",
            json={
                "base_url": "",
                "model": "mistral-large-latest",
                "temperature": 0.1,
                "timeout": 120,
                "enabled": True,
            },
        )
        assert response.status_code == 200

        detail = client.get(f"/api/providers/{provider_name}")
        assert detail.status_code == 200
        payload = detail.json()
        assert payload["base_url"] == "https://api.mistral.ai/v1"
        assert payload["registry"]["provider"]["recommended_base_url"] == "https://api.mistral.ai/v1"
        assert payload["registry"]["model"]["resolved"]["provider_model_id"] == "mistral-large-2512"
    finally:
        client.delete(f"/api/providers/{provider_name}")
