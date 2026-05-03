from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
from typing import Any, Literal

from ..db import DEFAULT_WORKSPACE_ID
from ..provider_registry import resolve_model_name_registry_entry
from ..repository import get_document, get_index, list_documents, markdown_path, search_documents
from .file_parser import parse_file
from .markdown_export import render_markdown
from .prompt_store import get_required_prompt
from .provider_client import ProviderClient, ProviderConfig
from .usage_tracker import record_llm_usage

ChatMode = Literal["wide", "deep", "agent"]

DEFAULT_CONTEXT_WINDOW = 32_000
FULL_INDEX_RATIO = 0.45
ADVISORY_RATIO = 0.70
AUTO_COMPRESS_RATIO = 0.85
HARD_LIMIT_RATIO = 0.95
HISTORY_RATIO = 0.18
MAX_HISTORY_MESSAGES = 8
MAX_HISTORY_MESSAGE_CHARS = 1_800

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
    source_id: str
    doc_id: str
    display_name: str
    title: str = ""
    authors: list[str] | None = None
    year: int | None = None
    source_kind: Literal["index", "paper"] = "index"


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
    include_index_context: bool = False,
    history_messages: list[dict[str, Any]] | None = None,
    source_map: dict[str, str] | None = None,
) -> dict:
    mode_value = _normalize_mode(mode)
    context_result = build_chat_context(
        question=question,
        workspace_id=workspace_id,
        model_name=provider_cfg.model,
        mode=mode_value,
        doc_ids=doc_ids or [],
        include_index_context=include_index_context,
        source_map=source_map or {},
    )
    system_prompt, user_prompt = build_chat_prompt(
        question=question,
        context=context_result.context,
        mode=mode_value,
        history_messages=history_messages or [],
        history_token_budget=int(context_result.stats.get("history_budget") or 0),
    )
    answer = ProviderClient.generate_text(
        config=provider_cfg,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
    )
    record_llm_usage(
        workspace_id=workspace_id,
        feature="chat",
        operation=f"chat_{mode_value}",
        provider_cfg=provider_cfg,
        input_text=system_prompt + "\n" + user_prompt,
        output_text=answer,
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
    include_index_context: bool = False,
    source_map: dict[str, str] | None = None,
) -> ContextBuildResult:
    budget = _build_budget(model_name)
    if mode == "wide":
        result = _build_wide_context(workspace_id, question, budget, source_map or {})
    elif mode == "agent":
        result = _build_agent_context(workspace_id, question, budget, source_map or {})
    else:
        result = _build_deep_context(
            workspace_id,
            doc_ids,
            budget,
            source_map or {},
            include_index_context=include_index_context,
        )

    return _finalize_context_result(result, budget)


def _finalize_context_result(
    result: ContextBuildResult,
    budget: dict[str, int],
) -> ContextBuildResult:

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


