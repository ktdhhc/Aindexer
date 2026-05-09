from __future__ import annotations

import json
import platform
import shutil
import tempfile
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse

from ..config import (
    DATA_DIR,
    DB_PATH,
    EXPORT_DIR,
    INDEX_DIR,
    LOG_DIR,
    UPLOAD_DIR,
    ensure_dirs,
)
from ..db import DEFAULT_WORKSPACE_ID
from ..repository import get_document
from ..repository import markdown_path, search_documents
from ..translation.config import TRANSLATION_UPLOAD_DIR, ensure_translation_dirs
from ._context import resolve_workspace_id

router = APIRouter()

ALLOWED_BACKUP_ROOTS = {
    "app.db",
    "uploads",
    "indexes",
    "translation",
    "manifest.json",
    "frontend-state.json",
    "logs",
}


def _utc_timestamp() -> str:
    return datetime.now(UTC).strftime("%Y%m%d_%H%M%S")


def _write_tree(zf: zipfile.ZipFile, source_dir: Path, archive_root: str) -> None:
    if not source_dir.exists():
        return
    root = Path(archive_root)
    for p in source_dir.rglob("*"):
        if p.is_file():
            zf.write(p, arcname=str(root / p.relative_to(source_dir)))


def _build_manifest(include_frontend_state: bool, include_logs: bool) -> dict[str, Any]:
    scopes = [
        "app.db",
        "uploads",
        "indexes",
        "translation/uploads",
    ]
    if include_frontend_state:
        scopes.append("frontend-state")
    if include_logs:
        scopes.append("logs")
    return {
        "schema_version": 1,
        "created_at": datetime.now(UTC).isoformat(),
        "source_runtime": "v4",
        "included_scopes": scopes,
    }


def _build_backup_archive(
    backup_path: Path,
    frontend_state: dict[str, Any] | None = None,
    include_logs: bool = False,
) -> None:
    ensure_translation_dirs()
    with zipfile.ZipFile(backup_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "manifest.json",
            json.dumps(
                _build_manifest(
                    include_frontend_state=bool(frontend_state),
                    include_logs=include_logs,
                ),
                ensure_ascii=False,
                indent=2,
            ),
        )
        if DB_PATH.exists():
            zf.write(DB_PATH, arcname="app.db")
        _write_tree(zf, UPLOAD_DIR, "uploads")
        _write_tree(zf, INDEX_DIR, "indexes")
        _write_tree(zf, TRANSLATION_UPLOAD_DIR, "translation/uploads")
        if frontend_state:
            zf.writestr(
                "frontend-state.json",
                json.dumps(frontend_state, ensure_ascii=False, indent=2),
            )
        if include_logs:
            _write_tree(zf, LOG_DIR, "logs")


def _create_pre_restore_snapshot() -> Path:
    ts = _utc_timestamp()
    snapshot_path = EXPORT_DIR / f"pre_restore_{ts}.zip"
    _build_backup_archive(snapshot_path)
    return snapshot_path


def _validate_backup_member(member_name: str) -> None:
    if not member_name:
        return
    member_path = Path(member_name)
    if member_path.is_absolute() or ".." in member_path.parts:
        raise HTTPException(status_code=400, detail="备份包包含非法路径")
    top = member_path.parts[0] if member_path.parts else ""
    if top not in ALLOWED_BACKUP_ROOTS:
        raise HTTPException(status_code=400, detail=f"备份包包含未知内容: {top}")
    if top == "translation" and len(member_path.parts) > 1 and member_path.parts[1] != "uploads":
        raise HTTPException(status_code=400, detail="备份包包含未知翻译目录")


def _safe_extract_backup(zip_path: Path, target_dir: Path) -> Path:
    root = target_dir / "unzipped"
    root.mkdir(parents=True, exist_ok=True)

    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            for member in zf.infolist():
                _validate_backup_member(member.filename)
            zf.extractall(root)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"备份包无效: {exc}")

    return root


def _read_frontend_state(root: Path) -> dict[str, Any] | None:
    path = root / "frontend-state.json"
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"前端会话快照无效: {exc}")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="前端会话快照格式无效")
    return payload


def _restore_status_payload() -> dict[str, Any]:
    from .index import active_index_runs
    from ..translation.cancellation import active_request_count

    index_status = active_index_runs()
    active_index_total = int(index_status.get("active_total") or 0)
    active_translation_total = active_request_count()
    can_restore = active_index_total == 0 and active_translation_total == 0
    return {
        "can_restore": can_restore,
        "active_index_runs": active_index_total,
        "active_translation_requests": active_translation_total,
        "active_index_detail": index_status,
    }


def _assert_restore_allowed() -> None:
    status = _restore_status_payload()
    if not status["can_restore"]:
        raise HTTPException(
            status_code=409,
            detail="存在运行中的索引或翻译任务，请完成或取消后再恢复数据",
        )


