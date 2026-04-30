from __future__ import annotations

import fitz
from fastapi.testclient import TestClient

import app.config as app_config
import app.db as app_db
import app.main as app_main
import app.translation.config as translation_config
from app.main import create_app
from app.repository import build_scoped_file_hash, create_document, hash_file, save_index
from app.schemas import IndexRecordIn
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


def test_translation_documents_search_reuses_library_style_matching(
    tmp_path, monkeypatch
) -> None:
    _patch_data_paths(tmp_path, monkeypatch)
    client = TestClient(create_app())

    pdf_path = tmp_path / "attention-is-all-you-need.pdf"
    pdf_bytes = _build_text_pdf_bytes(
        "The transformer uses self-attention to model long-range dependencies."
    )
    pdf_path.write_bytes(pdf_bytes)
    file_hash = build_scoped_file_hash(hash_file(pdf_path), app_db.DEFAULT_WORKSPACE_ID)
    main_doc_id = create_document(
        filename="attention-is-all-you-need.pdf",
        file_type="pdf",
        file_hash=file_hash,
        file_path=str(pdf_path),
    )
    save_index(
        main_doc_id,
        IndexRecordIn(
            title="Attention Is All You Need",
            authors=["Ashish Vaswani", "Aidan Gomez"],
            year=2017,
            keywords=["transformer", "translation"],
            apa_citation="Vaswani, A. et al. (2017). Attention Is All You Need.",
            one_liner="Introduces the transformer architecture.",
            core_points=["Self-attention replaces recurrence."],
            claims=[],
            custom_fields={},
        ),
        provider="openai",
        model="gpt-4.1-mini",
    )

    upload_res = client.post(
        "/api/translation/documents/upload",
        files={
            "file": (
                "attention-is-all-you-need.pdf",
                pdf_bytes,
                "application/pdf",
            )
        },
    )
    assert upload_res.status_code == 200

    by_title = client.get("/api/translation/documents", params={"q": "attention"})
    by_author = client.get("/api/translation/documents", params={"q": "vaswani"})
    by_year = client.get("/api/translation/documents", params={"q": "2017"})
    by_filename = client.get(
        "/api/translation/documents", params={"q": "attention-is-all-you-need"}
    )

    assert by_title.status_code == 200
    assert by_author.status_code == 200
    assert by_year.status_code == 200
    assert by_filename.status_code == 200

    for response in (by_title, by_author, by_year, by_filename):
        data = response.json()
        assert len(data) == 1
        assert data[0]["title"] == "Attention Is All You Need"
        assert data[0]["authors"] == ["Ashish Vaswani", "Aidan Gomez"]
        assert data[0]["year"] == 2017
