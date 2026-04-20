from __future__ import annotations

import mimetypes
from importlib import import_module
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from ..db import DEFAULT_WORKSPACE_ID
from ..routers._context import resolve_workspace_id
from ..repository import (
    build_scoped_file_hash,
    get_provider_config_raw,
    hash_file,
    save_provider_config,
)
from ..schemas import ProviderConfigIn
from ..services.provider_client import ProviderClient, ProviderConfig
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

# Translator-supported providers (isolated from main app provider config)
TRANSLATOR_PROVIDERS = {"deepseek", "gemini"}


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
        raise HTTPException(status_code=404, detail="Translation document not found")
    return list_translation_history(document_id, workspace_id=workspace)


# Translator-isolated provider config endpoints
# These allow the translator subproject to work independently from main provider page


def _mask_api_key(api_key: str | None) -> str:
    if not api_key:
        return ""
    plain = api_key
    if len(plain) <= 8:
        return "*" * len(plain)
    return f"{plain[:4]}{'*' * (len(plain) - 8)}{plain[-4:]}"


def _validate_base_url(base_url: str | None) -> str:
    val = (base_url or "").strip()
    if not val:
        raise HTTPException(status_code=400, detail="Base URL 不能为空")
    parsed = urlparse(val)
    if parsed.scheme not in {"http", "https"}:
        raise HTTPException(
            status_code=400, detail="Base URL 必须以 http:// 或 https:// 开头"
        )
    if not parsed.netloc:
        raise HTTPException(status_code=400, detail="Base URL 缺少主机名")
    host = (parsed.hostname or "").strip()
    if not host:
        raise HTTPException(status_code=400, detail="Base URL 主机名无效")
    labels = host.split(".")
    for i, label in enumerate(labels):
        if not label:
            if i == 0:
                raise HTTPException(
                    status_code=400, detail="Base URL 主机名不能以点号开头"
                )
            elif i == len(labels) - 1:
                raise HTTPException(
                    status_code=400, detail="Base URL 主机名不能以点号结尾"
                )
            else:
                raise HTTPException(
                    status_code=400, detail="Base URL 主机名包含连续的点号"
                )
    try:
        host.encode("idna")
    except UnicodeError as e:
        raise HTTPException(status_code=400, detail=f"Base URL 主机名包含无效字符: {e}")
    return val


@router.get("/providers")
def list_translator_providers() -> list[dict]:
    """List translator-supported providers with their current config status."""
    result = []
    for provider in sorted(TRANSLATOR_PROVIDERS):
        raw = get_provider_config_raw(provider)
        if raw:
            result.append(
                {
                    "provider": provider,
                    "base_url": raw.get("base_url"),
                    "model": raw.get("model"),
                    "has_api_key": bool(raw.get("api_key_enc")),
                    "api_key_masked": _mask_api_key(raw.get("api_key_enc")),
                    "temperature": raw.get("temperature")
                    if raw.get("temperature") is not None
                    else 0.1,
                    "timeout": raw.get("timeout")
                    if raw.get("timeout") is not None
                    else 120,
                    "enabled": bool(raw.get("enabled")),
                }
            )
        else:
            # Return default structure for unconfigured providers
            defaults = {
                "deepseek": ("https://api.deepseek.com/v1", "deepseek-chat"),
                "gemini": (
                    "https://generativelanguage.googleapis.com/v1beta",
                    "gemini-1.5-flash",
                ),
            }
            default_url, default_model = defaults.get(provider, ("", ""))
            result.append(
                {
                    "provider": provider,
                    "base_url": default_url,
                    "model": default_model,
                    "has_api_key": False,
                    "api_key_masked": "",
                    "temperature": 0.1,
                    "timeout": 120,
                    "enabled": True,
                }
            )
    return result


@router.get("/providers/{provider}")
def get_translator_provider_config(provider: str) -> dict:
    """Get config for a specific translator provider."""
    if provider not in TRANSLATOR_PROVIDERS:
        raise HTTPException(
            status_code=400, detail=f"Provider '{provider}' not supported in translator"
        )
    raw = get_provider_config_raw(provider)
    if not raw:
        raise HTTPException(status_code=404, detail="Provider not configured")
    return {
        "provider": provider,
        "base_url": raw.get("base_url"),
        "model": raw.get("model"),
        "has_api_key": bool(raw.get("api_key_enc")),
        "api_key_masked": _mask_api_key(raw.get("api_key_enc")),
        "temperature": raw.get("temperature")
        if raw.get("temperature") is not None
        else 0.1,
        "timeout": raw.get("timeout") if raw.get("timeout") is not None else 120,
        "enabled": bool(raw.get("enabled")),
    }


@router.put("/providers/{provider}")
def update_translator_provider_config(provider: str, payload: ProviderConfigIn) -> dict:
    """Update config for a specific translator provider."""
    if provider not in TRANSLATOR_PROVIDERS:
        raise HTTPException(
            status_code=400, detail=f"Provider '{provider}' not supported in translator"
        )
    base_url = _validate_base_url(payload.base_url)
    api_key_enc = None
    if payload.clear_api_key:
        api_key_enc = ""
    elif payload.api_key:
        api_key_enc = payload.api_key
    save_provider_config(
        provider=provider,
        base_url=base_url,
        model=payload.model,
        api_key_enc=api_key_enc,
        temperature=payload.temperature,
        timeout=payload.timeout,
        enabled=payload.enabled,
    )
    return {"ok": True}


@router.post("/providers/{provider}/test")
def test_translator_provider(provider: str) -> dict:
    """Test connection for a specific translator provider."""
    if provider not in TRANSLATOR_PROVIDERS:
        raise HTTPException(
            status_code=400, detail=f"Provider '{provider}' not supported in translator"
        )
    cfg = get_provider_config_raw(provider)
    if not cfg:
        raise HTTPException(status_code=404, detail="Provider not configured")
    if not cfg.get("api_key_enc"):
        raise HTTPException(status_code=400, detail="API key is not configured")
    client_cfg = ProviderConfig(
        provider=provider,
        base_url=_validate_base_url(cfg["base_url"]),
        model=cfg["model"],
        api_key=cfg["api_key_enc"],
        temperature=cfg["temperature"] or 0.1,
        timeout=cfg["timeout"] or 120,
    )
    ok, message, elapsed = ProviderClient.test_connection(client_cfg)
    return {
        "success": ok,
        "message": message,
        "elapsed_seconds": elapsed,
    }
