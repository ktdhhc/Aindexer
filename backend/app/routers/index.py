from __future__ import annotations

import json
import logging
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path

from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import StreamingResponse

from ..db import DEFAULT_FIELD_TEMPLATE_ID, DEFAULT_WORKSPACE_ID
from ._context import resolve_field_template_id, resolve_workspace_id
from ..repository import (
    get_document,
    get_fields,
    get_index,
    get_provider_config_raw,
    set_document_field_template,
    list_documents,
    markdown_path,
    reset_index_content,
    save_index,
    set_cancel_requested,
    set_document_stage,
    set_document_status,
    is_cancel_requested,
    update_index_editor_fields,
)
from ..schemas import IndexRecordIn
from ..services.extractor import fallback_extract, run_extraction
from ..services.file_parser import parse_file
from ..services.markdown_export import render_markdown, write_markdown
from ..services.provider_client import ProviderConfig

router = APIRouter()
logger = logging.getLogger(__name__)
EXECUTOR = ThreadPoolExecutor(max_workers=3, thread_name_prefix="indexer")
FUTURES: dict[str, Future] = {}
FUTURES_LOCK = threading.Lock()
TERMINAL_STATUS = {"indexed", "needs_review", "failed", "cancelled"}


def _progress_payload(doc: dict, elapsed_seconds: int = 0) -> dict:
    stage = doc.get("stage") or "uploaded"
    status = doc.get("status") or "uploaded"
    message = doc.get("stage_message") or ""
    error = doc.get("error_message")
    base_map = {
        "uploaded": 5,
        "queued": 15,
        "parsing": 35,
        "llm_request": 55,
        "writing": 85,
        "completed": 100,
        "failed": 100,
        "cancel_requested": 40,
        "cancelled": 100,
    }
    progress = base_map.get(stage, 10)
    if stage == "llm_request":
        progress = min(92, 55 + int(elapsed_seconds / 2))
    if stage == "cancel_requested":
        progress = min(98, 45 + int(elapsed_seconds / 2))
    if status == "indexed":
        progress = 100
    if status in {"needs_review", "failed"} and progress < 100:
        progress = 100
    if status == "cancelled" and stage == "cancelled":
        progress = 100
    if status == "cancelled" and stage == "cancel_requested":
        progress = min(98, progress)
    return {
        "doc_id": doc.get("id"),
        "status": status,
        "stage": stage,
        "stage_message": message,
        "error_message": error,
        "progress": progress,
    }


def _start_job(
    doc_id: str,
    provider: str,
    retries: int = 3,
    model: str | None = None,
    field_template_id: str = DEFAULT_FIELD_TEMPLATE_ID,
) -> bool:
    with FUTURES_LOCK:
        existing = FUTURES.get(doc_id)
        if existing and not existing.done():
            return False
        set_cancel_requested(doc_id, False)
        set_document_field_template(doc_id, field_template_id)
        set_document_status(doc_id, "parsing")
        set_document_stage(doc_id, "queued", "任务已加入队列，最多并发3条")
        future = EXECUTOR.submit(
            _process_indexing,
            doc_id,
            provider,
            retries,
            model,
            field_template_id,
        )
        FUTURES[doc_id] = future
        future.add_done_callback(lambda _f, did=doc_id: _clear_future(did))
        return True


def _clear_future(doc_id: str) -> None:
    with FUTURES_LOCK:
        FUTURES.pop(doc_id, None)


def _is_job_active(doc_id: str) -> bool:
    with FUTURES_LOCK:
        f = FUTURES.get(doc_id)
        return bool(f and not f.done())


def _check_cancel(doc_id: str) -> bool:
    if is_cancel_requested(doc_id):
        set_document_stage(doc_id, "cancelled", "用户已中断任务")
        set_document_status(doc_id, "cancelled", "Task cancelled by user")
        return True
    return False


