from fastapi.testclient import TestClient

from app.main import create_app


def test_providers_endpoint() -> None:
    app = create_app()
    client = TestClient(app)
    res = client.get("/api/providers")
    assert res.status_code == 200
    data = res.json()
    assert any(p["provider"] == "openai" for p in data)


def test_translation_health_endpoint() -> None:
    app = create_app()
    client = TestClient(app)
    res = client.get("/api/translation/health")
    assert res.status_code == 200
    assert res.json() == {"ok": True}
