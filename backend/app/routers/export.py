from __future__ import annotations

import json
import platform
import shutil
import sys
import tempfile
import threading
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
from ..services.runtime_tasks import TASKS
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
ACTIVE_MAINTENANCE_KINDS = {"backup_export", "backup_restore", "logs_export"}


class TaskCancelledError(RuntimeError):
    pass


def _utc_timestamp() -> str:
    return datetime.now(UTC).strftime("%Y%m%d_%H%M%S")


def _write_tree(zf: zipfile.ZipFile, source_dir: Path, archive_root: str) -> None:
    if not source_dir.exists():
        return
    root = Path(archive_root)
    for p in source_dir.rglob("*"):
        if p.is_file():
            zf.write(p, arcname=str(root / p.relative_to(source_dir)))


def _update_task_progress(
    task_id: str | None,
    *,
    phase: str,
    percent: int | None,
    message: str,
    status: str = "running",
    cancellable: bool | None = None,
) -> None:
    if not task_id:
        return
    TASKS.update(
        task_id,
        status=status,
        phase=phase,
        percent=percent,
        message=message,
        cancellable=cancellable,
    )


def _ensure_task_not_cancelled(task_id: str | None) -> None:
    if task_id and TASKS.should_cancel(task_id):
        raise TaskCancelledError("task cancelled")


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
        "source_runtime": "v4-packaged" if getattr(sys, "frozen", False) else "v4-dev",
        "data_dir": str(DATA_DIR),
        "included_scopes": scopes,
    }


def _build_backup_archive(
    backup_path: Path,
    frontend_state: dict[str, Any] | None = None,
    include_logs: bool = False,
    task_id: str | None = None,
) -> None:
    ensure_translation_dirs()
    with zipfile.ZipFile(backup_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        _update_task_progress(
            task_id,
            phase="collect_state",
            percent=8,
            message="正在整理备份范围",
            status="preparing",
            cancellable=True,
        )
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
        _ensure_task_not_cancelled(task_id)
        if DB_PATH.exists():
            _update_task_progress(
                task_id,
                phase="pack_database",
                percent=18,
                message="正在写入数据库快照",
            )
            zf.write(DB_PATH, arcname="app.db")
        _ensure_task_not_cancelled(task_id)
        _update_task_progress(task_id, phase="pack_uploads", percent=38, message="正在打包上传文件")
        _write_tree(zf, UPLOAD_DIR, "uploads")
        _ensure_task_not_cancelled(task_id)
        _update_task_progress(task_id, phase="pack_indexes", percent=58, message="正在打包索引文件")
        _write_tree(zf, INDEX_DIR, "indexes")
        _ensure_task_not_cancelled(task_id)
        _update_task_progress(task_id, phase="pack_translation", percent=76, message="正在打包翻译文件")
        _write_tree(zf, TRANSLATION_UPLOAD_DIR, "translation/uploads")
        if frontend_state:
            _ensure_task_not_cancelled(task_id)
            _update_task_progress(task_id, phase="pack_frontend_state", percent=88, message="正在写入会话快照")
            zf.writestr(
                "frontend-state.json",
                json.dumps(frontend_state, ensure_ascii=False, indent=2),
            )
        if include_logs:
            _ensure_task_not_cancelled(task_id)
            _update_task_progress(task_id, phase="pack_logs", percent=94, message="正在打包日志文件")
            _write_tree(zf, LOG_DIR, "logs")
        _update_task_progress(task_id, phase="finalize_archive", percent=100, message="正在完成备份归档")


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


def _restore_status_payload(*, exclude_task_id: str | None = None) -> dict[str, Any]:
    from .index import active_index_runs
    from ..translation.cancellation import active_request_count

    index_status = active_index_runs()
    active_index_total = int(index_status.get("active_total") or 0)
    active_translation_total = active_request_count()
    active_maintenance = [
        task
        for task in TASKS.list()
        if task["kind"] in ACTIVE_MAINTENANCE_KINDS
        and task["task_id"] != exclude_task_id
    ]
    can_restore = active_index_total == 0 and active_translation_total == 0 and not active_maintenance
    return {
        "can_restore": can_restore,
        "active_index_runs": active_index_total,
        "active_translation_requests": active_translation_total,
        "active_index_detail": index_status,
        "active_maintenance_tasks": active_maintenance,
        "data_dir": str(DATA_DIR),
    }


def _assert_restore_allowed(*, exclude_task_id: str | None = None) -> None:
    status = _restore_status_payload(exclude_task_id=exclude_task_id)
    if not status["can_restore"]:
        raise HTTPException(
            status_code=409,
            detail="存在运行中的索引、翻译或维护任务，请完成或取消后再恢复数据",
        )


def _build_logs_archive(logs_path: Path, task_id: str | None = None) -> None:
    _update_task_progress(
        task_id,
        phase="collect_logs",
        percent=16,
        message="正在收集日志文件",
        status="preparing",
        cancellable=True,
    )
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
        _ensure_task_not_cancelled(task_id)
        _update_task_progress(task_id, phase="build_diagnostics", percent=55, message="正在写入诊断信息")
        zf.writestr("diagnostics.json", json.dumps(diagnostics, ensure_ascii=False, indent=2))
        _ensure_task_not_cancelled(task_id)
        _update_task_progress(task_id, phase="pack_logs", percent=82, message="正在打包日志归档")
        _write_tree(zf, LOG_DIR, "logs")
    _update_task_progress(task_id, phase="finalize_archive", percent=100, message="正在完成日志归档")


def _artifact_result(path: Path) -> dict[str, Any]:
    return {
        "artifact_name": path.name,
        "filename": path.name,
        "data_dir": str(DATA_DIR),
    }


def _completed_task_artifact_path(task_id: str, *, require_exists: bool = True) -> tuple[dict[str, Any], Path]:
    task = TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task["status"] != "completed":
        raise HTTPException(status_code=409, detail="任务尚未完成")
    result = task.get("result") or {}
    artifact_name = str(result.get("artifact_name") or "").strip()
    if not artifact_name:
        raise HTTPException(status_code=404, detail="任务没有可保存结果")
    artifact_path = (EXPORT_DIR / artifact_name).resolve()
    export_root = EXPORT_DIR.resolve()
    try:
        artifact_path.relative_to(export_root)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="任务结果路径无效") from exc
    if require_exists and (not artifact_path.exists() or not artifact_path.is_file()):
        raise HTTPException(status_code=404, detail="任务结果文件不存在")
    return task, artifact_path