def _process_indexing(
    doc_id: str,
    provider: str,
    retries: int = 3,
    model: str | None = None,
    field_template_id: str = DEFAULT_FIELD_TEMPLATE_ID,
) -> None:
    doc = None
    try:
        doc = get_document(doc_id)
        if not doc:
            return
        if _check_cancel(doc_id):
            return

        provider_row = get_provider_config_raw(provider)
        if not provider_row:
            set_document_stage(doc_id, "failed", "Provider配置不存在")
            set_document_status(doc_id, "failed", "Provider config missing")
            return

        set_document_status(doc_id, "parsing")
        set_document_stage(doc_id, "parsing", "正在解析文件内容")
        file_path = Path(doc["file_path"])

        text = parse_file(file_path=file_path, file_type=doc["file_type"])
        if _check_cancel(doc_id):
            return

        set_document_stage(doc_id, "llm_request", "解析完成，正在请求大模型")
        if not provider_row.get("api_key_enc"):
            raise RuntimeError("API key not configured for provider")
        cfg = ProviderConfig(
            provider=provider,
            base_url=provider_row["base_url"],
            model=model or provider_row["model"],
            api_key=provider_row["api_key_enc"],
            temperature=provider_row["temperature"] or 0.1,
            timeout=provider_row["timeout"] or 120,
        )
        custom_fields = [
            f for f in get_fields(template_id=field_template_id) if not f["is_default"]
        ]
        record = run_extraction(
            text=text,
            provider_cfg=cfg,
            custom_fields=custom_fields,
            retries=retries,
            should_cancel=lambda: is_cancel_requested(doc_id),
        )
        if _check_cancel(doc_id):
            return

        save_index(doc_id, record, provider=provider, model=cfg.model)
        set_document_stage(doc_id, "writing", "模型返回成功，正在写入索引")
        saved = get_index(doc_id)
        if saved:
            md = render_markdown(doc_id, saved)
            write_markdown(markdown_path(doc_id), md)
        set_document_stage(doc_id, "completed", "索引生成完成")
        set_document_status(doc_id, "indexed")
        return
    except Exception as exc:
        logger.exception("Indexing failed for doc_id=%s provider=%s", doc_id, provider)
        if _check_cancel(doc_id):
            return
        text = ""
        try:
            doc = get_document(doc_id)
            if not doc:
                return
            file_path = Path(doc["file_path"])
            text = parse_file(file_path=file_path, file_type=doc["file_type"])
        except Exception:
            pass
        fallback = fallback_extract(
            Path(doc["file_path"]) if doc else Path("unknown"), text
        )
        provider_row = get_provider_config_raw(provider) or {}
        save_index(
            doc_id,
            fallback,
            provider=provider,
            model=model or provider_row.get("model"),
        )
        fallback_saved = get_index(doc_id)
        if fallback_saved:
            md = render_markdown(doc_id, fallback_saved)
            write_markdown(markdown_path(doc_id), md)
        err = str(exc)
        if "timed out" in err.lower():
            err = f"{err}；可能是输入过长或模型响应慢。建议调高timeout到90-180秒，或改用更快模型。"
        set_document_stage(doc_id, "failed", "生成失败，已回退为人工补全模板")
        set_document_status(doc_id, "needs_review", err[:1200])
        return
    finally:
        pass


@router.post("/{doc_id}/run")
def run_indexing(
    doc_id: str,
    provider: str = "openai",
    retries: int = 3,
    model: str | None = None,
    workspace_id: str = Query(default=DEFAULT_WORKSPACE_ID),
    field_template_id: str = Query(default=DEFAULT_FIELD_TEMPLATE_ID),
) -> dict:
    workspace = resolve_workspace_id(workspace_id)
    template = resolve_field_template_id(field_template_id)
    doc = get_document(doc_id, workspace_id=workspace)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if not get_provider_config_raw(provider):
        raise HTTPException(status_code=400, detail="Provider config missing")

    if _is_job_active(doc_id):
        latest = get_document(doc_id, workspace_id=workspace) or doc
        if (
            latest.get("status") == "cancelled"
            or latest.get("stage") == "cancel_requested"
        ):
            return {
                "doc_id": doc_id,
                "status": "cleanup_pending",
                "message": "上次中断任务仍在清理，请稍后重试",
            }

    started = _start_job(doc_id, provider, retries, model, template)
    if not started:
        return {
            "doc_id": doc_id,
            "status": "parsing",
            "message": "Task is already running",
        }
    return {"doc_id": doc_id, "status": "parsing", "message": "Index task queued"}


