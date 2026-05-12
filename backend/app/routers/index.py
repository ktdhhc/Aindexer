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
    begin_index_run,
    clear_markdown_failure,
    get_document,
    get_fields,
    get_index,
    get_index_max_concurrency,
    get_provider_config_raw,
    is_current_index_run,
    list_documents,
    mark_document_indexed,
    markdown_path,
    reset_index_content,
    save_index,
    set_cancel_requested,
    set_document_stage,
    set_document_stage_for_run,
    set_document_status,
    set_document_status_for_run,
    set_index_failure_for_run,
    set_index_max_concurrency,
    is_cancel_requested,
    update_index_progress_for_run,
    update_index_editor_fields,
)
from ..schemas import IndexRecordIn, IndexRecordOut
from ..services.extractor import (
    DEFAULT_INDEX_INPUT_BUDGET_TOKENS,
    assess_index_quality,
    fallback_extract,
    run_extraction,
)
from ..services.file_parser import parse_file
from ..services.markdown_export import render_markdown, write_markdown
from ..services.provider_client import ProviderConfig

router = APIRouter()
logger = logging.getLogger(__name__)
INDEX_OUTPUT_BUDGET_TOKENS = 1500
INDEX_INPUT_BUDGET_TOKENS = DEFAULT_INDEX_INPUT_BUDGET_TOKENS
EXECUTOR = ThreadPoolExecutor(max_workers=20, thread_name_prefix="indexer")
FUTURES: dict[str, Future] = {}
FUTURE_WORKSPACES: dict[str, str] = {}
FUTURES_LOCK = threading.Lock()
RUNNING_DOC_IDS: set[str] = set()
RUN_GATE: threading.Semaphore | None = None
RUN_GATE_LIMIT = 0
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
    stored_progress = doc.get("progress")
    if stored_progress is not None:
        try:
            progress = max(progress, min(100, max(0, int(stored_progress))))
        except (TypeError, ValueError):
            pass
    return {
        "doc_id": doc.get("id"),
        "status": status,
        "stage": stage,
        "stage_message": message,
        "error_message": error,
        "progress": progress,
        "output_seen_tokens": doc.get("output_seen_tokens") or 0,
        "output_budget_tokens": doc.get("output_budget_tokens") or 0,
        "failure_code": doc.get("failure_code"),
        "failure_label": doc.get("failure_label"),
    }


def _ensure_run_gate_locked() -> None:
    global RUN_GATE, RUN_GATE_LIMIT
    active = any(f and not f.done() for f in FUTURES.values())
    if RUN_GATE is None or not active:
        RUN_GATE_LIMIT = get_index_max_concurrency()
        RUN_GATE = threading.Semaphore(RUN_GATE_LIMIT)


def _estimate_tokens(text: str) -> int:
    raw = str(text or "")
    if not raw:
        return 0
    ascii_chars = sum(1 for char in raw if ord(char) < 128)
    non_ascii_chars = len(raw) - ascii_chars
    return max(1, int(ascii_chars / 4 + non_ascii_chars / 1.8))


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
        _ensure_run_gate_locked()
        doc = get_document(doc_id)
        workspace = str(doc.get("workspace_id") or DEFAULT_WORKSPACE_ID) if doc else DEFAULT_WORKSPACE_ID
        effective_model = str(model or "").strip() or None
        run_id = begin_index_run(
            doc_id,
            field_template_id,
            provider=provider,
            model=effective_model,
            output_budget_tokens=INDEX_OUTPUT_BUDGET_TOKENS,
            stage_message=f"任务已加入队列，最多并发{RUN_GATE_LIMIT}条",
        )
        future = EXECUTOR.submit(
            _process_indexing,
            doc_id,
            run_id,
            provider,
            retries,
            model,
            field_template_id,
        )
        FUTURES[doc_id] = future
        FUTURE_WORKSPACES[doc_id] = workspace
        future.add_done_callback(lambda _f, did=doc_id: _clear_future(did))
        return True


def _clear_future(doc_id: str) -> None:
    with FUTURES_LOCK:
        FUTURES.pop(doc_id, None)
        FUTURE_WORKSPACES.pop(doc_id, None)
        RUNNING_DOC_IDS.discard(doc_id)


def _is_job_active(doc_id: str) -> bool:
    with FUTURES_LOCK:
        f = FUTURES.get(doc_id)
        return bool(f and not f.done())