def _build_logs_archive(logs_path: Path) -> None:
    diagnostics = {
        "created_at": datetime.now(UTC).isoformat(),
        "platform": platform.platform(),
        "python": platform.python_version(),
        "data_dir": str(DATA_DIR),
        "log_files": (
            sorted(str(p.relative_to(LOG_DIR)) for p in LOG_DIR.rglob("*") if p.is_file())
            if LOG_DIR.exists()
            else []
        ),
        "restore_status": _restore_status_payload(),
    }
    with zipfile.ZipFile(logs_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("diagnostics.json", json.dumps(diagnostics, ensure_ascii=False, indent=2))
        _write_tree(zf, LOG_DIR, "logs")


@router.post("/batch")
def export_batch(doc_ids: list[str]) -> PlainTextResponse:
    blocks: list[str] = ["# 文献索引汇总", ""]
    for idx, doc_id in enumerate(doc_ids, start=1):
        path = markdown_path(doc_id)
        if not path.exists():
            continue
        blocks.append(f"---\n\n## {idx}. {doc_id}\n")
        blocks.append(path.read_text(encoding="utf-8"))
        blocks.append("\n")
    content = "\n".join(blocks).strip() + "\n"
    headers = {"Content-Disposition": 'attachment; filename="indexes_merged.md"'}
    return PlainTextResponse(
        content=content, media_type="text/markdown", headers=headers
    )


@router.get("/all")
def export_all() -> PlainTextResponse:
    rows = search_documents(None, None, None, None, None, None)
    return export_batch([r["doc_id"] for r in rows])


@router.get("/backup/all")
def export_backup_all(include_logs: bool = Query(default=False)) -> FileResponse:
    ensure_dirs()
    ts = _utc_timestamp()
    backup_path = EXPORT_DIR / f"backup_all_{ts}.zip"
    _build_backup_archive(backup_path, include_logs=include_logs)

    return FileResponse(
        path=str(backup_path),
        media_type="application/zip",
        filename=backup_path.name,
    )


@router.post("/backup/all")
def export_backup_all_with_frontend_state(payload: dict = Body(default_factory=dict)) -> FileResponse:
    ensure_dirs()
    frontend_state = payload.get("frontend_state") if isinstance(payload, dict) else None
    if frontend_state is not None and not isinstance(frontend_state, dict):
        raise HTTPException(status_code=400, detail="frontend_state 必须是对象")
    ts = _utc_timestamp()
    backup_path = EXPORT_DIR / f"backup_all_{ts}.zip"
    _build_backup_archive(backup_path, frontend_state=frontend_state)

    return FileResponse(
        path=str(backup_path),
        media_type="application/zip",
        filename=backup_path.name,
    )


@router.post("/backup/restore")
async def restore_backup_all(archive: UploadFile = File(...)) -> dict:
    ensure_dirs()
    ensure_translation_dirs()
    _assert_restore_allowed()
    if not archive.filename or not archive.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="请上传 zip 备份文件")

    with tempfile.TemporaryDirectory() as td:
        tmp_dir = Path(td)
        zip_path = tmp_dir / "import.zip"
        content = await archive.read()
        zip_path.write_bytes(content)

        root = _safe_extract_backup(zip_path, tmp_dir)
        db_src = root / "app.db"
        uploads_src = root / "uploads"
        indexes_src = root / "indexes"
        translation_uploads_src = root / "translation" / "uploads"
        frontend_state = _read_frontend_state(root)

        if not db_src.exists():
            raise HTTPException(status_code=400, detail="备份包缺少 app.db")

        snapshot = _create_pre_restore_snapshot()

        if UPLOAD_DIR.exists():
            shutil.rmtree(UPLOAD_DIR, ignore_errors=True)
        if INDEX_DIR.exists():
            shutil.rmtree(INDEX_DIR, ignore_errors=True)
        if TRANSLATION_UPLOAD_DIR.exists():
            shutil.rmtree(TRANSLATION_UPLOAD_DIR, ignore_errors=True)

        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        INDEX_DIR.mkdir(parents=True, exist_ok=True)
        TRANSLATION_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

        if uploads_src.exists():
            shutil.copytree(uploads_src, UPLOAD_DIR, dirs_exist_ok=True)
        if indexes_src.exists():
            shutil.copytree(indexes_src, INDEX_DIR, dirs_exist_ok=True)
        if translation_uploads_src.exists():
            shutil.copytree(translation_uploads_src, TRANSLATION_UPLOAD_DIR, dirs_exist_ok=True)

        shutil.copy2(db_src, DB_PATH)

    return {"ok": True, "pre_restore_backup": snapshot.name, "frontend_state": frontend_state}


@router.get("/backup/restore/status")
def restore_status() -> dict[str, Any]:
    return _restore_status_payload()


@router.get("/logs")
def export_logs() -> FileResponse:
    ensure_dirs()
    ts = _utc_timestamp()
    logs_path = EXPORT_DIR / f"diagnostics_{ts}.zip"
    _build_logs_archive(logs_path)
    return FileResponse(
        path=str(logs_path),
        media_type="application/zip",
        filename=logs_path.name,
    )


@router.get("/{doc_id}")
def export_one(
    doc_id: str,
    workspace_id: str = Query(default=DEFAULT_WORKSPACE_ID),
):
    workspace = resolve_workspace_id(workspace_id)
    doc = get_document(doc_id, workspace_id=workspace)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    path = markdown_path(doc_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Markdown file not found")
    return FileResponse(path=str(path), media_type="text/markdown", filename=path.name)
