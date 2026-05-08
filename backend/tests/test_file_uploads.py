from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app import db, main, repository
from app.routers import files as files_router


def _make_client(tmp_path: Path, monkeypatch) -> tuple[TestClient, Path]:
    data_dir = tmp_path / "data"
    upload_dir = data_dir / "uploads"
    db_path = data_dir / "app.db"
    data_dir.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(db, "DB_PATH", db_path)
    monkeypatch.setattr(db, "ensure_dirs", lambda: data_dir.mkdir(parents=True, exist_ok=True))
    monkeypatch.setattr(files_router, "UPLOAD_DIR", upload_dir)
    monkeypatch.setattr(main, "_configure_logging", lambda: None)

    return TestClient(main.create_app()), upload_dir


def _upload(client: TestClient, filename: str, content: bytes) -> dict:
    response = client.post(
        "/api/files/upload",
        files={"file": (filename, content, "text/plain")},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _stored_files(upload_dir: Path) -> list[Path]:
    return sorted(path for path in upload_dir.rglob("*") if path.is_file())


def test_upload_same_filename_with_different_content_does_not_overwrite(
    tmp_path: Path,
    monkeypatch,
) -> None:
    client, upload_dir = _make_client(tmp_path, monkeypatch)

    first = _upload(client, "paper.txt", b"first content")
    second = _upload(client, "paper.txt", b"second content")

    assert first["duplicate"] is False
    assert second["duplicate"] is False
    assert first["doc_id"] != second["doc_id"]

    first_doc = repository.get_document(first["doc_id"])
    second_doc = repository.get_document(second["doc_id"])
    assert first_doc is not None
    assert second_doc is not None
    assert Path(first_doc["file_path"]).read_bytes() == b"first content"
    assert Path(second_doc["file_path"]).read_bytes() == b"second content"
    assert len(_stored_files(upload_dir)) == 2


def test_duplicate_upload_reuses_existing_document_and_cleans_temp_file(
    tmp_path: Path,
    monkeypatch,
) -> None:
    client, upload_dir = _make_client(tmp_path, monkeypatch)

    first = _upload(client, "paper.txt", b"same content")
    duplicate = _upload(client, "renamed.txt", b"same content")

    assert duplicate["duplicate"] is True
    assert duplicate["doc_id"] == first["doc_id"]
    files = _stored_files(upload_dir)
    assert len(files) == 1
    assert files[0].read_bytes() == b"same content"
    assert not any(path.name.startswith(".upload-") for path in files)


def test_duplicate_unique_constraint_race_cleans_new_file_and_returns_duplicate(
    tmp_path: Path,
    monkeypatch,
) -> None:
    client, upload_dir = _make_client(tmp_path, monkeypatch)
    first = _upload(client, "paper.txt", b"same content")

    original_get_document_by_hash = files_router.get_document_by_hash
    calls = 0

    def fake_get_document_by_hash(file_hash: str, workspace_id: str = "ws_default"):
        nonlocal calls
        calls += 1
        if calls == 1:
            return None
        return original_get_document_by_hash(file_hash, workspace_id=workspace_id)

    monkeypatch.setattr(files_router, "get_document_by_hash", fake_get_document_by_hash)

    duplicate = _upload(client, "race.txt", b"same content")

    assert duplicate["duplicate"] is True
    assert duplicate["doc_id"] == first["doc_id"]
    files = _stored_files(upload_dir)
    assert len(files) == 1
    assert files[0].read_bytes() == b"same content"


def test_upload_default_display_name_omits_file_extension(
    tmp_path: Path,
    monkeypatch,
) -> None:
    client, _upload_dir = _make_client(tmp_path, monkeypatch)

    result = _upload(client, "paper.v1.pdf", b"pdf bytes")

    doc = repository.get_document(result["doc_id"])
    rows = repository.list_documents()
    row = next(item for item in rows if item["id"] == result["doc_id"])
    assert doc is not None
    assert doc["display_name"] == "paper.v1"
    assert row["display_name"] == "paper.v1"


def test_init_db_normalizes_legacy_display_name_with_extension(
    tmp_path: Path,
    monkeypatch,
) -> None:
    client, _upload_dir = _make_client(tmp_path, monkeypatch)
    result = _upload(client, "legacy.txt", b"legacy")

    with db.get_conn() as conn:
        conn.execute(
            "UPDATE documents SET display_name = filename WHERE id = ?",
            (result["doc_id"],),
        )

    db.init_db()

    doc = repository.get_document(result["doc_id"])
    assert doc is not None
    assert doc["display_name"] == "legacy"