@router.post("/run_all")
def run_indexing_all(
    provider: str = "openai",
    retries: int = 3,
    model: str | None = None,
    workspace_id: str = Query(default=DEFAULT_WORKSPACE_ID),
    field_template_id: str = Query(default=DEFAULT_FIELD_TEMPLATE_ID),
) -> dict:
    workspace = resolve_workspace_id(workspace_id)
    template = resolve_field_template_id(field_template_id)
    if not get_provider_config_raw(provider):
        raise HTTPException(status_code=400, detail="Provider config missing")

    rows = list_documents(workspace_id=workspace)
    queued = 0
    skipped = 0
    accepted_status = {"uploaded", "needs_review", "failed", "cancelled"}
    for row in rows:
        doc_id = row["id"]
        if _is_job_active(doc_id):
            skipped += 1
            continue
        if row.get("status") not in accepted_status:
            skipped += 1
            continue
        if _start_job(doc_id, provider, retries, model, template):
            queued += 1
        else:
            skipped += 1
    return {"queued": queued, "skipped": skipped, "max_concurrency": 3}


@router.get("/{doc_id}/run_stream")
def run_indexing_stream(
    doc_id: str,
    provider: str = "openai",
    retries: int = 3,
    model: str | None = None,
    workspace_id: str = Query(default=DEFAULT_WORKSPACE_ID),
    field_template_id: str = Query(default=DEFAULT_FIELD_TEMPLATE_ID),
) -> StreamingResponse:
    workspace = resolve_workspace_id(workspace_id)
    template = resolve_field_template_id(field_template_id)
    doc = get_document(doc_id, workspace_id=workspace)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if not get_provider_config_raw(provider):
        raise HTTPException(status_code=400, detail="Provider config missing")

    started = _start_job(doc_id, provider, retries, model, template)
    if not started:
        latest = get_document(doc_id, workspace_id=workspace) or doc
        if (
            latest.get("status") == "cancelled"
            or latest.get("stage") == "cancel_requested"
        ):
            raise HTTPException(
                status_code=409, detail="上次中断任务仍在清理，请稍后重试"
            )

    def event_gen():
        start = time.time()
        while True:
            row = get_document(doc_id, workspace_id=workspace)
            if not row:
                payload = {
                    "doc_id": doc_id,
                    "status": "failed",
                    "stage": "failed",
                    "stage_message": "文献不存在",
                    "progress": 100,
                }
                yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
                break

            elapsed = int(time.time() - start)
            payload = _progress_payload(row, elapsed_seconds=elapsed)
            yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

            if row.get("status") in TERMINAL_STATUS:
                done_payload = {**payload, "done": True}
                yield f"data: {json.dumps(done_payload, ensure_ascii=False)}\n\n"
                break
            time.sleep(1)

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(
        event_gen(), media_type="text/event-stream", headers=headers
    )


@router.post("/{doc_id}/cancel")
def cancel_indexing(
    doc_id: str,
    workspace_id: str = Query(default=DEFAULT_WORKSPACE_ID),
) -> dict:
    workspace = resolve_workspace_id(workspace_id)
    doc = get_document(doc_id, workspace_id=workspace)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    with FUTURES_LOCK:
        future = FUTURES.get(doc_id)
    if future and future.cancel():
        set_cancel_requested(doc_id, True)
        set_document_stage(doc_id, "cancelled", "任务在队列中已取消")
        set_document_status(doc_id, "cancelled", "Task cancelled in queue")
        return {"ok": True, "status": "cancelled"}

    set_cancel_requested(doc_id, True)
    set_document_stage(doc_id, "cancel_requested", "正在中断并清理后台任务")
    set_document_status(doc_id, "parsing", "Cancelling in progress")
    return {"ok": True, "status": "cancel_requested"}