def _check_cancel(doc_id: str, run_id: str) -> bool:
    if not is_current_index_run(doc_id, run_id):
        return True
    if is_cancel_requested(doc_id):
        set_index_failure_for_run(doc_id, run_id, "cancelled", "已取消")
        set_document_stage_for_run(doc_id, run_id, "cancelled", "用户已中断任务")
        set_document_status_for_run(doc_id, run_id, "cancelled", "Task cancelled by user")
        return True
    return False


def _classify_failure(exc: Exception) -> tuple[str, str]:
    text = str(exc or "").lower()
    if "api key" in text:
        return "api_key_missing", "API Key 缺失"
    if "provider config" in text or "provider配置" in text:
        return "provider_missing", "Provider 配置缺失"
    if "timed out" in text or "timeout" in text:
        return "llm_timeout", "模型超时"
    if "json" in text or "解析失败" in text:
        return "llm_json_error", "模型格式错误"
    if "empty" in text or "无可用文本" in text or "解析内容不足" in text:
        return "parse_empty", "解析内容不足"
    if "markdown" in text:
        return "markdown_write_failed", "Markdown 写入失败"
    return "unknown", "索引失败"


def _is_fallback_record(record: IndexRecordIn) -> bool:
    marker = "自动抽取失败"
    values = [
        record.title,
        record.one_liner,
        *record.core_points,
        *[claim.claim_text for claim in record.claims],
    ]
    return any(marker in str(value or "") for value in values)


def _index_quality_failure(record: IndexRecordIn) -> tuple[str, str, str] | None:
    return assess_index_quality(record)


def _set_stage_progress(doc_id: str, run_id: str, stage: str, message: str, progress: int) -> bool:
    if not set_document_stage_for_run(doc_id, run_id, stage, message):
        return False
    return update_index_progress_for_run(doc_id, run_id, progress=progress)


def _llm_progress_callback(doc_id: str, run_id: str):
    def on_progress(_delta: str, accumulated: str, output_budget_tokens: int) -> None:
        budget = max(1, int(output_budget_tokens or INDEX_OUTPUT_BUDGET_TOKENS))
        seen = _estimate_tokens(accumulated)
        progress = 35 + min(50, int((seen / budget) * 50))
        update_index_progress_for_run(
            doc_id,
            run_id,
            progress=progress,
            output_seen_tokens=seen,
            output_budget_tokens=budget,
        )

    return on_progress


def _write_markdown_for_run(doc_id: str, run_id: str, saved) -> Exception | None:
    if not saved or not is_current_index_run(doc_id, run_id):
        return None
    md = render_markdown(doc_id, saved)
    md_path = markdown_path(doc_id)
    try:
        write_markdown(md_path, md)
    except Exception as exc:
        logger.exception("Markdown write failed for doc_id=%s", doc_id)
        return exc
    if not is_current_index_run(doc_id, run_id) and md_path.exists():
        try:
            md_path.unlink()
        except OSError:
            logger.warning("Failed to remove stale markdown for doc_id=%s", doc_id)
    return None


def _mark_markdown_write_failed(doc_id: str, run_id: str, exc: Exception) -> None:
    message = f"结构化索引已保存，但 Markdown 落盘失败: {exc}"
    set_index_failure_for_run(doc_id, run_id, "markdown_write_failed", "Markdown 写入失败")
    set_document_stage_for_run(doc_id, run_id, "failed", "结构化索引已保存，但 Markdown 落盘失败")
    set_document_status_for_run(doc_id, run_id, "needs_review", message[:1200])


def _write_markdown_or_raise(doc_id: str, markdown: str) -> None:
    try:
        write_markdown(markdown_path(doc_id), markdown)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Markdown 写入失败: {exc}") from exc


def _manual_record_for_markdown(doc_id: str, payload: IndexRecordIn) -> IndexRecordOut:
    return IndexRecordOut(
        doc_id=doc_id,
        provider="manual",
        model="manual",
        updated_at=None,
        **payload.model_dump(),
    )


