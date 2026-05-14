from __future__ import annotations

import io
import json
import time
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


def _wait_for_task(client: TestClient, task_id: str, *, timeout: float = 3.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        response = client.get(f"/api/export/tasks/{task_id}")
        assert response.status_code == 200, response.text
        payload = response.json()
        if payload["status"] in {"completed", "failed", "cancelled"}:
            return payload
        time.sleep(0.05)
    raise AssertionError(f"task {task_id} did not finish in time")


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


def test_backup_task_exports_downloadable_artifact(tmp_path: Path, monkeypatch) -> None:
    client, paths = _make_client(tmp_path, monkeypatch)
    (paths["uploads"] / "ws_default").mkdir(parents=True, exist_ok=True)
    (paths["uploads"] / "ws_default" / "paper.txt").write_text("paper", encoding="utf-8")

    response = client.post("/api/export/backup/tasks", json={"frontend_state": {"schema_version": 1}})
    assert response.status_code == 200, response.text
    task = _wait_for_task(client, response.json()["task_id"])
    assert task["status"] == "completed"
    assert task["result"]["artifact_name"].endswith(".zip")

    download = client.get(f"/api/export/tasks/{task['task_id']}/download")
    assert download.status_code == 200, download.text
    assert "uploads/ws_default/paper.txt" in _zip_names(download.content)

    target_path = tmp_path / "selected-backup.zip"
    save_response = client.post(
        f"/api/export/tasks/{task['task_id']}/save",
        json={"target_path": str(target_path)},
    )
    assert save_response.status_code == 200, save_response.text
    assert save_response.json()["saved_path"] == str(target_path.resolve())
    assert "uploads/ws_default/paper.txt" in _zip_names(target_path.read_bytes())


def test_backup_task_artifact_can_be_discarded(tmp_path: Path, monkeypatch) -> None:
    client, paths = _make_client(tmp_path, monkeypatch)
    (paths["uploads"] / "ws_default").mkdir(parents=True, exist_ok=True)
    (paths["uploads"] / "ws_default" / "paper.txt").write_text("paper", encoding="utf-8")

    response = client.post("/api/export/backup/tasks", json={"frontend_state": {"schema_version": 1}})
    assert response.status_code == 200, response.text
    task = _wait_for_task(client, response.json()["task_id"])
    artifact_name = task["result"]["artifact_name"]
    artifact_path = paths["exports"] / artifact_name
    assert artifact_path.exists()

    discard = client.post(f"/api/export/tasks/{task['task_id']}/discard", json={})
    assert discard.status_code == 200, discard.text
    assert discard.json()["ok"] is True
    assert not artifact_path.exists()

    redownload = client.get(f"/api/export/tasks/{task['task_id']}/download")
    assert redownload.status_code == 404, redownload.text

    save_response = client.post(
        f"/api/export/tasks/{task['task_id']}/save",
        json={"target_path": str(tmp_path / "should-not-exist.zip")},
    )
    assert save_response.status_code == 404, save_response.text


def test_logs_task_exports_downloadable_artifact(tmp_path: Path, monkeypatch) -> None:
    client, paths = _make_client(tmp_path, monkeypatch)
    (paths["logs"] / "backend.log").write_text("backend ok", encoding="utf-8")

    response = client.post("/api/export/logs/tasks", json={})
    assert response.status_code == 200, response.text
    task = _wait_for_task(client, response.json()["task_id"])
    assert task["status"] == "completed"

    download = client.get(f"/api/export/tasks/{task['task_id']}/download")
    assert download.status_code == 200, download.text
    assert "diagnostics.json" in _zip_names(download.content)


def test_logs_task_artifact_can_be_discarded(tmp_path: Path, monkeypatch) -> None:
    client, paths = _make_client(tmp_path, monkeypatch)
    (paths["logs"] / "backend.log").write_text("backend ok", encoding="utf-8")

    response = client.post("/api/export/logs/tasks", json={})
    assert response.status_code == 200, response.text
    task = _wait_for_task(client, response.json()["task_id"])
    artifact_name = task["result"]["artifact_name"]
    artifact_path = paths["exports"] / artifact_name
    assert artifact_path.exists()

    discard = client.post(f"/api/export/tasks/{task['task_id']}/discard", json={})
    assert discard.status_code == 200, discard.text
    assert discard.json()["ok"] is True
    assert not artifact_path.exists()


def test_restore_task_restores_backup_archive(tmp_path: Path, monkeypatch) -> None:
    client, paths = _make_client(tmp_path, monkeypatch)
    archive = io.BytesIO()
    frontend_state = {
        "schema_version": 1,
        "local_storage": {"aindexer_v35_chat_sessions": "{}"},
    }
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("app.db", paths["db"].read_bytes())
        zf.writestr("uploads/ws_default/new.txt", "new")
        zf.writestr("indexes/new.md", "new")
        zf.writestr("frontend-state.json", json.dumps(frontend_state))

    response = client.post(
        "/api/export/backup/restore/tasks",
        files={"archive": ("restore.zip", archive.getvalue(), "application/zip")},
    )
    assert response.status_code == 200, response.text
    task = _wait_for_task(client, response.json()["task_id"])
    assert task["status"] == "completed"
    result = task["result"]
    assert result["frontend_state"] == frontend_state
    assert (paths["uploads"] / "ws_default" / "new.txt").read_text(encoding="utf-8") == "new"
    assert (paths["indexes"] / "new.md").read_text(encoding="utf-8") == "new"


def test_restore_task_from_path_restores_backup_archive(tmp_path: Path, monkeypatch) -> None:
    client, paths = _make_client(tmp_path, monkeypatch)
    archive_path = tmp_path / "restore-from-path.zip"
    frontend_state = {
        "schema_version": 1,
        "local_storage": {"aindexer_v35_chat_sessions": "{}"},
    }
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("app.db", paths["db"].read_bytes())
        zf.writestr("uploads/ws_default/from-path.txt", "new")
        zf.writestr("indexes/from-path.md", "new")
        zf.writestr("frontend-state.json", json.dumps(frontend_state))

    response = client.post(
        "/api/export/backup/restore/tasks/from_path",
        json={"source_path": str(archive_path)},
    )
    assert response.status_code == 200, response.text
    task = _wait_for_task(client, response.json()["task_id"])
    assert task["status"] == "completed"
    result = task["result"]
    assert result["frontend_state"] == frontend_state
    assert (paths["uploads"] / "ws_default" / "from-path.txt").read_text(encoding="utf-8") == "new"
    assert (paths["indexes"] / "from-path.md").read_text(encoding="utf-8") == "new"
