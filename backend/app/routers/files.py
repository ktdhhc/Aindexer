from __future__ import annotations

import mimetypes

from fastapi import APIRouter, File, HTTPException, UploadFile

from ..config import UPLOAD_DIR
from ..repository import (
    create_document,
    get_document,
    get_document_by_hash,
    delete_document,
    hash_file,
    list_documents,
    markdown_path,
)

router = APIRouter()

ALLOWED_EXT = {"pdf", "txt", "docx"}


@router.post("/upload")
async def upload_file(file: UploadFile = File(...)) -> dict:
    filename = file.filename or "unknown"
    suffix = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if suffix not in ALLOWED_EXT:
        raise HTTPException(status_code=400, detail="Only pdf/txt/docx are supported")

    save_path = UPLOAD_DIR / filename
    content = await file.read()
    save_path.write_bytes(content)
    file_hash = hash_file(save_path)

    duplicate = get_document_by_hash(file_hash)
    if duplicate:
        return {
            "doc_id": duplicate["id"],
            "duplicate": True,
            "status": duplicate["status"],
        }

    doc_id = create_document(filename, suffix, file_hash, str(save_path))
    return {"doc_id": doc_id, "duplicate": False, "status": "uploaded"}


@router.get("")
def list_files() -> list[dict]:
    return list_documents()


@router.get("/{doc_id}")
def file_detail(doc_id: str) -> dict:
    doc = get_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.delete("/{doc_id}")
def remove_file(doc_id: str) -> dict:
    doc = delete_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    try:
        file_path = doc.get("file_path")
        if file_path:
            from pathlib import Path

            p = Path(file_path)
            if p.exists():
                p.unlink()
    except Exception:
        pass

    try:
        md = markdown_path(doc_id)
        if md.exists():
            md.unlink()
    except Exception:
        pass

    return {"ok": True}


@router.get("/{doc_id}/original")
def serve_original_file(doc_id: str):
    """提供原文件在线预览（支持的类型将直接在新页打开）"""
    from fastapi.responses import FileResponse
    from pathlib import Path

    doc = get_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    file_path = doc.get("file_path")
    if not file_path:
        raise HTTPException(status_code=404, detail="File path not found")

    p = Path(file_path)
    if not p.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")

    media_type, _ = mimetypes.guess_type(str(p))
    media_type = media_type or "application/octet-stream"

    return FileResponse(
        path=str(p),
        media_type=media_type,
        headers={"Content-Disposition": "inline"},
    )