def _run_backup_export_task(task_id: str, frontend_state: dict[str, Any] | None) -> None:
    try:
        ensure_dirs()
        backup_path = EXPORT_DIR / f"backup_all_{_utc_timestamp()}.zip"
        _build_backup_archive(backup_path, frontend_state=frontend_state, task_id=task_id)
        TASKS.complete(task_id, result=_artifact_result(backup_path), message="备份已生成")
    except TaskCancelledError:
        TASKS.mark_cancelled(task_id, "已取消备份")
    except Exception as exc:
        TASKS.fail(task_id, f"备份失败: {exc}")


def _run_logs_export_task(task_id: str) -> None:
    try:
        ensure_dirs()
        logs_path = EXPORT_DIR / f"diagnostics_{_utc_timestamp()}.zip"
        _build_logs_archive(logs_path, task_id=task_id)
        TASKS.complete(task_id, result=_artifact_result(logs_path), message="诊断包已生成")
    except TaskCancelledError:
        TASKS.mark_cancelled(task_id, "已取消日志导出")
    except Exception as exc:
        TASKS.fail(task_id, f"日志导出失败: {exc}")


def _restore_backup_from_bytes(archive_bytes: bytes, task_id: str | None = None) -> dict[str, Any]:
    ensure_dirs()
    ensure_translation_dirs()
    _assert_restore_allowed(exclude_task_id=task_id)
    with tempfile.TemporaryDirectory() as td:
        tmp_dir = Path(td)
        zip_path = tmp_dir / "import.zip"
        zip_path.write_bytes(archive_bytes)

        _update_task_progress(
            task_id,
            phase="validate_archive",
            percent=8,
            message="正在校验备份包",
            status="preparing",
            cancellable=True,
        )
        root = _safe_extract_backup(zip_path, tmp_dir)
        _ensure_task_not_cancelled(task_id)
        db_src = root / "app.db"
        uploads_src = root / "uploads"
        indexes_src = root / "indexes"
        translation_uploads_src = root / "translation" / "uploads"
        _update_task_progress(
            task_id,
            phase="read_frontend_state",
            percent=18,
            message="正在读取会话快照",
            cancellable=True,
        )
        frontend_state = _read_frontend_state(root)

        if not db_src.exists():
            raise HTTPException(status_code=400, detail="备份包缺少 app.db")

        _ensure_task_not_cancelled(task_id)
        _update_task_progress(
            task_id,
            phase="create_snapshot",
            percent=30,
            message="正在创建回退快照",
            cancellable=True,
        )
        snapshot = _create_pre_restore_snapshot()
        _ensure_task_not_cancelled(task_id)

        _update_task_progress(
            task_id,
            phase="clear_target_dirs",
            percent=42,
            message="正在清理当前数据目录",
            cancellable=False,
        )
        if UPLOAD_DIR.exists():
            shutil.rmtree(UPLOAD_DIR, ignore_errors=True)
        if INDEX_DIR.exists():
            shutil.rmtree(INDEX_DIR, ignore_errors=True)
        if TRANSLATION_UPLOAD_DIR.exists():
            shutil.rmtree(TRANSLATION_UPLOAD_DIR, ignore_errors=True)

        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        INDEX_DIR.mkdir(parents=True, exist_ok=True)
        TRANSLATION_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

        _update_task_progress(
            task_id,
            phase="restore_uploads",
            percent=58,
            message="正在恢复上传文件",
            cancellable=False,
        )
        if uploads_src.exists():
            shutil.copytree(uploads_src, UPLOAD_DIR, dirs_exist_ok=True)
        _update_task_progress(
            task_id,
            phase="restore_indexes",
            percent=74,
            message="正在恢复索引文件",
            cancellable=False,
        )
        if indexes_src.exists():
            shutil.copytree(indexes_src, INDEX_DIR, dirs_exist_ok=True)
        _update_task_progress(
            task_id,
            phase="restore_translation",
            percent=88,
            message="正在恢复翻译文件",
            cancellable=False,
        )
        if translation_uploads_src.exists():
            shutil.copytree(translation_uploads_src, TRANSLATION_UPLOAD_DIR, dirs_exist_ok=True)
        _update_task_progress(
            task_id,
            phase="replace_database",
            percent=96,
            message="正在替换数据库",
            cancellable=False,
        )
        shutil.copy2(db_src, DB_PATH)

    _update_task_progress(
        task_id,
        phase="finalize_restore",
        percent=100,
        message="正在准备刷新应用",
        cancellable=False,
    )
    return {
        "ok": True,
        "pre_restore_backup": snapshot.name,
        "frontend_state": frontend_state,
        "data_dir": str(DATA_DIR),
    }


