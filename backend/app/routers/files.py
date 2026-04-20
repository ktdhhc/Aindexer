from __future__ import annotations

import mimetypes

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from pydantic import BaseModel

from ..config import UPLOAD_DIR
from ..db import DEFAULT_WORKSPACE_ID
from ..repository import (
    build_scoped_file_hash,
    create_document,
    workspace_exists,
    get_document,
    get_document_by_hash,
    delete_document,
    hash_file,
    list_documents,
    markdown_path,
    update_document_display_name,
)

router = APIRouter()

ALLOWED_EXT = {"pdf", "txt", "docx"}


class DisplayNameUpdateIn(BaseModel):
    display_name: str


def _resolve_workspace_id(workspace_id: str | None) -> str:
    value = str(workspace_id or DEFAULT_WORKSPACE_ID).strip() or DEFAULT_WORKSPACE_ID
    if not workspace_exists(value):
        raise HTTPException(status_code=404, detail="Workspace not found")
    return value


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    workspace_id: str = Query(default=DEFAULT_WORKSPACE_ID),
) -> dict:
    workspace = _resolve_workspace_id(workspace_id)
    filename = file.filename or "unknown"
    suffix = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if suffix not in ALLOWED_EXT:
        raise HTTPException(status_code=400, detail="Only pdf/txt/docx are supported")

    workspace_upload_dir = UPLOAD_DIR / workspace
    workspace_upload_dir.mkdir(parents=True, exist_ok=True)
    save_path = workspace_upload_dir / filename
    content = await file.read()
    save_path.write_bytes(content)
    file_hash = build_scoped_file_hash(hash_file(save_path), workspace)

    duplicate = get_document_by_hash(file_hash, workspace_id=workspace)
    if duplicate:
        return {
            "doc_id": duplicate["id"],
            "workspace_id": workspace,
            "duplicate": True,
            "status": duplicate["status"],
        }

    doc_id = create_document(
        filename,
        suffix,
        file_hash,
        str(save_path),
        workspace_id=workspace,
    )
    return {
        "doc_id": doc_id,
        "workspace_id": workspace,
        "duplicate": False,
        "status": "uploaded",
    }


@router.get("")
def list_files(workspace_id: str = Query(default=DEFAULT_WORKSPACE_ID)) -> list[dict]:
    workspace = _resolve_workspace_id(workspace_id)
    return list_documents(workspace_id=workspace)


@router.get("/{doc_id}")
def file_detail(
    doc_id: str,
    workspace_id: str = Query(default=DEFAULT_WORKSPACE_ID),
) -> dict:
    workspace = _resolve_workspace_id(workspace_id)
    doc = get_document(doc_id, workspace_id=workspace)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.put("/{doc_id}/display_name")
def update_file_display_name(
    doc_id: str,
    payload: DisplayNameUpdateIn,
    workspace_id: str = Query(default=DEFAULT_WORKSPACE_ID),
) -> dict:
    workspace = _resolve_workspace_id(workspace_id)
    updated = update_document_display_name(
        doc_id,
        payload.display_name,
        workspace_id=workspace,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Document not found")
    return updated


@router.delete("/{doc_id}")
def remove_file(
    doc_id: str,
    workspace_id: str = Query(default=DEFAULT_WORKSPACE_ID),
) -> dict:
    workspace = _resolve_workspace_id(workspace_id)
    doc = delete_document(doc_id, workspace_id=workspace)
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
def serve_original_file(
    doc_id: str,
    workspace_id: str = Query(default=DEFAULT_WORKSPACE_ID),
):
    """提供原文件在线预览（支持的类型将直接在新页打开）"""
    from fastapi.responses import FileResponse
    from pathlib import Path

    workspace = _resolve_workspace_id(workspace_id)
    doc = get_document(doc_id, workspace_id=workspace)
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