def build_chat_prompt(
    *,
    question: str,
    context: str,
    mode: ChatMode,
    history_messages: list[dict[str, Any]] | None = None,
    history_token_budget: int = 0,
) -> tuple[str, str]:
    prompt_pack = MODE_PROMPTS[mode]
    history = _format_history_messages(history_messages or [], history_token_budget)
    user_prompt = prompt_pack["user"].format(
        history=history,
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
    history_budget = max(800, int(usable * HISTORY_RATIO))
    context_budget = max(1_000, usable - history_budget)
    return {
        "model_context_window": window,
        "output_reserve": output_reserve,
        "system_reserve": system_reserve,
        "usable_context_budget": context_budget,
        "history_budget": history_budget,
        "advisory_threshold": int(context_budget * ADVISORY_RATIO),
        "auto_compress_threshold": int(context_budget * AUTO_COMPRESS_RATIO),
        "hard_limit_threshold": int(context_budget * HARD_LIMIT_RATIO),
    }


def _build_wide_context(
    workspace_id: str,
    question: str,
    budget: dict[str, int],
    source_map: dict[str, str],
) -> ContextBuildResult:
    docs = [item for item in list_documents(workspace_id=workspace_id) if item.get("status") == "indexed"]
    if not docs:
        raise RuntimeError("当前工作区暂无可用索引")

    full_items = [_load_document_context(str(doc["id"]), workspace_id, variant="index_full") for doc in docs]
    full_context = _join_context_items(full_items, stable_source_ids=source_map, source_prefix="I")
    full_tokens = estimate_tokens(full_context)
    if full_tokens <= int(budget["model_context_window"] * FULL_INDEX_RATIO):
        return ContextBuildResult(
            context=full_context,
            sources=[item["source"] for item in full_items],
            stats={
                "wide_strategy": "full_index",
                "total_indexed_count": len(docs),
                "included_source_count": len(full_items),
                "omitted_source_count": 0,
                "total_index_tokens": full_tokens,
                "wide_ranked_fallback": False,
            },
        )

    summary_items = [_load_document_context(str(doc["id"]), workspace_id, variant="summary") for doc in docs]
    summary_context = _join_context_items(summary_items, stable_source_ids=source_map, source_prefix="I")
    all_summary_tokens = estimate_tokens(summary_context)
    ranked_candidate_count = 0
    wide_ranked_fallback = False
    if all_summary_tokens > budget["auto_compress_threshold"]:
        ranked = search_documents(
            question,
            year_from=None,
            year_to=None,
            author=None,
            keyword=None,
            status="indexed",
            workspace_id=workspace_id,
        )
        ranked_candidate_count = len(ranked)
        keep_ids = {str(item["doc_id"]) for item in ranked[: min(12, len(ranked))]}
        if keep_ids:
            summary_items = [item for item in summary_items if item["source"].doc_id in keep_ids]
            summary_context = _join_context_items(summary_items, stable_source_ids=source_map, source_prefix="I")
            wide_ranked_fallback = True

    return ContextBuildResult(
        context=summary_context,
        sources=[item["source"] for item in summary_items],
        stats={
            "wide_strategy": "structured_summary",
            "total_indexed_count": len(docs),
            "included_source_count": len(summary_items),
            "omitted_source_count": max(0, len(docs) - len(summary_items)),
            "total_index_tokens": full_tokens,
            "all_summary_tokens": all_summary_tokens,
            "summary_tokens": estimate_tokens(summary_context),
            "ranked_candidate_count": ranked_candidate_count,
            "wide_ranked_fallback": wide_ranked_fallback,
            "structured_fallback": True,
        },
    )


def _build_deep_context(
    workspace_id: str,
    doc_ids: list[str],
    budget: dict[str, int],
    source_map: dict[str, str],
    *,
    include_index_context: bool,
) -> ContextBuildResult:
    unique_ids = []
    for doc_id in doc_ids:
        cleaned = str(doc_id or "").strip()
        if cleaned and cleaned not in unique_ids:
            unique_ids.append(cleaned)
    if not unique_ids:
        raise RuntimeError("精读模式需要先选择至少一篇文献")

    original_items = [_load_document_context(doc_id, workspace_id, variant="original_full") for doc_id in unique_ids]
    if not include_index_context:
        return ContextBuildResult(
            context=_join_context_items(original_items, stable_source_ids=source_map, source_prefix="P"),
            sources=[item["source"] for item in original_items],
            stats={"deep_doc_ids": unique_ids},
        )

    index_items = [_load_document_context(doc_id, workspace_id, variant="index_full") for doc_id in unique_ids]
    return ContextBuildResult(
        context=_join_deep_context(index_items, original_items, source_map),
        sources=[item["source"] for item in [*index_items, *original_items]],
        stats={
            "deep_doc_ids": unique_ids,
            "deep_include_index_context": True,
            "read_index_count": len(index_items),
            "read_original_count": len(original_items),
        },
    )


def _join_deep_context(
    index_items: list[dict[str, Any]],
    original_items: list[dict[str, Any]],
    source_map: dict[str, str],
) -> str:
    sections: list[str] = []
    if index_items:
        sections.append(
            "索引上下文：\n"
            + _join_context_items(index_items, stable_source_ids=source_map, source_prefix="I")
        )
    if original_items:
        sections.append(
            "原文上下文：\n"
            + _join_context_items(original_items, stable_source_ids=source_map, source_prefix="P")
        )
    return "\n\n===\n\n".join(section for section in sections if section.strip())


def _build_agent_context(
    workspace_id: str,
    question: str,
    budget: dict[str, int],
    source_map: dict[str, str],
) -> ContextBuildResult:
    ranked = _agent_search_candidates(workspace_id, question)
    index_items = _agent_load_index_items(ranked, workspace_id)
    original_items = _agent_load_original_items(ranked, workspace_id, question)
    trace = _build_agent_trace(index_items, original_items, len(ranked))
    return _compose_agent_context_result(
        question=question,
        ranked=ranked,
        index_items=index_items,
        original_items=original_items,
        source_map=source_map,
        trace=trace,
    )


def iter_agent_context_events(
    *,
    question: str,
    workspace_id: str,
    model_name: str,
    source_map: dict[str, str],
) -> Any:
    budget = _build_budget(model_name)
    ranked = _agent_search_candidates(workspace_id, question)
    index_items = _agent_load_index_items(ranked, workspace_id)
    original_items = _agent_load_original_items(ranked, workspace_id, question)
    trace = _build_agent_trace(index_items, original_items, len(ranked))

    for step in trace:
        yield {"type": "agent_step", "step": step}

    result = _compose_agent_context_result(
        question=question,
        ranked=ranked,
        index_items=index_items,
        original_items=original_items,
        source_map=source_map,
        trace=trace,
    )
    return _finalize_context_result(result, budget)


def _agent_search_candidates(workspace_id: str, question: str) -> list[dict[str, Any]]:
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
        ranked = [
            item for item in list_documents(workspace_id=workspace_id)
            if item.get("status") == "indexed"
        ]
    if not ranked:
        raise RuntimeError("当前工作区暂无可用索引")
    return ranked


def _agent_load_index_items(
    ranked: list[dict[str, Any]],
    workspace_id: str,
) -> list[dict[str, Any]]:
    limit = min(6, len(ranked))
    return [
        _load_document_context(
            str(item.get("doc_id") or item.get("id")),
            workspace_id,
            variant="summary",
        )
        for item in ranked[:limit]
    ]


def _agent_load_original_items(
    ranked: list[dict[str, Any]],
    workspace_id: str,
    question: str,
) -> list[dict[str, Any]]:
    if not _agent_should_read_original(question):
        return []
    limit = min(2, len(ranked))
    return [
        _load_document_context(
            str(item.get("doc_id") or item.get("id")),
            workspace_id,
            variant="original_excerpt",
            question=question,
        )
        for item in ranked[:limit]
    ]


def _build_agent_trace(
    index_items: list[dict[str, Any]],
    original_items: list[dict[str, Any]],
    candidate_count: int,
) -> list[dict[str, Any]]:
    trace: list[dict[str, Any]] = [
        {
            "step": "search",
            "label": "检索候选",
            "detail": f"{candidate_count} 篇候选",
            "status": "done",
        },
        {
            "step": "read_index",
            "label": "读取索引",
            "detail": f"{len(index_items)} 篇索引",
            "status": "done",
            "sources": [item["source"].__dict__ for item in index_items],
        },
    ]
    if original_items:
        trace.append(
            {
                "step": "read_paper",
                "label": "核对原文",
                "detail": f"{len(original_items)} 篇原文",
                "status": "done",
                "sources": [item["source"].__dict__ for item in original_items],
            }
        )
    trace.append(
        {
            "step": "answer",
            "label": "汇总回答",
            "detail": "ready",
            "status": "running",
        }
    )
    return trace


def _compose_agent_context_result(
    *,
    question: str,
    ranked: list[dict[str, Any]],
    index_items: list[dict[str, Any]],
    original_items: list[dict[str, Any]],
    source_map: dict[str, str],
    trace: list[dict[str, Any]],
) -> ContextBuildResult:
    sections: list[str] = []
    if index_items:
        sections.append(
            "候选索引上下文：\n"
            + _join_context_items(index_items, stable_source_ids=source_map, source_prefix="I")
        )
    if original_items:
        sections.append(
            "原文核对上下文：\n"
            + _join_context_items(original_items, stable_source_ids=source_map, source_prefix="P")
        )
    context = "\n\n===\n\n".join(section for section in sections if section.strip())
    return ContextBuildResult(
        context=context,
        sources=[item["source"] for item in [*index_items, *original_items]],
        stats={
            "agent_strategy": "guided_multi_read",
            "candidate_count": len(ranked),
            "read_index_count": len(index_items),
            "read_original_count": len(original_items),
            "agent_steps": [step["step"] for step in trace],
            "agent_trace": trace,
            "agent_original_triggered": bool(original_items),
        },
    )


def _load_document_context(
    doc_id: str,
    workspace_id: str,
    *,
    variant: Literal["index_full", "summary", "original_full", "original_excerpt"],
    question: str = "",
) -> dict[str, Any]:
    doc = get_document(doc_id, workspace_id=workspace_id)
    if not doc or doc.get("status") != "indexed":
        raise RuntimeError(f"文献不可用或尚未索引：{doc_id}")
    record = get_index(doc_id)
    if not record:
        raise RuntimeError(f"索引不存在：{doc_id}")
    display_name = str(doc.get("display_name") or doc.get("filename") or doc_id)
    source_kind: Literal["index", "paper"] = (
        "paper" if variant in {"original_full", "original_excerpt"} else "index"
    )
    source = ChatSource(
        source_id="",
        doc_id=doc_id,
        display_name=display_name,
        title=record.title,
        authors=list(record.authors or []),
        year=record.year,
        source_kind=source_kind,
    )
    if variant == "index_full":
        md_path = markdown_path(doc_id)
        body = md_path.read_text(encoding="utf-8") if md_path.exists() else render_markdown(doc_id, record)
    elif variant == "original_full":
        body = _load_original_document_content(doc)
    elif variant == "original_excerpt":
        body = _build_original_excerpt(_load_original_document_content(doc), question)
    else:
        body = _render_structured_summary(record)
    return {"source": source, "body": body.strip()}


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


def _agent_should_read_original(question: str) -> bool:
    q = str(question or "").lower()
    triggers = [
        "原文",
        "实验",
        "方法",
        "局限",
        "证据",
        "定义",
        "结论",
        "具体",
        "段落",
        "数据",
        "引文",
        "compare",
        "method",
        "experiment",
        "limitation",
        "evidence",
        "result",
    ]
    return any(token in q for token in triggers)


def _extract_question_terms(question: str) -> list[str]:
    return [token.lower() for token in re.findall(r"[\w\u4e00-\u9fff]+", question or "") if len(token) >= 2]


def _build_original_excerpt(raw: str, question: str, max_chars: int = 14_000) -> str:
    content = str(raw or "").strip()
    if len(content) <= max_chars:
        return content

    terms = _extract_question_terms(question)
    blocks = [block.strip() for block in re.split(r"\n\s*\n", content) if block.strip()]
    if not blocks:
        return content[:max_chars].rstrip() + "\n\n[原文已截断]"

    scored: list[tuple[int, str]] = []
    for block in blocks:
        block_lower = block.lower()
        score = sum(block_lower.count(term) for term in terms) if terms else 0
        scored.append((score, block))

    selected: list[str] = []
    used_blocks: set[str] = set()

    for block in blocks[:2]:
        if block not in used_blocks:
            selected.append(block)
            used_blocks.add(block)

    for _score, block in sorted(scored, key=lambda item: (item[0], len(item[1])), reverse=True):
        if block in used_blocks:
            continue
        selected.append(block)
        used_blocks.add(block)
        if len("\n\n".join(selected)) >= max_chars:
            break

    excerpt = "\n\n".join(selected)
    if len(excerpt) > max_chars:
        excerpt = excerpt[:max_chars].rstrip()
    return excerpt + "\n\n[原文为按问题裁剪的摘录]"


def _join_context_items(
    items: list[dict[str, Any]],
    stable_source_ids: dict[str, str] | None = None,
    source_prefix: Literal["I", "P"] = "I",
) -> str:
    if not items:
        return ""
    manifest_lines = ["可用文献顺序："]
    blocks: list[str] = []
    used_ids: set[str] = set()
    next_index = _next_source_index(stable_source_ids or {}, source_prefix)
    for item in items:
        source: ChatSource = item["source"]
        candidate = _normalize_source_id(
            _lookup_stable_source_id(stable_source_ids or {}, source),
            source_prefix,
        )
        if not candidate or candidate in used_ids:
            candidate = f"{source_prefix}-{next_index:02d}"
            next_index += 1
        source.source_id = candidate
        used_ids.add(candidate)
        title = source.display_name if not source.title or source.title == source.display_name else f"{source.display_name} | {source.title}"
        manifest_lines.append(f"[{source.source_id}] {title}")
        blocks.append(f"## [{source.source_id}] {title}\n\n{str(item['body']).strip()}")
    manifest = "\n".join(manifest_lines)
    return f"{manifest}\n\n---\n\n" + "\n\n---\n\n".join(blocks)


def _format_history_messages(messages: list[dict[str, Any]], token_budget: int) -> str:
    normalized: list[str] = []
    for item in messages:
        role = str(item.get("role") or "").strip().lower()
        if role not in {"user", "assistant"}:
            continue
        content = str(item.get("content") or "").strip()
        if not content:
            continue
        if len(content) > MAX_HISTORY_MESSAGE_CHARS:
            content = content[:MAX_HISTORY_MESSAGE_CHARS].rstrip() + "..."
        label = "User" if role == "user" else "Assistant"
        lines = [f"{label}:", content]
        sources = item.get("sources") if isinstance(item.get("sources"), list) else []
        source_refs = []
        for source in sources:
            if not isinstance(source, dict):
                continue
            source_id = _normalize_source_id(source.get("source_id")) or ""
            display_name = str(source.get("display_name") or source.get("title") or source.get("doc_id") or "").strip()
            if source_id and display_name:
                source_refs.append(f"[{source_id}] {display_name}")
            elif display_name:
                source_refs.append(display_name)
        if source_refs:
            lines.append("涉及文献：" + "；".join(source_refs[:8]))
        normalized.append("\n".join(lines))

    if not normalized:
        return "（无）"

    selected: list[str] = []
    spent = 0
    for entry in reversed(normalized[-MAX_HISTORY_MESSAGES:]):
        tokens = estimate_tokens(entry)
        if selected and token_budget > 0 and spent + tokens > token_budget:
            break
        if not selected and token_budget > 0 and tokens > token_budget:
            max_chars = max(240, int(token_budget * 2.4))
            entry = entry[:max_chars].rstrip() + "..."
            tokens = estimate_tokens(entry)
        selected.append(entry)
        spent += tokens
    selected.reverse()
    return "\n\n".join(selected)


def _is_valid_source_id(value: str, prefix: str | None = None) -> bool:
    match = re.fullmatch(r"([IP])-?(\d{2,})", value or "")
    if not match:
        return False
    return match.group(1) == prefix if prefix else True


def _normalize_source_id(value: Any, prefix: str | None = None) -> str | None:
    raw = str(value or "").strip().upper()
    match = re.fullmatch(r"([IP])-?(\d{2,})", raw)
    if not match:
        return None
    resolved_prefix = match.group(1)
    if prefix and resolved_prefix != prefix:
        return None
    digits = match.group(2)
    return f"{resolved_prefix}-{digits}"


def _source_map_key(doc_id: str, source_kind: str) -> str:
    return f"{source_kind}:{doc_id}"


def _lookup_stable_source_id(source_map: dict[str, str], source: ChatSource) -> str | None:
    contextual_key = _source_map_key(source.doc_id, source.source_kind)
    return source_map.get(contextual_key) or source_map.get(source.doc_id)


def _next_source_index(source_map: dict[str, str], prefix: Literal["I", "P"]) -> int:
    highest = 0
    for value in source_map.values():
        candidate = _normalize_source_id(value, prefix)
        if not candidate:
            continue
        highest = max(highest, int(candidate.split("-", 1)[1]))
    return highest + 1 if highest > 0 else 1


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
