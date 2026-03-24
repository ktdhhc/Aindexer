from __future__ import annotations

from fastapi.testclient import TestClient

import app.config as app_config
import app.db as app_db
import app.main as app_main
import app.translation.config as translation_config
from app.main import create_app
from app.repository import get_provider_config_raw


def _patch_data_paths(tmp_path, monkeypatch) -> None:
    data_dir = tmp_path / "data"
    log_dir = data_dir / "logs"
    upload_dir = data_dir / "uploads"
    index_dir = data_dir / "indexes"
    export_dir = data_dir / "exports"
    db_path = data_dir / "app.db"
    translation_data_dir = data_dir / "translation"
    translation_upload_dir = translation_data_dir / "uploads"

    monkeypatch.setattr(app_config, "DATA_DIR", data_dir)
    monkeypatch.setattr(app_config, "LOG_DIR", log_dir)
    monkeypatch.setattr(app_config, "UPLOAD_DIR", upload_dir)
    monkeypatch.setattr(app_config, "INDEX_DIR", index_dir)
    monkeypatch.setattr(app_config, "EXPORT_DIR", export_dir)
    monkeypatch.setattr(app_config, "DB_PATH", db_path)
    monkeypatch.setattr(app_db, "DB_PATH", db_path)
    monkeypatch.setattr(app_main, "APP_LOG_PATH", log_dir / "app.log")
    monkeypatch.setattr(app_main, "LOG_DIR", log_dir)
    monkeypatch.setattr(
        translation_config, "TRANSLATION_DATA_DIR", translation_data_dir
    )
    monkeypatch.setattr(
        translation_config, "TRANSLATION_UPLOAD_DIR", translation_upload_dir
    )


def test_list_translator_providers_returns_deepseek_and_gemini(
    tmp_path, monkeypatch
) -> None:
    """Test that list endpoint returns only deepseek and gemini providers."""
    _patch_data_paths(tmp_path, monkeypatch)
    client = TestClient(create_app())

    res = client.get("/api/translation/providers")
    assert res.status_code == 200
    data = res.json()

    # Should return exactly 2 providers
    assert len(data) == 2

    provider_names = {p["provider"] for p in data}
    assert provider_names == {"deepseek", "gemini"}

    # Each should have default structure
    for provider in data:
        assert "base_url" in provider
        assert "model" in provider
        assert "has_api_key" in provider
        assert "api_key_masked" in provider
        assert "temperature" in provider
        assert "timeout" in provider
        assert "enabled" in provider


def test_get_provider_config_returns_defaults(tmp_path, monkeypatch) -> None:
    """Test getting config returns default values for default providers."""
    _patch_data_paths(tmp_path, monkeypatch)
    client = TestClient(create_app())

    res = client.get("/api/translation/providers/deepseek")
    assert res.status_code == 200
    data = res.json()
    assert data["provider"] == "deepseek"
    # Default providers have entries but no API key
    assert data["has_api_key"] is False
    assert "deepseek" in data["base_url"]


def test_get_provider_config_invalid_provider(tmp_path, monkeypatch) -> None:
    """Test getting config for invalid provider returns 400."""
    _patch_data_paths(tmp_path, monkeypatch)
    client = TestClient(create_app())

    res = client.get("/api/translation/providers/openai")
    assert res.status_code == 400
    assert "not supported" in res.json()["detail"]


def test_update_provider_config_success(tmp_path, monkeypatch) -> None:
    """Test updating provider config succeeds."""
    _patch_data_paths(tmp_path, monkeypatch)
    client = TestClient(create_app())

    res = client.put(
        "/api/translation/providers/deepseek",
        json={
            "base_url": "https://api.deepseek.com/v1",
            "model": "deepseek-chat",
            "api_key": "test-api-key-12345",
            "temperature": 0.5,
            "timeout": 60,
            "enabled": True,
        },
    )
    assert res.status_code == 200
    assert res.json()["ok"] is True

    # Verify config was saved by reading it back
    res2 = client.get("/api/translation/providers/deepseek")
    assert res2.status_code == 200
    data = res2.json()
    assert data["provider"] == "deepseek"
    assert data["base_url"] == "https://api.deepseek.com/v1"
    assert data["model"] == "deepseek-chat"
    assert data["has_api_key"] is True
    assert data["api_key_masked"] == "test**********2345"
    assert data["temperature"] == 0.5
    assert data["timeout"] == 60
    assert data["enabled"] is True


def test_update_provider_config_invalid_base_url(tmp_path, monkeypatch) -> None:
    """Test updating provider config with invalid base URL fails."""
    _patch_data_paths(tmp_path, monkeypatch)
    client = TestClient(create_app())

    res = client.put(
        "/api/translation/providers/gemini",
        json={
            "base_url": "not-a-valid-url",
            "model": "gemini-1.5-flash",
        },
    )
    assert res.status_code == 400
    assert "http://" in res.json()["detail"] or "https://" in res.json()["detail"]