@router.post("/{doc_id}/reset")
def reset_index(
    doc_id: str,
    workspace_id: str = Query(default=DEFAULT_WORKSPACE_ID),
) -> dict:
    workspace = resolve_workspace_id(workspace_id)
    doc = get_document(doc_id, workspace_id=workspace)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    with FUTURES_LOCK:
        future = FUTURES.get(doc_id)
    if future and not future.done():
        if future.cancel():
            pass
        set_cancel_requested(doc_id, True)

    ok = reset_index_content(doc_id, workspace_id=workspace)
    if not ok:
        raise HTTPException(status_code=404, detail="Document not found")

    path = markdown_path(doc_id)
    if path.exists():
        path.unlink()
    return {"ok": True, "status": "uploaded"}


@router.get("/{doc_id}")
def index_detail(
    doc_id: str,
    workspace_id: str = Query(default=DEFAULT_WORKSPACE_ID),
) -> dict:
    workspace = resolve_workspace_id(workspace_id)
    doc = get_document(doc_id, workspace_id=workspace)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    item = get_index(doc_id)
    if not item:
        raise HTTPException(status_code=404, detail="Index not found")
    return item.model_dump()


@router.get("/{doc_id}/markdown")
def index_markdown(
    doc_id: str,
    workspace_id: str = Query(default=DEFAULT_WORKSPACE_ID),
) -> dict:
    workspace = resolve_workspace_id(workspace_id)
    doc = get_document(doc_id, workspace_id=workspace)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    path = markdown_path(doc_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Markdown not found")
    return {"doc_id": doc_id, "markdown": path.read_text(encoding="utf-8")}


@router.put("/{doc_id}/markdown")
def update_index_markdown(
    doc_id: str,
    payload: dict = Body(...),
    workspace_id: str = Query(default=DEFAULT_WORKSPACE_ID),
) -> dict:
    workspace = resolve_workspace_id(workspace_id)
    doc = get_document(doc_id, workspace_id=workspace)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    markdown = str(payload.get("markdown", ""))
    write_markdown(markdown_path(doc_id), markdown)
    set_document_status(doc_id, "indexed")
    return {"ok": True}


@router.post("/{doc_id}/markdown")
def update_index_markdown_post(
    doc_id: str,
    payload: dict = Body(...),
    workspace_id: str = Query(default=DEFAULT_WORKSPACE_ID),
) -> dict:
    return update_index_markdown(doc_id, payload, workspace_id)


@router.put("/{doc_id}/editor")
def update_index_editor(
    doc_id: str,
    payload: dict = Body(...),
    workspace_id: str = Query(default=DEFAULT_WORKSPACE_ID),
) -> dict:
    workspace = resolve_workspace_id(workspace_id)
    doc = get_document(doc_id, workspace_id=workspace)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    markdown = str(payload.get("markdown", ""))
    title = str(payload.get("title", ""))
    display_name = str(payload.get("display_name", ""))
    generated_at = payload.get("generated_at")
    raw_year = payload.get("year")
    year_text = str(raw_year or "").strip()
    year = int(year_text) if year_text else None

    updated = update_index_editor_fields(
        doc_id,
        title=title,
        display_name=display_name,
        year=year,
        generated_at=str(generated_at or ""),
        workspace_id=workspace,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Index not found")

    write_markdown(markdown_path(doc_id), markdown)
    set_document_status(doc_id, "indexed")
    return {"ok": True}


@router.put("/{doc_id}")
def update_index(
    doc_id: str,
    payload: IndexRecordIn,
    workspace_id: str = Query(default=DEFAULT_WORKSPACE_ID),
) -> dict:
    workspace = resolve_workspace_id(workspace_id)
    doc = get_document(doc_id, workspace_id=workspace)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    save_index(doc_id, payload, provider="manual", model="manual")
    saved = get_index(doc_id)
    if saved:
        md = render_markdown(doc_id, saved)
        write_markdown(markdown_path(doc_id), md)
    set_document_status(doc_id, "indexed")
    return {"ok": True}
