from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..db import DEFAULT_WORKSPACE_ID
from ..repository import get_provider_config_raw
from ..repository import workspace_exists
from ..services.chat_v0 import run_chat_v0
from ..services.provider_client import ProviderConfig

router = APIRouter()
logger = logging.getLogger(__name__)


class ChatV0AskIn(BaseModel):
    question: str
    provider: str = ""
    model: str | None = None
    workspace_id: str = DEFAULT_WORKSPACE_ID


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

    provider_name = (payload.provider or "").strip()
    if not provider_name:
        raise HTTPException(status_code=400, detail="没有可用模型，请先配置接口")

    workspace_id = (
        str(payload.workspace_id or DEFAULT_WORKSPACE_ID).strip()
        or DEFAULT_WORKSPACE_ID
    )
    if not workspace_exists(workspace_id):
        raise HTTPException(status_code=404, detail="Workspace not found")

    provider_row = get_provider_config_raw(provider_name)
    if not provider_row:
        raise HTTPException(status_code=400, detail="Provider 配置不存在")
    if not provider_row.get("api_key_enc"):
        raise HTTPException(status_code=400, detail="Provider 未配置 API Key")

    cfg = ProviderConfig(
        provider=provider_name,
        base_url=provider_row["base_url"],
        model=payload.model or provider_row["model"],
        api_key=provider_row["api_key_enc"],
        temperature=provider_row["temperature"] or 0.1,
        timeout=provider_row["timeout"] or 120,
    )
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
