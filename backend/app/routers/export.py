from __future__ import annotations

import shutil
import tempfile
import zipfile
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse

from ..config import (
    APP_LOG_PATH,
    DB_PATH,
    EXPORT_DIR,
    INDEX_DIR,
    UPLOAD_DIR,
    ensure_dirs,
)
from ..repository import markdown_path, search_documents

router = APIRouter()

ALLOWED_BACKUP_ROOTS = {"app.db", "uploads", "indexes", "logs"}


def _build_backup_archive(backup_path: Path) -> None:
    with zipfile.ZipFile(backup_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        if DB_PATH.exists():
            zf.write(DB_PATH, arcname="app.db")
        if UPLOAD_DIR.exists():
            for p in UPLOAD_DIR.rglob("*"):
                if p.is_file():
                    zf.write(
                        p, arcname=str(Path("uploads") / p.relative_to(UPLOAD_DIR))
                    )
        if INDEX_DIR.exists():
            for p in INDEX_DIR.rglob("*"):
                if p.is_file():
                    zf.write(p, arcname=str(Path("indexes") / p.relative_to(INDEX_DIR)))
        if APP_LOG_PATH.exists():
            zf.write(APP_LOG_PATH, arcname=str(Path("logs") / APP_LOG_PATH.name))


def _create_pre_restore_snapshot() -> Path:
    ts = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    snapshot_path = EXPORT_DIR / f"pre_restore_{ts}.zip"
    _build_backup_archive(snapshot_path)
    return snapshot_path


def _safe_extract_backup(zip_path: Path, target_dir: Path) -> Path:
    root = target_dir / "unzipped"
    root.mkdir(parents=True, exist_ok=True)

    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            for member in zf.infolist():
                raw_name = member.filename
                if not raw_name:
                    continue
                member_path = Path(raw_name)
                if member_path.is_absolute() or ".." in member_path.parts:
                    raise HTTPException(status_code=400, detail="备份包包含非法路径")
                top = member_path.parts[0] if member_path.parts else ""
                if top not in ALLOWED_BACKUP_ROOTS:
                    raise HTTPException(
                        status_code=400, detail=f"备份包包含未知内容: {top}"
                    )
            zf.extractall(root)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"备份包无效: {exc}")

    return root


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
def export_backup_all() -> FileResponse:
    ensure_dirs()
    ts = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    backup_path = EXPORT_DIR / f"backup_all_{ts}.zip"
    _build_backup_archive(backup_path)

    return FileResponse(
        path=str(backup_path),
        media_type="application/zip",
        filename=backup_path.name,
    )


@router.post("/backup/restore")
async def restore_backup_all(archive: UploadFile = File(...)) -> dict:
    ensure_dirs()
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

        if not db_src.exists():
            raise HTTPException(status_code=400, detail="备份包缺少 app.db")

        snapshot = _create_pre_restore_snapshot()

        if UPLOAD_DIR.exists():
            shutil.rmtree(UPLOAD_DIR, ignore_errors=True)
        if INDEX_DIR.exists():
            shutil.rmtree(INDEX_DIR, ignore_errors=True)

        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        INDEX_DIR.mkdir(parents=True, exist_ok=True)

        if uploads_src.exists():
            shutil.copytree(uploads_src, UPLOAD_DIR, dirs_exist_ok=True)
        if indexes_src.exists():
            shutil.copytree(indexes_src, INDEX_DIR, dirs_exist_ok=True)

        shutil.copy2(db_src, DB_PATH)

    return {"ok": True, "pre_restore_backup": snapshot.name}


@router.get("/{doc_id}")
def export_one(doc_id: str):
    path = markdown_path(doc_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Markdown file not found")
    return FileResponse(path=str(path), media_type="text/markdown", filename=path.name)
