from __future__ import annotations

import fitz
from fastapi.testclient import TestClient

import app.config as app_config
import app.db as app_db
import app.main as app_main
import app.translation.config as translation_config
from app.main import create_app
from app.translation.repository import (
    get_translation_document,
    list_translation_page_text,
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


def _build_text_pdf_bytes(text: str) -> bytes:
    doc = fitz.open()
    new_page = getattr(doc, "new_page")
    page = new_page()
    insert_text = getattr(page, "insert_text")
    insert_text((72, 72), text)
    return doc.tobytes()


def test_translation_pdf_upload_and_open(tmp_path, monkeypatch) -> None:
    _patch_data_paths(tmp_path, monkeypatch)
    client = TestClient(create_app())

    pdf_bytes = _build_text_pdf_bytes(
        "This is a sufficiently long sample passage for translation."
    )
    res = client.post(
        "/api/translation/documents/upload",
        files={"file": ("sample.pdf", pdf_bytes, "application/pdf")},
    )

    assert res.status_code == 200
    data = res.json()
    assert data["duplicate"] is False
    document_id = data["document_id"]

    detail_res = client.get(f"/api/translation/documents/{document_id}")
    original_res = client.get(f"/api/translation/documents/{document_id}/original")

    assert detail_res.status_code == 200
    assert detail_res.json()["text_layer_status"] == "ready"
    assert original_res.status_code == 200
    assert original_res.headers["content-disposition"] == "inline"

    document = get_translation_document(document_id)
    page_rows = list_translation_page_text(document_id)
    assert document is not None
    assert document["file_type"] == "pdf"
    assert len(page_rows) == 1
    assert "sufficiently long sample passage" in page_rows[0]["text_content"]
    assert page_rows[0]["text_map_json"] is not None
    detail_pages_res = client.get(f"/api/translation/documents/{document_id}/pages")
    assert detail_pages_res.status_code == 200
    assert detail_pages_res.json()[0]["text_map_json"] is not None


def test_translation_invalid_pdf_fails_cleanly(tmp_path, monkeypatch) -> None:
    _patch_data_paths(tmp_path, monkeypatch)
    client = TestClient(create_app())

    res = client.post(
        "/api/translation/documents/upload",
        files={"file": ("broken.pdf", b"not a real pdf", "application/pdf")},
    )

    assert res.status_code == 400
    assert res.json()["detail"] == "Invalid PDF file"

    list_res = client.get("/api/translation/documents")
    assert list_res.status_code == 200
    assert list_res.json() == []
