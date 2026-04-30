from __future__ import annotations

import mimetypes
from importlib import import_module
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from ..db import DEFAULT_WORKSPACE_ID
from ..routers._context import resolve_workspace_id
from ..repository import build_scoped_file_hash, hash_file
from .cancellation import cancel_request
from .repository import (
    create_translation_document,
    get_translation_document_in_workspace,
    get_translation_document_by_hash,
    list_translation_history,
    list_translation_documents,
    list_translation_page_text,
    upsert_translation_page_text,
)
from .schemas import TranslationRequestIn
from .service import build_translation_error, execute_translation_request

router = APIRouter()


@router.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@router.post("/documents/upload")
async def upload_translation_document(
    file: UploadFile = File(...),
    workspace_id: str = Query(default=DEFAULT_WORKSPACE_ID),
) -> dict[str, object]:
    translation_config = import_module("app.translation.config")
    text_map_module = import_module("app.translation.pdf.text_map")

    translation_config.ensure_translation_dirs()

    workspace = resolve_workspace_id(workspace_id)

    filename = (file.filename or "unknown.pdf").strip() or "unknown.pdf"
    suffix = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if suffix != "pdf":
        raise HTTPException(status_code=400, detail="Only PDF is supported")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(content) > translation_config.TRANSLATION_MAX_FILE_BYTES:
        raise HTTPException(status_code=400, detail="Uploaded file is too large")

    workspace_upload_dir = translation_config.TRANSLATION_UPLOAD_DIR / workspace
    workspace_upload_dir.mkdir(parents=True, exist_ok=True)
    save_path = workspace_upload_dir / filename
    save_path.write_bytes(content)
    file_hash = build_scoped_file_hash(hash_file(save_path), workspace)

    duplicate = get_translation_document_by_hash(file_hash, workspace_id=workspace)
    if duplicate:
        return {
            "document_id": duplicate["id"],
            "duplicate": True,
            "text_layer_status": duplicate["text_layer_status"],
        }

    try:
        page_maps = text_map_module.build_pdf_text_map(save_path)
        document_id = create_translation_document(
            filename=filename,
            display_name=filename,
            file_type="pdf",
            file_hash=file_hash,
            file_path=str(save_path),
            page_count=len(page_maps),
            text_layer_status="ready",
            workspace_id=workspace,
        )
        for page_map in page_maps:
            upsert_translation_page_text(
                document_id=document_id,
                page_number=page_map.page_number,
                text_content=page_map.text_content,
                text_map=text_map_module.page_text_map_to_dict(page_map),
            )
    except RuntimeError as exc:
        if save_path.exists():
            save_path.unlink()
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "document_id": document_id,
        "workspace_id": workspace,
        "duplicate": False,
        "text_layer_status": "ready",
    }


@router.get("/documents")
def list_documents(
    workspace_id: str = Query(default=DEFAULT_WORKSPACE_ID),
) -> list[dict[str, object]]:
    workspace = resolve_workspace_id(workspace_id)
    return list_translation_documents(workspace_id=workspace)


@router.get("/documents/{document_id}")
def document_detail(
    document_id: str,
    workspace_id: str = Query(default=DEFAULT_WORKSPACE_ID),
) -> dict[str, object]:
    workspace = resolve_workspace_id(workspace_id)
    document = get_translation_document_in_workspace(document_id, workspace)
    if not document:
        raise HTTPException(status_code=404, detail="Translation document not found")
    return document


@router.get("/documents/{document_id}/original")
def serve_original_translation_document(
    document_id: str,
    workspace_id: str = Query(default=DEFAULT_WORKSPACE_ID),
):
    workspace = resolve_workspace_id(workspace_id)
    document = get_translation_document_in_workspace(document_id, workspace)
    if not document:
        raise HTTPException(status_code=404, detail="Translation document not found")

    file_path = Path(str(document.get("file_path") or ""))
    if not file_path.exists():
        raise HTTPException(
            status_code=404, detail="Translation file not found on disk"
        )

    media_type, _ = mimetypes.guess_type(str(file_path))
    return FileResponse(
        path=str(file_path),
        media_type=media_type or "application/pdf",
        headers={"Content-Disposition": "inline"},
    )


@router.post("/translate-selection")
def translate_selection(payload: TranslationRequestIn):
    payload.workspace_id = resolve_workspace_id(payload.workspace_id)
    try:
        return execute_translation_request(payload).model_dump()
    except Exception as exc:
        error = build_translation_error(exc)
        raise HTTPException(status_code=400, detail=error.model_dump()) from exc


@router.post("/requests/{client_request_id}/cancel")
def cancel_translation(client_request_id: str) -> dict[str, object]:
    if not client_request_id.strip():
        raise HTTPException(status_code=400, detail="Request id is required")
    cancelled = cancel_request(client_request_id.strip())
    return {"ok": True, "cancelled": cancelled}


@router.get("/documents/{document_id}/pages")
def document_pages(
    document_id: str,
    workspace_id: str = Query(default=DEFAULT_WORKSPACE_ID),
) -> list[dict[str, object]]:
    workspace = resolve_workspace_id(workspace_id)
    document = get_translation_document_in_workspace(document_id, workspace)
    if not document:
        raise HTTPException(status_code=404, detail="Translation document not found")
    return list_translation_page_text(document_id)


@router.get("/documents/{document_id}/history")
def document_history(
    document_id: str,
    workspace_id: str = Query(default=DEFAULT_WORKSPACE_ID),
) -> list[dict[str, object]]:
    workspace = resolve_workspace_id(workspace_id)
    document = get_translation_document_in_workspace(document_id, workspace)
    if not document:
        from ..repository import get_document as get_main_document

        document = get_main_document(document_id, workspace_id=workspace)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    return list_translation_history(document_id, workspace_id=workspace)
