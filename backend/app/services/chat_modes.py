from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from ..db import DEFAULT_WORKSPACE_ID
from ..provider_registry import resolve_model_name_registry_entry
from ..repository import get_document, get_index, list_documents, markdown_path, search_documents
from .file_parser import parse_file
from .markdown_export import render_markdown
from .prompt_store import get_required_prompt
from .provider_client import ProviderClient, ProviderConfig

ChatMode = Literal["wide", "deep", "agent"]

DEFAULT_CONTEXT_WINDOW = 32_000
FULL_INDEX_RATIO = 0.45
ADVISORY_RATIO = 0.70
AUTO_COMPRESS_RATIO = 0.85
HARD_LIMIT_RATIO = 0.95

MODE_PROMPTS = {
    "wide": {
        "system": get_required_prompt("chat_modes/wide_system_prompt.txt"),
        "user": get_required_prompt("chat_modes/wide_user_prompt_template.txt"),
    },
    "deep": {
        "system": get_required_prompt("chat_modes/deep_system_prompt.txt"),
        "user": get_required_prompt("chat_modes/deep_user_prompt_template.txt"),
    },
    "agent": {
        "system": get_required_prompt("chat_modes/agent_system_prompt.txt"),
        "user": get_required_prompt("chat_modes/agent_user_prompt_template.txt"),
    },
}


@dataclass
class ChatSource:
    doc_id: str
    display_name: str
    title: str = ""


@dataclass
class ContextBuildResult:
    context: str
    sources: list[ChatSource]
    stats: dict[str, Any]


def run_chat(
    *,
    question: str,
    provider_cfg: ProviderConfig,
    workspace_id: str = DEFAULT_WORKSPACE_ID,
    mode: ChatMode = "deep",
    doc_ids: list[str] | None = None,
) -> dict:
    mode_value = _normalize_mode(mode)
    context_result = build_chat_context(
        question=question,
        workspace_id=workspace_id,
        model_name=provider_cfg.model,
        mode=mode_value,
        doc_ids=doc_ids or [],
    )
    system_prompt, user_prompt = build_chat_prompt(
        question=question,
        context=context_result.context,
        mode=mode_value,
    )
    answer = ProviderClient.generate_text(
        config=provider_cfg,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
    )
    return {
        "answer": answer.strip(),
        "mode": mode_value,
        "sources": [source.__dict__ for source in context_result.sources],
        "context_stats": context_result.stats,
    }


def build_chat_context(
    *,
    question: str,
    workspace_id: str,
    model_name: str,
    mode: ChatMode,
    doc_ids: list[str],
) -> ContextBuildResult:
    budget = _build_budget(model_name)
    if mode == "wide":
        result = _build_wide_context(workspace_id, question, budget)
    elif mode == "agent":
        result = _build_agent_context(workspace_id, question, budget)
    else:
        result = _build_deep_context(workspace_id, doc_ids, budget)

    estimated = estimate_tokens(result.context)
    compression_level = _compression_level(estimated, int(budget["usable_context_budget"]))
    context = result.context
    structured_fallback = bool(result.stats.get("structured_fallback"))
    truncated = bool(result.stats.get("truncated"))
    if estimated >= budget["auto_compress_threshold"]:
        context, truncated = _compress_context(context, int(budget["hard_limit_threshold"]))
        estimated = estimate_tokens(context)
        compression_level = "fallback" if truncated else "auto"

    stats = {
        **result.stats,
        **budget,
        "doc_count": len(result.sources),
        "estimated_input_tokens": estimated,
        "compression_level": compression_level,
        "structured_fallback": structured_fallback,
        "truncated": truncated,
    }
    return ContextBuildResult(context=context, sources=result.sources, stats=stats)


def build_chat_prompt(*, question: str, context: str, mode: ChatMode) -> tuple[str, str]:
    prompt_pack = MODE_PROMPTS[mode]
    user_prompt = prompt_pack["user"].format(
        question=question.strip(),
        context=context.strip(),
    )
    return prompt_pack["system"], user_prompt


