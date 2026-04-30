from __future__ import annotations

import threading
import time

from fastapi.testclient import TestClient

import app.config as app_config
import app.db as app_db
import app.main as app_main
import app.translation.config as translation_config
import app.translation.service as translation_service
from app.main import create_app
from app.repository import save_provider_config
from app.translation.repository import (
    create_translation_document,
    get_translation_request,
    list_translation_history,
)


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


def test_translate_selection_returns_success_and_cache_hit(
    tmp_path, monkeypatch
) -> None:
    _patch_data_paths(tmp_path, monkeypatch)

    def fake_run_provider_translation(resolved, request, should_cancel=None):
        from app.translation.providers.base import TranslationProviderResult

        return TranslationProviderResult(
            provider=resolved.provider,
            model=resolved.model,
            source_text=request.source_text,
            translated_text="翻译结果",
            target_lang=request.target_lang,
            source_lang=request.source_lang,
            prompt_version=request.prompt_version,
            usage={"prompt_tokens": 11, "completion_tokens": 22, "total_tokens": 33},
            first_token_ms=120.0,
            total_duration_ms=450.0,
        )

    monkeypatch.setattr(
        translation_service,
        "_run_provider_translation",
        fake_run_provider_translation,
    )

    client = TestClient(create_app())
    save_provider_config(
        provider="deepseek",
        base_url="https://api.deepseek.com/v1",
        model="deepseek-chat",
        api_key_enc="secret-key",
        temperature=0.1,
        timeout=120,
        enabled=True,
    )
    document_id = create_translation_document(
        filename="paper.pdf",
        display_name="paper.pdf",
        file_type="pdf",
        file_hash="hash-translate",
        file_path=str(tmp_path / "paper.pdf"),
        page_count=1,
        text_layer_status="ready",
    )

    payload = {
        "document_id": document_id,
        "provider": "deepseek",
        "model": "deepseek-chat",
        "source_text": "This is a sufficiently long sample passage for translation and cache verification.",
        "target_lang": "zh-CN",
        "prompt_version": "v1",
        "anchor": {
            "page": 1,
            "quote": "This is a sufficiently long sample passage for translation and cache verification.",
            "checksum": "chk-1",
        },
    }

    first = client.post("/api/translation/translate-selection", json=payload)
    second = client.post("/api/translation/translate-selection", json=payload)

    assert first.status_code == 200
    assert first.json()["cached"] is False
    assert first.json()["translated_text"] == "翻译结果"
    assert first.json()["input_tokens"] == 11
    assert first.json()["output_tokens"] == 22
    assert first.json()["total_tokens"] == 33
    assert first.json()["first_token_ms"] == 120.0
    assert first.json()["total_duration_ms"] == 450.0
    assert second.status_code == 200
    assert second.json()["cached"] is True
    assert second.json()["input_tokens"] == 11
    assert second.json()["output_tokens"] == 22
    history = list_translation_history(document_id)
    assert len(history) == 1
    request_row = get_translation_request(first.json()["request_id"])
    assert request_row is not None
    assert request_row["status"] == "completed"


def test_translate_selection_supports_custom_configured_provider(
    tmp_path, monkeypatch
) -> None:
    _patch_data_paths(tmp_path, monkeypatch)

    def fake_run_provider_translation(resolved, request, should_cancel=None):
        from app.translation.providers.base import TranslationProviderResult

        return TranslationProviderResult(
            provider=resolved.provider,
            model=resolved.model,
            source_text=request.source_text,
            translated_text="本地模型翻译结果",
            target_lang=request.target_lang,
            source_lang=request.source_lang,
            prompt_version=request.prompt_version,
        )

    monkeypatch.setattr(
        translation_service,
        "_run_provider_translation",
        fake_run_provider_translation,
    )

    client = TestClient(create_app())
    save_provider_config(
        provider="ollama",
        base_url="http://localhost:11434/v1",
        model="hy-mt1.5-1.8b:latest",
        api_key_enc="ollama",
        temperature=0.1,
        timeout=120,
        enabled=True,
    )
    document_id = create_translation_document(
        filename="paper.pdf",
        display_name="paper.pdf",
        file_type="pdf",
        file_hash="hash-translate-ollama",
        file_path=str(tmp_path / "paper.pdf"),
        page_count=1,
        text_layer_status="ready",
    )

    response = client.post(
        "/api/translation/translate-selection",
        json={
            "document_id": document_id,
            "provider": "ollama",
            "model": "hy-mt1.5-1.8b:latest",
            "source_text": "This is a sufficiently long sample passage for custom provider translation verification.",
            "target_lang": "zh-CN",
        },
    )

    assert response.status_code == 200
    assert response.json()["provider"] == "ollama"
    assert response.json()["model"] == "hy-mt1.5-1.8b:latest"
    assert response.json()["translated_text"] == "本地模型翻译结果"


