from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from app import db, main
from app.routers import export as export_router
from app.routers import system as system_router


def _make_client(tmp_path: Path, monkeypatch) -> tuple[TestClient, dict[str, Path]]:
    data_dir = tmp_path / "data"
    paths = {
        "data": data_dir,
        "db": data_dir / "app.db",
        "uploads": data_dir / "uploads",
        "indexes": data_dir / "indexes",
        "exports": data_dir / "exports",
        "logs": data_dir / "logs",
        "translation_uploads": data_dir / "translation" / "uploads",
    }

    def ensure_dirs() -> None:
        for key in ("data", "uploads", "indexes", "exports", "logs"):
            paths[key].mkdir(parents=True, exist_ok=True)

    def ensure_translation_dirs() -> None:
        paths["translation_uploads"].mkdir(parents=True, exist_ok=True)

    ensure_dirs()
    ensure_translation_dirs()

    monkeypatch.setattr(db, "DB_PATH", paths["db"])
    monkeypatch.setattr(db, "ensure_dirs", ensure_dirs)
    monkeypatch.setattr(main, "_configure_logging", lambda: None)
    monkeypatch.setattr(export_router, "DATA_DIR", data_dir)
    monkeypatch.setattr(export_router, "DB_PATH", paths["db"])
    monkeypatch.setattr(export_router, "UPLOAD_DIR", paths["uploads"])
    monkeypatch.setattr(export_router, "INDEX_DIR", paths["indexes"])
    monkeypatch.setattr(export_router, "EXPORT_DIR", paths["exports"])
    monkeypatch.setattr(export_router, "LOG_DIR", paths["logs"])
    monkeypatch.setattr(export_router, "TRANSLATION_UPLOAD_DIR", paths["translation_uploads"])
    monkeypatch.setattr(export_router, "ensure_dirs", ensure_dirs)
    monkeypatch.setattr(export_router, "ensure_translation_dirs", ensure_translation_dirs)
    monkeypatch.setattr(system_router, "LOG_DIR", paths["logs"])
    monkeypatch.setattr(system_router, "ensure_dirs", ensure_dirs)

    return TestClient(main.create_app()), paths


def _zip_names(payload: bytes) -> set[str]:
    with zipfile.ZipFile(io.BytesIO(payload), "r") as zf:
        return set(zf.namelist())


def test_backup_export_includes_translation_uploads_and_frontend_state(tmp_path: Path, monkeypatch) -> None:
    client, paths = _make_client(tmp_path, monkeypatch)
    (paths["uploads"] / "ws_default").mkdir(parents=True, exist_ok=True)
    (paths["indexes"]).mkdir(parents=True, exist_ok=True)
    (paths["translation_uploads"] / "ws_default").mkdir(parents=True, exist_ok=True)
    (paths["uploads"] / "ws_default" / "paper.txt").write_text("paper", encoding="utf-8")
    (paths["indexes"] / "doc.md").write_text("# index", encoding="utf-8")
    (paths["translation_uploads"] / "ws_default" / "paper.pdf").write_bytes(b"pdf")

    frontend_state = {
        "schema_version": 1,
        "local_storage": {"aindexer_v35_chat_sessions": "{}"},
    }
    response = client.post("/api/export/backup/all", json={"frontend_state": frontend_state})

    assert response.status_code == 200, response.text
    names = _zip_names(response.content)
    assert "manifest.json" in names
    assert "app.db" in names
    assert "uploads/ws_default/paper.txt" in names
    assert "indexes/doc.md" in names
    assert "translation/uploads/ws_default/paper.pdf" in names
    assert "frontend-state.json" in names

    with zipfile.ZipFile(io.BytesIO(response.content), "r") as zf:
        assert json.loads(zf.read("frontend-state.json")) == frontend_state


def test_restore_backup_restores_translation_uploads_and_returns_frontend_state(tmp_path: Path, monkeypatch) -> None:
    client, paths = _make_client(tmp_path, monkeypatch)
    (paths["uploads"] / "old.txt").write_text("old", encoding="utf-8")
    (paths["indexes"] / "old.md").write_text("old", encoding="utf-8")
    (paths["translation_uploads"] / "old.pdf").write_bytes(b"old")

    frontend_state = {
        "schema_version": 1,
        "local_storage": {"aindexer_v35_workbench_chat": "{}"},
    }
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("app.db", paths["db"].read_bytes())
        zf.writestr("uploads/ws_default/new.txt", "new")
        zf.writestr("indexes/new.md", "new")
        zf.writestr("translation/uploads/ws_default/new.pdf", b"new")
        zf.writestr("frontend-state.json", json.dumps(frontend_state))

    response = client.post(
        "/api/export/backup/restore",
        files={"archive": ("restore.zip", archive.getvalue(), "application/zip")},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["ok"] is True
    assert payload["frontend_state"] == frontend_state
    assert (paths["uploads"] / "ws_default" / "new.txt").read_text(encoding="utf-8") == "new"
    assert (paths["indexes"] / "new.md").read_text(encoding="utf-8") == "new"
    assert (paths["translation_uploads"] / "ws_default" / "new.pdf").read_bytes() == b"new"
    assert not (paths["translation_uploads"] / "old.pdf").exists()
    assert (paths["exports"] / payload["pre_restore_backup"]).exists()


def test_logs_export_includes_frontend_log_and_diagnostics(tmp_path: Path, monkeypatch) -> None:
    client, paths = _make_client(tmp_path, monkeypatch)

    log_response = client.post(
        "/api/system/frontend_log",
        json={"level": "error", "source": "test", "message": "frontend failed"},
    )
    assert log_response.status_code == 200, log_response.text

    response = client.get("/api/export/logs")

    assert response.status_code == 200, response.text
    names = _zip_names(response.content)
    assert "diagnostics.json" in names
    assert "logs/frontend.log" in names
    with zipfile.ZipFile(io.BytesIO(response.content), "r") as zf:
        assert "frontend failed" in zf.read("logs/frontend.log").decode("utf-8")