def estimate_tokens(text: str) -> int:
    raw = str(text or "")
    if not raw:
        return 0
    ascii_chars = sum(1 for char in raw if ord(char) < 128)
    non_ascii_chars = len(raw) - ascii_chars
    return max(1, int(ascii_chars / 4 + non_ascii_chars / 1.8))


def resolve_model_context_window(model_name: str) -> int:
    resolved = resolve_model_name_registry_entry(model_name)
    if not resolved:
        return DEFAULT_CONTEXT_WINDOW
    value = resolved.get("context_window_tokens")
    try:
        parsed = int(value or 0)
    except (TypeError, ValueError):
        parsed = 0
    return parsed if parsed > 0 else DEFAULT_CONTEXT_WINDOW


def _build_budget(model_name: str) -> dict[str, int]:
    window = resolve_model_context_window(model_name)
    output_reserve = max(4_000, int(window * 0.15))
    system_reserve = max(2_000, int(window * 0.05))
    usable = max(1_000, window - output_reserve - system_reserve)
    return {
        "model_context_window": window,
        "output_reserve": output_reserve,
        "system_reserve": system_reserve,
        "usable_context_budget": usable,
        "advisory_threshold": int(usable * ADVISORY_RATIO),
        "auto_compress_threshold": int(usable * AUTO_COMPRESS_RATIO),
        "hard_limit_threshold": int(usable * HARD_LIMIT_RATIO),
    }


def _build_wide_context(workspace_id: str, question: str, budget: dict[str, int]) -> ContextBuildResult:
    docs = [item for item in list_documents(workspace_id=workspace_id) if item.get("status") == "indexed"]
    if not docs:
        raise RuntimeError("当前工作区暂无可用索引")

    full_items = [_load_document_context(str(doc["id"]), workspace_id, variant="index_full") for doc in docs]
    full_context = _join_context_items(full_items)
    full_tokens = estimate_tokens(full_context)
    if full_tokens <= int(budget["model_context_window"] * FULL_INDEX_RATIO):
        return ContextBuildResult(
            context=full_context,
            sources=[item["source"] for item in full_items],
            stats={"wide_strategy": "full_index", "total_index_tokens": full_tokens},
        )

    summary_items = [_load_document_context(str(doc["id"]), workspace_id, variant="summary") for doc in docs]
    summary_context = _join_context_items(summary_items)
    if estimate_tokens(summary_context) > budget["auto_compress_threshold"]:
        ranked = search_documents(
            question,
            year_from=None,
            year_to=None,
            author=None,
            keyword=None,
            status="indexed",
            workspace_id=workspace_id,
        )
        keep_ids = {str(item["doc_id"]) for item in ranked[: min(12, len(ranked))]}
        if keep_ids:
            summary_items = [item for item in summary_items if item["source"].doc_id in keep_ids]
            summary_context = _join_context_items(summary_items)

    return ContextBuildResult(
        context=summary_context,
        sources=[item["source"] for item in summary_items],
        stats={
            "wide_strategy": "structured_summary",
            "total_index_tokens": full_tokens,
            "structured_fallback": True,
        },
    )


def _build_deep_context(workspace_id: str, doc_ids: list[str], budget: dict[str, int]) -> ContextBuildResult:
    unique_ids = []
    for doc_id in doc_ids:
        cleaned = str(doc_id or "").strip()
        if cleaned and cleaned not in unique_ids:
            unique_ids.append(cleaned)
    if not unique_ids:
        raise RuntimeError("精读模式需要先选择至少一篇文献")

    items = [_load_document_context(doc_id, workspace_id, variant="original_full") for doc_id in unique_ids]
    return ContextBuildResult(
        context=_join_context_items(items),
        sources=[item["source"] for item in items],
        stats={"deep_doc_ids": unique_ids},
    )


