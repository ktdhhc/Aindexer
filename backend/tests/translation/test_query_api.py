from __future__ import annotations

from fastapi.testclient import TestClient

import app.config as app_config
import app.db as app_db
import app.main as app_main
import app.translation.config as translation_config
from app.main import create_app
from app.translation.repository import (
    create_translation_document,
    create_translation_request,
    list_translation_page_text,
    save_translation_result,
    upsert_translation_page_text,
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


def test_query_api_returns_document_pages_and_history(tmp_path, monkeypatch) -> None:
    _patch_data_paths(tmp_path, monkeypatch)
    client = TestClient(create_app())

    document_id = create_translation_document(
        filename="paper.pdf",
        display_name="paper.pdf",
        file_type="pdf",
        file_hash="hash-query",
        file_path=str(tmp_path / "paper.pdf"),
        page_count=1,
        text_layer_status="ready",
    )
    upsert_translation_page_text(
        document_id=document_id,
        page_number=1,
        text_content="Example page text",
        text_map={"spans": 1},
    )
    request_id = create_translation_request(
        document_id=document_id,
        provider="deepseek",
        model="deepseek-chat",
        target_lang="zh-CN",
        source_text="This is a sufficiently long sample passage for translation history.",
        cache_key="cache-query",
    )
    save_translation_result(
        request_id=request_id,
        translated_text="翻译历史结果",
        result_meta={"prompt_version": "v1"},
    )

    detail = client.get(f"/api/translation/documents/{document_id}")
    pages = client.get(f"/api/translation/documents/{document_id}/pages")
    history = client.get(f"/api/translation/documents/{document_id}/history")

    assert detail.status_code == 200
    assert detail.json()["id"] == document_id
    assert pages.status_code == 200
    assert pages.json()[0]["page_number"] == 1
    assert pages.json()[0]["text_map_json"] is not None
    assert history.status_code == 200
    assert history.json()[0]["translated_text"] == "翻译历史结果"
    assert (
        list_translation_page_text(document_id)[0]["text_content"]
        == "Example page text"
    )


def test_query_api_returns_not_found_for_missing_document(
    tmp_path, monkeypatch
) -> None:
    _patch_data_paths(tmp_path, monkeypatch)
    client = TestClient(create_app())

    detail = client.get("/api/translation/documents/missing")
    pages = client.get("/api/translation/documents/missing/pages")
    history = client.get("/api/translation/documents/missing/history")

    assert detail.status_code == 404
    assert pages.status_code == 404
    assert history.status_code == 404