def test_update_provider_config_clear_api_key(tmp_path, monkeypatch) -> None:
    """Test clearing API key via clear_api_key flag."""
    _patch_data_paths(tmp_path, monkeypatch)
    client = TestClient(create_app())

    # First set an API key
    client.put(
        "/api/translation/providers/deepseek",
        json={
            "base_url": "https://api.deepseek.com/v1",
            "model": "deepseek-chat",
            "api_key": "test-api-key-12345",
        },
    )

    # Verify key is set
    res = client.get("/api/translation/providers/deepseek")
    assert res.json()["has_api_key"] is True

    # Clear the key
    res = client.put(
        "/api/translation/providers/deepseek",
        json={
            "base_url": "https://api.deepseek.com/v1",
            "model": "deepseek-chat",
            "clear_api_key": True,
        },
    )
    assert res.status_code == 200

    # Verify key is cleared
    res = client.get("/api/translation/providers/deepseek")
    assert res.json()["has_api_key"] is False
    assert res.json()["api_key_masked"] == ""


def test_test_provider_not_configured(tmp_path, monkeypatch) -> None:
    """Test testing unconfigured provider returns 404."""
    _patch_data_paths(tmp_path, monkeypatch)
    client = TestClient(create_app())

    res = client.post("/api/translation/providers/gemini/test")
    assert res.status_code == 404
    assert "not configured" in res.json()["detail"]


def test_test_provider_no_api_key(tmp_path, monkeypatch) -> None:
    """Test testing provider without API key returns 400."""
    _patch_data_paths(tmp_path, monkeypatch)
    client = TestClient(create_app())

    # Configure provider without API key
    client.put(
        "/api/translation/providers/deepseek",
        json={
            "base_url": "https://api.deepseek.com/v1",
            "model": "deepseek-chat",
            "enabled": True,
        },
    )

    res = client.post("/api/translation/providers/deepseek/test")
    assert res.status_code == 400
    assert "API key is not configured" in res.json()["detail"]


def test_provider_list_reflects_saved_config(tmp_path, monkeypatch) -> None:
    """Test that list endpoint reflects saved configuration."""
    _patch_data_paths(tmp_path, monkeypatch)
    client = TestClient(create_app())

    # Initially no configs saved
    res = client.get("/api/translation/providers")
    initial_data = res.json()
    deepseek_initial = next(p for p in initial_data if p["provider"] == "deepseek")
    assert deepseek_initial["has_api_key"] is False

    # Save config
    client.put(
        "/api/translation/providers/deepseek",
        json={
            "base_url": "https://api.deepseek.com/v1",
            "model": "deepseek-chat",
            "api_key": "my-secret-key",
        },
    )

    # List should now reflect the saved config
    res = client.get("/api/translation/providers")
    updated_data = res.json()
    deepseek_updated = next(p for p in updated_data if p["provider"] == "deepseek")
    assert deepseek_updated["has_api_key"] is True
    assert deepseek_updated["api_key_masked"] == "my-s*****-key"


def test_update_gemini_provider_config(tmp_path, monkeypatch) -> None:
    """Test updating gemini provider config."""
    _patch_data_paths(tmp_path, monkeypatch)
    client = TestClient(create_app())

    res = client.put(
        "/api/translation/providers/gemini",
        json={
            "base_url": "https://generativelanguage.googleapis.com/v1beta",
            "model": "gemini-1.5-flash",
            "api_key": "gemini-api-key-abc123",
            "temperature": 0.7,
            "timeout": 90,
        },
    )
    assert res.status_code == 200

    res = client.get("/api/translation/providers/gemini")
    data = res.json()
    assert data["provider"] == "gemini"
    assert data["base_url"] == "https://generativelanguage.googleapis.com/v1beta"
    assert data["model"] == "gemini-1.5-flash"
    assert data["temperature"] == 0.7
    assert data["timeout"] == 90


def test_invalid_provider_in_update(tmp_path, monkeypatch) -> None:
    """Test updating invalid provider returns 400."""
    _patch_data_paths(tmp_path, monkeypatch)
    client = TestClient(create_app())

    res = client.put(
        "/api/translation/providers/openrouter",
        json={
            "base_url": "https://openrouter.ai/api/v1",
            "model": "openai/gpt-4o-mini",
        },
    )
    assert res.status_code == 400
    assert "not supported" in res.json()["detail"]


def test_invalid_provider_in_test(tmp_path, monkeypatch) -> None:
    """Test testing invalid provider returns 400."""
    _patch_data_paths(tmp_path, monkeypatch)
    client = TestClient(create_app())

    res = client.post("/api/translation/providers/openai/test")
    assert res.status_code == 400
    assert "not supported" in res.json()["detail"]