def _build_agent_context(workspace_id: str, question: str, budget: dict[str, int]) -> ContextBuildResult:
    ranked = search_documents(
        question,
        year_from=None,
        year_to=None,
        author=None,
        keyword=None,
        status="indexed",
        workspace_id=workspace_id,
    )
    if not ranked:
        ranked = [item for item in list_documents(workspace_id=workspace_id) if item.get("status") == "indexed"]
    if not ranked:
        raise RuntimeError("当前工作区暂无可用索引")

    items = [_load_document_context(str(item.get("doc_id") or item.get("id")), workspace_id, variant="summary") for item in ranked[:8]]
    return ContextBuildResult(
        context=_join_context_items(items),
        sources=[item["source"] for item in items],
        stats={"agent_strategy": "ranked_structured_read", "agent_steps": ["search", "read_structured", "answer"]},
    )


def _load_document_context(
    doc_id: str,
    workspace_id: str,
    *,
    variant: Literal["index_full", "summary", "original_full"],
) -> dict[str, Any]:
    doc = get_document(doc_id, workspace_id=workspace_id)
    if not doc or doc.get("status") != "indexed":
        raise RuntimeError(f"文献不可用或尚未索引：{doc_id}")
    record = get_index(doc_id)
    if not record:
        raise RuntimeError(f"索引不存在：{doc_id}")
    display_name = str(doc.get("display_name") or doc.get("filename") or doc_id)
    source = ChatSource(doc_id=doc_id, display_name=display_name, title=record.title)
    if variant == "index_full":
        md_path = markdown_path(doc_id)
        content = md_path.read_text(encoding="utf-8") if md_path.exists() else render_markdown(doc_id, record)
    elif variant == "original_full":
        content = _load_original_document_content(doc)
    else:
        content = _render_structured_summary(record)
    return {"source": source, "content": f"## {display_name}\n\n{content.strip()}"}


def _load_original_document_content(doc: dict[str, Any]) -> str:
    file_path = Path(str(doc.get("file_path") or "").strip())
    file_type = str(doc.get("file_type") or "").strip().lower()
    if not file_path or not file_path.exists():
        raise RuntimeError(f"原始文件不存在：{doc.get('id')}")
    if file_type not in {"pdf", "txt", "docx"}:
        raise RuntimeError(f"暂不支持该原始文件类型：{file_type or 'unknown'}")
    raw = parse_file(file_path, file_type).strip()
    if not raw:
        raise RuntimeError(f"原始文件无可用文本内容：{doc.get('id')}")
    return raw


def _render_structured_summary(record: Any) -> str:
    parts = [
        f"标题：{record.title}",
        f"作者：{', '.join(record.authors)}" if record.authors else "作者：",
        f"年份：{record.year or ''}",
        f"关键词：{', '.join(record.keywords)}" if record.keywords else "关键词：",
        f"一句话摘要：{record.one_liner}",
        "核心观点：",
        *[f"- {item}" for item in record.core_points[:8]],
    ]
    if record.custom_fields:
        parts.append("自定义字段：")
        for key, value in list(record.custom_fields.items())[:12]:
            parts.append(f"- {key}: {value}")
    return "\n".join(parts)


def _join_context_items(items: list[dict[str, Any]]) -> str:
    return "\n\n---\n\n".join(str(item["content"]) for item in items)


def _compression_level(estimated: int, budget: int) -> str:
    if estimated >= int(budget * HARD_LIMIT_RATIO):
        return "fallback"
    if estimated >= int(budget * AUTO_COMPRESS_RATIO):
        return "auto"
    if estimated >= int(budget * ADVISORY_RATIO):
        return "advisory"
    return "none"


def _compress_context(context: str, token_budget: int) -> tuple[str, bool]:
    max_chars = max(1_000, int(token_budget * 2.4))
    if len(context) <= max_chars:
        return context, False
    return context[:max_chars].rstrip() + "\n\n[上下文已自动压缩，后续内容被省略]", True


def _normalize_mode(mode: str) -> ChatMode:
    return mode if mode in {"wide", "deep", "agent"} else "deep"  # type: ignore[return-value]