def _process_indexing(
    doc_id: str,
    run_id: str,
    provider: str,
    retries: int = 3,
    model: str | None = None,
    field_template_id: str = DEFAULT_FIELD_TEMPLATE_ID,
) -> None:
    doc = None
    text = ""
    gate = RUN_GATE
    acquired = False
    try:
        if gate:
            gate.acquire()
            acquired = True
        with FUTURES_LOCK:
            RUNNING_DOC_IDS.add(doc_id)
        doc = get_document(doc_id)
        if not doc:
            return
        if _check_cancel(doc_id, run_id):
            return

        provider_row = get_provider_config_raw(provider)
        if not provider_row:
            set_index_failure_for_run(doc_id, run_id, "provider_missing", "Provider 配置缺失")
            set_document_stage_for_run(doc_id, run_id, "failed", "Provider配置不存在")
            set_document_status_for_run(doc_id, run_id, "failed", "Provider config missing")
            return

        set_document_status_for_run(doc_id, run_id, "parsing")
        _set_stage_progress(doc_id, run_id, "parsing", "正在解析文件内容", 20)
        file_path = Path(doc["file_path"])

        text = parse_file(file_path=file_path, file_type=doc["file_type"])
        if _check_cancel(doc_id, run_id):
            return

        _set_stage_progress(doc_id, run_id, "llm_request", "解析完成，正在请求大模型", 35)
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
            should_cancel=lambda: (not is_current_index_run(doc_id, run_id)) or is_cancel_requested(doc_id),
            on_progress=_llm_progress_callback(doc_id, run_id),
            output_budget_tokens=INDEX_OUTPUT_BUDGET_TOKENS,
            input_budget_tokens=INDEX_INPUT_BUDGET_TOKENS,
            workspace_id=str(doc.get("workspace_id") or DEFAULT_WORKSPACE_ID),
            request_id=doc_id,
        )
        if _check_cancel(doc_id, run_id):
            return

        _set_stage_progress(doc_id, run_id, "writing", "模型返回成功，正在写入索引", 90)
        if not save_index(doc_id, record, provider=provider, model=cfg.model, index_run_id=run_id):
            return
        saved = get_index(doc_id)
        markdown_error = _write_markdown_for_run(doc_id, run_id, saved)
        if not is_current_index_run(doc_id, run_id):
            return
        update_index_progress_for_run(doc_id, run_id, progress=100)
        quality_failure = _index_quality_failure(record)
        if _is_fallback_record(record) or quality_failure:
            code, label, message = quality_failure or (
                "low_quality_index",
                "索引需审核",
                "生成结果为兜底模板，请人工审核",
            )
            set_index_failure_for_run(doc_id, run_id, code, label)
            set_document_stage_for_run(doc_id, run_id, "failed", message)
            set_document_status_for_run(doc_id, run_id, "needs_review", message)
        elif markdown_error:
            _mark_markdown_write_failed(doc_id, run_id, markdown_error)
        else:
            set_document_stage_for_run(doc_id, run_id, "completed", "索引生成完成")
            set_document_status_for_run(doc_id, run_id, "indexed")
        return
    except Exception as exc:
        logger.exception("Indexing failed for doc_id=%s provider=%s", doc_id, provider)
        if _check_cancel(doc_id, run_id):
            return
        failure_code, failure_label = _classify_failure(exc)
        set_index_failure_for_run(doc_id, run_id, failure_code, failure_label)
        try:
            doc = get_document(doc_id)
            if not doc or _check_cancel(doc_id, run_id):
                return
            if not text:
                file_path = Path(doc["file_path"])
                text = parse_file(file_path=file_path, file_type=doc["file_type"])
        except Exception:
            pass
        fallback = fallback_extract(
            Path(doc["file_path"]) if doc else Path("unknown"), text
        )
        provider_row = get_provider_config_raw(provider) or {}
        if not save_index(
            doc_id,
            fallback,
            provider=provider,
            model=model or provider_row.get("model"),
            index_run_id=run_id,
        ):
            return
        fallback_saved = get_index(doc_id)
        markdown_error = _write_markdown_for_run(doc_id, run_id, fallback_saved)
        if not is_current_index_run(doc_id, run_id):
            return
        err = str(exc)
        if "timed out" in err.lower():
            err = f"{err}；可能是输入过长或模型响应慢。建议调高timeout到90-180秒，或改用更快模型。"
        if markdown_error:
            err = f"{err}；Markdown 落盘失败: {markdown_error}"
        set_document_stage_for_run(doc_id, run_id, "failed", "生成失败，已回退为人工补全模板")
        set_document_status_for_run(doc_id, run_id, "needs_review", err[:1200])
        return
    finally:
        with FUTURES_LOCK:
            RUNNING_DOC_IDS.discard(doc_id)
        if acquired and gate:
            gate.release()


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
    return {"queued": queued, "skipped": skipped, "max_concurrency": RUN_GATE_LIMIT or get_index_max_concurrency()}