def test_translate_selection_handles_short_text_and_provider_timeout(
    tmp_path, monkeypatch
) -> None:
    _patch_data_paths(tmp_path, monkeypatch)

    def fake_timeout(*args, **kwargs):
        from app.translation.providers.base import (
            TranslationProviderError,
            TranslationProviderErrorKind,
        )

        raise TranslationProviderError(
            kind=TranslationProviderErrorKind.TIMEOUT,
            message="Provider timed out.",
            retryable=True,
            provider="deepseek",
            model="deepseek-chat",
        )

    monkeypatch.setattr(translation_service, "_run_provider_translation", fake_timeout)

    client = TestClient(create_app())
    save_provider_config(
        provider="deepseek",
        base_url="https://api.deepseek.com/v1",
        model="deepseek-chat",
        api_key_enc="secret-key",
        temperature=0.1,
        timeout=120,
        enabled=True,
    )
    document_id = create_translation_document(
        filename="paper.pdf",
        display_name="paper.pdf",
        file_type="pdf",
        file_hash="hash-translate-2",
        file_path=str(tmp_path / "paper.pdf"),
        page_count=1,
        text_layer_status="ready",
    )

    timeout_res = client.post(
        "/api/translation/translate-selection",
        json={
            "document_id": document_id,
            "provider": "deepseek",
            "model": "deepseek-chat",
            "source_text": "This is a sufficiently long sample passage for translation timeout verification.",
            "target_lang": "zh-CN",
        },
    )

    assert timeout_res.status_code == 400
    assert timeout_res.json()["detail"]["code"] == "provider_timeout"


def test_translate_selection_can_be_cancelled_via_client_request_id(
    tmp_path, monkeypatch
) -> None:
    _patch_data_paths(tmp_path, monkeypatch)

    def fake_cancellable_run(resolved, request, should_cancel=None):
        from app.translation.providers.base import (
            TranslationProviderError,
            TranslationProviderErrorKind,
        )

        deadline = time.time() + 2.0
        while time.time() < deadline:
            if should_cancel and should_cancel():
                raise TranslationProviderError(
                    kind=TranslationProviderErrorKind.CANCELLED,
                    message="Cancelled by user.",
                    provider=resolved.provider,
                    model=resolved.model,
                )
            time.sleep(0.02)
        raise AssertionError("Expected request to be cancelled before completion")

    monkeypatch.setattr(
        translation_service,
        "_run_provider_translation",
        fake_cancellable_run,
    )

    client = TestClient(create_app())
    save_provider_config(
        provider="deepseek",
        base_url="https://api.deepseek.com/v1",
        model="deepseek-chat",
        api_key_enc="secret-key",
        temperature=0.1,
        timeout=120,
        enabled=True,
    )
    document_id = create_translation_document(
        filename="paper.pdf",
        display_name="paper.pdf",
        file_type="pdf",
        file_hash="hash-cancel",
        file_path=str(tmp_path / "paper.pdf"),
        page_count=1,
        text_layer_status="ready",
    )

    response_holder = {}

    def run_translate() -> None:
        response_holder["response"] = client.post(
            "/api/translation/translate-selection",
            json={
                "document_id": document_id,
                "provider": "deepseek",
                "model": "deepseek-chat",
                "source_text": "This is a sufficiently long sample passage for translation cancellation verification.",
                "target_lang": "zh-CN",
                "metadata": {"client_request_id": "cancel-me-1"},
            },
        )

    worker = threading.Thread(target=run_translate)
    worker.start()
    time.sleep(0.1)

    cancel_res = client.post("/api/translation/requests/cancel-me-1/cancel")
    worker.join(timeout=3)

    assert cancel_res.status_code == 200
    assert cancel_res.json()["cancelled"] is True
    assert response_holder["response"].status_code == 400
    assert response_holder["response"].json()["detail"]["code"] == "stale_request"