def _read_restore_archive_bytes_from_path(source_path_text: str) -> bytes:
    raw = str(source_path_text or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="source_path 必须提供")
    source_path = Path(raw).expanduser().resolve()
    if not source_path.exists() or not source_path.is_file():
        raise HTTPException(status_code=404, detail="恢复文件不存在")
    if source_path.suffix.lower() != ".zip":
        raise HTTPException(status_code=400, detail="请提供 zip 备份文件")
    try:
        return source_path.read_bytes()
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"读取恢复文件失败: {exc}") from exc


def _run_restore_task(task_id: str, archive_bytes: bytes) -> None:
    try:
        result = _restore_backup_from_bytes(archive_bytes, task_id=task_id)
        TASKS.complete(task_id, result=result, message="恢复已完成")
    except TaskCancelledError:
        TASKS.mark_cancelled(task_id, "已取消恢复")
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, str) else "恢复失败"
        TASKS.fail(task_id, detail)
    except Exception as exc:
        TASKS.fail(task_id, f"恢复失败: {exc}")


@router.post("/batch")
def export_batch(doc_ids: list[str]) -> PlainTextResponse:
    blocks: list[str] = ["# Literature Index Export", ""]
    for idx, doc_id in enumerate(doc_ids, start=1):
        path = markdown_path(doc_id)
        if not path.exists():
            continue
        blocks.append(f"---\n\n## {idx}. {doc_id}\n")
        blocks.append(path.read_text(encoding="utf-8"))
        blocks.append("\n")
    content = "\n".join(blocks).strip() + "\n"
    headers = {"Content-Disposition": 'attachment; filename="indexes_merged.md"'}
    return PlainTextResponse(content=content, media_type="text/markdown", headers=headers)


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
    return FileResponse(path=str(backup_path), media_type="application/zip", filename=backup_path.name)


@router.post("/backup/all")
def export_backup_all_with_frontend_state(payload: dict = Body(default_factory=dict)) -> FileResponse:
    ensure_dirs()
    frontend_state = payload.get("frontend_state") if isinstance(payload, dict) else None
    if frontend_state is not None and not isinstance(frontend_state, dict):
        raise HTTPException(status_code=400, detail="frontend_state 必须是对象")
    ts = _utc_timestamp()
    backup_path = EXPORT_DIR / f"backup_all_{ts}.zip"
    _build_backup_archive(backup_path, frontend_state=frontend_state)
    return FileResponse(path=str(backup_path), media_type="application/zip", filename=backup_path.name)


