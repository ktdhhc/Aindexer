from fastapi.testclient import TestClient

from app.main import create_app


def test_translation_health_endpoint() -> None:
    client = TestClient(create_app())
    res = client.get("/api/translation/health")

    assert res.status_code == 200
    assert res.json() == {"ok": True}


def test_translator_frontend_mount() -> None:
    client = TestClient(create_app())
    res = client.get("/translator/")

    assert res.status_code == 200
    assert "Translator" in res.text


def test_translation_missing_route_returns_404() -> None:
    client = TestClient(create_app())
    res = client.get("/api/translation/missing")

    assert res.status_code == 404
