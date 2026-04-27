from __future__ import annotations

import importlib
import sqlite3
from pathlib import Path

import app.config as app_config
import app.db as app_db
from app.db import get_conn, init_db

translation_repository = importlib.import_module("app.translation.repository")


def _patch_data_paths(tmp_path: Path, monkeypatch) -> None:
    data_dir = tmp_path / "data"
    log_dir = data_dir / "logs"
    upload_dir = data_dir / "uploads"
    index_dir = data_dir / "indexes"
    export_dir = data_dir / "exports"
    db_path = data_dir / "app.db"

    monkeypatch.setattr(app_config, "DATA_DIR", data_dir)
    monkeypatch.setattr(app_config, "LOG_DIR", log_dir)
    monkeypatch.setattr(app_config, "UPLOAD_DIR", upload_dir)
    monkeypatch.setattr(app_config, "INDEX_DIR", index_dir)
    monkeypatch.setattr(app_config, "EXPORT_DIR", export_dir)
    monkeypatch.setattr(app_config, "DB_PATH", db_path)
    monkeypatch.setattr(app_db, "DB_PATH", db_path)


def test_translation_schema_initializes_independently(
    tmp_path: Path, monkeypatch
) -> None:
    _patch_data_paths(tmp_path, monkeypatch)
    init_db()

    with sqlite3.connect(app_db.DB_PATH) as conn:
        tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type IN ('table', 'view')"
            ).fetchall()
        }

    assert "documents" in tables
    assert "index_records" in tables
    assert "translation_documents" in tables
    assert "translation_page_text" in tables
    assert "translation_requests" in tables
    assert "translation_results" in tables


def test_translation_repository_crud_stays_isolated(
    tmp_path: Path, monkeypatch
) -> None:
    _patch_data_paths(tmp_path, monkeypatch)
    init_db()

    document_id = translation_repository.create_translation_document(
        filename="paper.pdf",
        display_name="paper.pdf",
        file_type="pdf",
        file_hash="hash-1",
        file_path=str(tmp_path / "paper.pdf"),
        page_count=2,
        text_layer_status="ready",
    )
    translation_repository.upsert_translation_page_text(
        document_id=document_id,
        page_number=1,
        text_content="Example page text",
        text_map={"blocks": 1},
    )
    request_id = translation_repository.create_translation_request(
        document_id=document_id,
        provider="deepseek",
        model="deepseek-chat",
        target_lang="zh-CN",
        source_text="Long enough source text for translation.",
        cache_key="cache-key-1",
        anchor={"page": 1, "quote": "Long enough source text for translation."},
    )
    translation_repository.save_translation_result(
        request_id=request_id,
        translated_text="用于翻译的足够长的源文本。",
        result_meta={"cached": False},
    )

    document = translation_repository.get_translation_document(document_id)
    page_rows = translation_repository.list_translation_page_text(document_id)
    request = translation_repository.get_translation_request(request_id)
    result = translation_repository.get_translation_result(request_id)

    assert document is not None
    assert document["id"] == document_id
    assert document["text_layer_status"] == "ready"
    assert len(page_rows) == 1
    assert page_rows[0]["page_number"] == 1
    assert request is not None
    assert request["provider"] == "deepseek"
    assert request["status"] == "completed"
    assert result is not None
    assert result["translated_text"] == "用于翻译的足够长的源文本。"

    with get_conn() as conn:
        documents_count = conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
        index_records_count = conn.execute(
            "SELECT COUNT(*) FROM index_records"
        ).fetchone()[0]
        translation_documents_count = conn.execute(
            "SELECT COUNT(*) FROM translation_documents"
        ).fetchone()[0]

    assert documents_count == 0
    assert index_records_count == 0
    assert translation_documents_count == 1