@router.post("/backup/tasks")
def create_backup_task(payload: dict = Body(default_factory=dict)) -> dict[str, Any]:
    ensure_dirs()
    frontend_state = payload.get("frontend_state") if isinstance(payload, dict) else None
    if frontend_state is not None and not isinstance(frontend_state, dict):
        raise HTTPException(status_code=400, detail="frontend_state 必须是对象")
    task = TASKS.create("backup_export", message="正在创建备份", phase="collect_state", status="preparing")
    threading.Thread(target=_run_backup_export_task, args=(task["task_id"], frontend_state), daemon=True).start()
    return task


@router.post("/backup/restore")
async def restore_backup_all(archive: UploadFile = File(...)) -> dict[str, Any]:
    if not archive.filename or not archive.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="请上传 zip 备份文件")
    archive_bytes = await archive.read()
    return _restore_backup_from_bytes(archive_bytes)


@router.post("/backup/restore/tasks")
async def create_restore_task(archive: UploadFile = File(...)) -> dict[str, Any]:
    if not archive.filename or not archive.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="请上传 zip 备份文件")
    _assert_restore_allowed()
    archive_bytes = await archive.read()
    task = TASKS.create("backup_restore", message="正在校验备份包", phase="validate_archive", status="preparing")
    threading.Thread(target=_run_restore_task, args=(task["task_id"], archive_bytes), daemon=True).start()
    return task


@router.post("/backup/restore/tasks/from_path")
def create_restore_task_from_path(payload: dict = Body(default_factory=dict)) -> dict[str, Any]:
    source_path = payload.get("source_path") if isinstance(payload, dict) else None
    archive_bytes = _read_restore_archive_bytes_from_path(str(source_path or ""))
    _assert_restore_allowed()
    task = TASKS.create("backup_restore", message="正在校验备份包", phase="validate_archive", status="preparing")
    threading.Thread(target=_run_restore_task, args=(task["task_id"], archive_bytes), daemon=True).start()
    return task


@router.get("/backup/restore/status")
def restore_status() -> dict[str, Any]:
    return _restore_status_payload()


@router.get("/logs")
def export_logs() -> FileResponse:
    ensure_dirs()
    ts = _utc_timestamp()
    logs_path = EXPORT_DIR / f"diagnostics_{ts}.zip"
    _build_logs_archive(logs_path)
    return FileResponse(path=str(logs_path), media_type="application/zip", filename=logs_path.name)


@router.post("/logs/tasks")
def create_logs_export_task() -> dict[str, Any]:
    ensure_dirs()
    task = TASKS.create("logs_export", message="正在收集日志文件", phase="collect_logs", status="preparing")
    threading.Thread(target=_run_logs_export_task, args=(task["task_id"],), daemon=True).start()
    return task


@router.get("/tasks/{task_id}")
def get_export_task(task_id: str) -> dict[str, Any]:
    task = TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    return task


@router.post("/tasks/{task_id}/cancel")
def cancel_export_task(task_id: str) -> dict[str, Any]:
    task = TASKS.request_cancel(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    return task


@router.get("/tasks/{task_id}/download")
def download_export_task_artifact(task_id: str) -> FileResponse:
    _task, artifact_path = _completed_task_artifact_path(task_id)
    return FileResponse(path=str(artifact_path), media_type="application/zip", filename=artifact_path.name)


@router.post("/tasks/{task_id}/save")
def save_export_task_artifact(task_id: str, payload: dict = Body(default_factory=dict)) -> dict[str, Any]:
    _task, artifact_path = _completed_task_artifact_path(task_id)
    target_path_value = payload.get("target_path") if isinstance(payload, dict) else None
    target_path_text = str(target_path_value or "").strip()
    if not target_path_text:
        raise HTTPException(status_code=400, detail="target_path 必须提供")
    target_path = Path(target_path_text).expanduser().resolve()
    if target_path.exists() and target_path.is_dir():
        raise HTTPException(status_code=400, detail="保存路径不能是目录")
    if not target_path.parent.exists():
        raise HTTPException(status_code=400, detail="保存目录不存在")
    shutil.copy2(artifact_path, target_path)
    source_size = artifact_path.stat().st_size
    target_size = target_path.stat().st_size
    if source_size != target_size:
        raise HTTPException(status_code=500, detail="保存后的文件大小不一致")
    return {"ok": True, "saved_path": str(target_path), "bytes": target_size, "filename": target_path.name}


@router.post("/tasks/{task_id}/discard")
def discard_export_task_artifact(task_id: str) -> dict[str, Any]:
    task, artifact_path = _completed_task_artifact_path(task_id, require_exists=False)
    if task["kind"] not in {"backup_export", "logs_export"}:
        raise HTTPException(status_code=400, detail="当前任务不支持丢弃导出结果")
    if artifact_path.exists() and artifact_path.is_file():
        artifact_path.unlink()
    TASKS.update(task_id, result={}, message="已取消导出")
    return {"ok": True}


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
