from __future__ import annotations

import logging
import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..db import DEFAULT_WORKSPACE_ID
from ..provider_registry import resolve_model_name_registry_entry
from ..repository import get_provider_config_raw
from ..services.chat_modes import build_chat_context, build_chat_prompt, run_chat
from ..services.chat_v0 import run_chat_v0
from ..services.provider_client import ProviderClient, ProviderConfig
from ._context import resolve_workspace_id

router = APIRouter()
logger = logging.getLogger(__name__)


class ChatV0AskIn(BaseModel):
    question: str
    provider: str = ""
    model: str | None = None
    workspace_id: str = DEFAULT_WORKSPACE_ID


class ChatAskIn(BaseModel):
    question: str
    provider: str = ""
    model: str | None = None
    workspace_id: str = DEFAULT_WORKSPACE_ID
    mode: str = "deep"
    doc_ids: list[str] = Field(default_factory=list)
    messages: list[dict] = Field(default_factory=list)
    source_map: dict[str, str] = Field(default_factory=dict)
    session_id: str | None = None


@router.post("/ask")
def ask_chat(payload: ChatAskIn) -> dict:
    question = (payload.question or "").strip()
    logger.info(
        "chat request provider=%s model=%s mode=%s question_chars=%s doc_count=%s",
        payload.provider,
        payload.model,
        payload.mode,
        len(question),
        len(payload.doc_ids),
    )
    if not question:
        raise HTTPException(status_code=400, detail="问题不能为空")

    workspace_id = resolve_workspace_id(payload.workspace_id)
    cfg = _resolve_provider_config(payload.provider, payload.model)
    try:
        result = run_chat(
            question=question,
            provider_cfg=cfg,
            workspace_id=workspace_id,
            mode=payload.mode,  # type: ignore[arg-type]
            doc_ids=payload.doc_ids,
            history_messages=payload.messages,
            source_map=payload.source_map,
        )
        logger.info(
            "chat success mode=%s sources=%s answer_chars=%s",
            result.get("mode"),
            len(result.get("sources") or []),
            len(str(result.get("answer") or "")),
        )
        return result
    except RuntimeError as exc:
        logger.warning("chat failed err=%s", exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("chat unexpected failure")
        raise HTTPException(status_code=500, detail=f"Chat 内部错误: {exc}") from exc


@router.post("/ask_stream")
def ask_chat_stream(payload: ChatAskIn):
    question = (payload.question or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="问题不能为空")
    workspace_id = resolve_workspace_id(payload.workspace_id)
    cfg = _resolve_provider_config(payload.provider, payload.model)
    if not _model_can_stream(cfg.model):
        raise HTTPException(status_code=400, detail="当前模型未标记为支持流式输出")

    mode = payload.mode if payload.mode in {"wide", "deep", "agent"} else "deep"
    try:
        context_result = build_chat_context(
            question=question,
            workspace_id=workspace_id,
            model_name=cfg.model,
            mode=mode,  # type: ignore[arg-type]
            doc_ids=payload.doc_ids,
            source_map=payload.source_map,
        )
        system_prompt, user_prompt = build_chat_prompt(
            question=question,
            context=context_result.context,
            mode=mode,  # type: ignore[arg-type]
            history_messages=payload.messages,
            history_token_budget=int(context_result.stats.get("history_budget") or 0),
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    def generate():
        meta = {
            "type": "meta",
            "mode": mode,
            "sources": [source.__dict__ for source in context_result.sources],
            "context_stats": context_result.stats,
        }
        yield json.dumps(meta, ensure_ascii=False) + "\n"
        try:
            finish_reason_holder: dict[str, str | None] = {"value": None}

            def capture_finish_reason(reason: str | None) -> None:
                finish_reason_holder["value"] = reason

            for chunk in ProviderClient.stream_text(
                config=cfg,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                on_finish=capture_finish_reason,
            ):
                if chunk:
                    yield json.dumps({"type": "delta", "text": chunk}, ensure_ascii=False) + "\n"
            yield json.dumps({"type": "done", "finish_reason": finish_reason_holder.get("value")}, ensure_ascii=False) + "\n"
        except Exception as exc:
            logger.warning("chat stream failed err=%s", exc)
            yield json.dumps({"type": "error", "message": str(exc)}, ensure_ascii=False) + "\n"

    return StreamingResponse(generate(), media_type="application/x-ndjson")


@router.post("/ask_v0")
def ask_chat_v0(payload: ChatV0AskIn) -> dict:
    question = (payload.question or "").strip()
    logger.info(
        "chat_v0 request provider=%s model=%s question_chars=%s",
        payload.provider,
        payload.model,
        len(question),
    )
    if not question:
        raise HTTPException(status_code=400, detail="问题不能为空")

    workspace_id = resolve_workspace_id(payload.workspace_id)
    cfg = _resolve_provider_config(payload.provider, payload.model)
    try:
        result = run_chat_v0(
            question=question,
            provider_cfg=cfg,
            workspace_id=workspace_id,
        )
        logger.info(
            "chat_v0 success doc_id=%s display_name=%s answer_chars=%s",
            result.get("doc_id"),
            result.get("display_name"),
            len(str(result.get("answer") or "")),
        )
        return result
    except RuntimeError as exc:
        logger.warning("chat_v0 failed err=%s", exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("chat_v0 unexpected failure")
        raise HTTPException(status_code=500, detail=f"Chat V0 内部错误: {exc}") from exc


def _resolve_provider_config(provider: str, model: str | None) -> ProviderConfig:
    provider_name = (provider or "").strip()
    if not provider_name:
        raise HTTPException(status_code=400, detail="没有可用模型，请先配置接口")

    provider_row = get_provider_config_raw(provider_name)
    if not provider_row:
        raise HTTPException(status_code=400, detail="Provider 配置不存在")
    if not provider_row.get("api_key_enc"):
        raise HTTPException(status_code=400, detail="Provider 未配置 API Key")

    return ProviderConfig(
        provider=provider_name,
        base_url=provider_row["base_url"],
        model=model or provider_row["model"],
        api_key=provider_row["api_key_enc"],
        temperature=provider_row["temperature"] or 0.1,
        timeout=provider_row["timeout"] or 120,
    )


def _model_can_stream(model_name: str) -> bool:
    resolved = resolve_model_name_registry_entry(model_name)
    if not resolved:
        return True
    value = resolved.get("supports_streaming")
    return value is not False