@router.get("/runs/active")
def active_index_runs() -> dict:
    with FUTURES_LOCK:
        active_doc_ids = [doc_id for doc_id, future in FUTURES.items() if future and not future.done()]
        running_doc_ids = set(RUNNING_DOC_IDS)
        active_by_workspace: dict[str, int] = {}
        for doc_id in active_doc_ids:
            workspace = FUTURE_WORKSPACES.get(doc_id) or DEFAULT_WORKSPACE_ID
            active_by_workspace[workspace] = active_by_workspace.get(workspace, 0) + 1
        current_batch_limit = RUN_GATE_LIMIT or get_index_max_concurrency()
    return {
        "active_total": len(active_doc_ids),
        "active_by_workspace": active_by_workspace,
        "running_count": len(running_doc_ids),
        "queued_count": max(0, len(active_doc_ids) - len(running_doc_ids)),
        "max_concurrency": current_batch_limit,
        "configured_max_concurrency": get_index_max_concurrency(),
    }


@router.get("/settings")
def get_index_settings() -> dict:
    with FUTURES_LOCK:
        has_active = any(f and not f.done() for f in FUTURES.values())
        effective = RUN_GATE_LIMIT or get_index_max_concurrency()
    return {
        "max_concurrency": get_index_max_concurrency(),
        "effective_max_concurrency": effective,
        "pending_next_batch": has_active and effective != get_index_max_concurrency(),
        "min_concurrency": 1,
        "max_allowed_concurrency": 20,
    }


@router.put("/settings")
def update_index_settings(payload: dict = Body(...)) -> dict:
    value = payload.get("max_concurrency")
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = 8
    saved = set_index_max_concurrency(parsed)
    with FUTURES_LOCK:
        has_active = any(f and not f.done() for f in FUTURES.values())
        effective = RUN_GATE_LIMIT or saved
    return {
        "max_concurrency": saved,
        "effective_max_concurrency": effective,
        "pending_next_batch": has_active and effective != saved,
        "min_concurrency": 1,
        "max_allowed_concurrency": 20,
    }


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
    if path.exists():
        return {"doc_id": doc_id, "markdown": path.read_text(encoding="utf-8")}

    item = get_index(doc_id)
    if not item:
        raise HTTPException(status_code=404, detail="Markdown not found")
    markdown = render_markdown(doc_id, item)
    try:
        write_markdown(path, markdown)
        clear_markdown_failure(doc_id)
        rebuilt = True
        rebuild_error = None
    except Exception:
        logger.exception("Markdown rebuild failed for doc_id=%s", doc_id)
        rebuilt = False
        rebuild_error = "Markdown rebuild failed"
    payload = {"doc_id": doc_id, "markdown": markdown, "rebuilt": rebuilt}
    if rebuild_error:
        payload["rebuild_error"] = rebuild_error
    return payload


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
    _write_markdown_or_raise(doc_id, markdown)
    mark_document_indexed(doc_id, stage_message="Markdown 已人工保存")
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
    raw_authors = payload.get("authors")
    authors = [str(item or "").strip() for item in raw_authors] if isinstance(raw_authors, list) else []
    authors = [item for item in authors if item]
    generated_at = payload.get("generated_at")
    raw_year = payload.get("year")
    year_text = str(raw_year or "").strip()
    year = int(year_text) if year_text else None

    if not get_index(doc_id):
        raise HTTPException(status_code=404, detail="Index not found")

    _write_markdown_or_raise(doc_id, markdown)

    updated = update_index_editor_fields(
        doc_id,
        title=title,
        display_name=display_name,
        authors=authors,
        year=year,
        generated_at=str(generated_at or ""),
        workspace_id=workspace,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Index not found")

    mark_document_indexed(doc_id, stage_message="索引编辑已人工保存")
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
    manual_record = _manual_record_for_markdown(doc_id, payload)
    markdown = render_markdown(doc_id, manual_record)
    _write_markdown_or_raise(doc_id, markdown)
    if not save_index(doc_id, payload, provider="manual", model="manual"):
        raise HTTPException(status_code=404, detail="Document not found")
    mark_document_indexed(doc_id, stage_message="结构化索引已人工保存")
    return {"ok": True}
