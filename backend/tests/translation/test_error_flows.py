from __future__ import annotations

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
    list_translation_documents,
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


def test_provider_timeout_persists_failed_request(tmp_path, monkeypatch) -> None:
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
        file_hash="hash-error-timeout",
        file_path=str(tmp_path / "paper.pdf"),
        page_count=1,
        text_layer_status="ready",
    )

    response = client.post(
        "/api/translation/translate-selection",
        json={
            "document_id": document_id,
            "provider": "deepseek",
            "model": "deepseek-chat",
            "source_text": "This is a sufficiently long sample passage for timeout failure verification.",
            "target_lang": "zh-CN",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "provider_timeout"
    history = list_translation_history(document_id)
    assert len(history) == 1
    assert history[0]["status"] == "failed"
    assert history[0]["error_code"] == "provider_timeout"
    assert history[0]["translated_text"] is None


def test_unsupported_pdf_leaves_no_partial_document(tmp_path, monkeypatch) -> None:
    _patch_data_paths(tmp_path, monkeypatch)
    client = TestClient(create_app())

    response = client.post(
        "/api/translation/documents/upload",
        files={"file": ("scan.pdf", b"not a real pdf", "application/pdf")},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid PDF file"
    assert list_translation_documents() == []
