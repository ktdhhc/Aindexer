from __future__ import annotations

import json
import threading
import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from typing import Any, Literal

from ..repository import get_index, list_documents
from .chat_modes import (
    ChatSource,
    ContextBuildResult,
    _build_budget,
    _compress_context,
    _finalize_context_result,
    _format_history_messages,
    _join_context_items,
    _load_document_context,
    estimate_tokens,
)
from .prompt_store import get_required_prompt
from .provider_client import JSON_SCHEMA_HINT, ProviderClient, ProviderConfig, _parse_json_strict
from .usage_tracker import record_llm_usage


AgentAction = Literal["answer", "read_metadata", "read_index", "read_paper", "not_found"]

MAX_ITERATIONS = 6
PAPER_TOP_K = 2
TRACE_SOURCE_PREVIEW_LIMIT = 6
PLANNER_DECISION_RETRIES = 2

PLANNER_SYSTEM_PROMPT = get_required_prompt("chat_agent/planner_system_prompt.txt")
PLANNER_USER_PROMPT = get_required_prompt("chat_agent/planner_user_prompt_template.txt")
FINAL_SYSTEM_PROMPT = get_required_prompt("chat_agent/final_system_prompt.txt")
FINAL_USER_PROMPT = get_required_prompt("chat_agent/final_user_prompt_template.txt")


@dataclass
class AgentRunConfig:
    max_iterations: int = MAX_ITERATIONS
    paper_top_k: int = PAPER_TOP_K


@dataclass
class AgentDecision:
    action: AgentAction
    reason: str
    doc_ids: list[str] = field(default_factory=list)
    answer: str = ""
    citations: dict[str, list[str]] = field(default_factory=dict)


@dataclass
class AgentRunState:
    run_id: str
    workspace_id: str
    question: str
    metadata_items: list[dict[str, Any]]
    index_items: list[dict[str, Any]] = field(default_factory=list)
    paper_items: list[dict[str, Any]] = field(default_factory=list)
    trace: list[dict[str, Any]] = field(default_factory=list)
    loaded_index_doc_ids: set[str] = field(default_factory=set)
    loaded_paper_doc_ids: set[str] = field(default_factory=set)


_CANCEL_EVENTS: dict[str, threading.Event] = {}
_CANCEL_LOCK = threading.Lock()


def register_chat_run(run_id: str | None = None) -> tuple[str, Callable[[], bool]]:
    resolved = str(run_id or f"chat_run_{uuid.uuid4().hex[:12]}").strip()
    if not resolved:
        resolved = f"chat_run_{uuid.uuid4().hex[:12]}"
    event = threading.Event()
    with _CANCEL_LOCK:
        _CANCEL_EVENTS[resolved] = event
    return resolved, event.is_set


def cancel_chat_run(run_id: str) -> bool:
    with _CANCEL_LOCK:
        event = _CANCEL_EVENTS.get(str(run_id or ""))
    if not event:
        return False
    event.set()
    return True


def unregister_chat_run(run_id: str) -> None:
    with _CANCEL_LOCK:
        _CANCEL_EVENTS.pop(str(run_id or ""), None)


def stream_agent_chat(
    *,
    question: str,
    workspace_id: str,
    provider_cfg: ProviderConfig,
    history_messages: list[dict[str, Any]] | None = None,
    run_id: str | None = None,
    config: AgentRunConfig | None = None,
) -> Iterator[dict[str, Any]]:
    cfg = config or AgentRunConfig()
    resolved_run_id, should_cancel = register_chat_run(run_id)
    try:
        yield {
            "type": "agent_run",
            "run_id": resolved_run_id,
            "max_iterations": cfg.max_iterations,
            "paper_top_k": cfg.paper_top_k,
        }
        yield from _stream_agent_chat_registered(
            question=question,
            workspace_id=workspace_id,
            provider_cfg=provider_cfg,
            history_messages=history_messages or [],
            run_id=resolved_run_id,
            should_cancel=should_cancel,
            config=cfg,
        )
    finally:
        unregister_chat_run(resolved_run_id)


def _stream_agent_chat_registered(
    *,
    question: str,
    workspace_id: str,
    provider_cfg: ProviderConfig,
    history_messages: list[dict[str, Any]],
    run_id: str,
    should_cancel: Callable[[], bool],
    config: AgentRunConfig,
) -> Iterator[dict[str, Any]]:
    budget = _build_budget(provider_cfg.model)
    history = _format_history_messages(history_messages, int(budget.get("history_budget") or 0))
    auto_inject_metadata = not _has_prior_turns(history_messages)
    state = AgentRunState(
        run_id=run_id,
        workspace_id=workspace_id,
        question=question,
        metadata_items=load_metadata_layer(workspace_id),
    )
    if not state.metadata_items:
        raise RuntimeError("当前工作区暂无可用索引")

    _hydrate_state_from_history_sources(
        state,
        history_messages,
        should_cancel=should_cancel,
    )

    metadata_visible_next = auto_inject_metadata
    if auto_inject_metadata:
        metadata_step = _trace_step("metadata", "元数据", f"{len(state.metadata_items)} 篇", status="done")
        state.trace.append(metadata_step)
        yield {"type": "agent_step", "step": metadata_step}

    for iteration in range(1, config.max_iterations + 1):
        _raise_if_cancelled(should_cancel)
        metadata_visible = metadata_visible_next
        metadata_visible_next = False
        retry_steps: list[dict[str, Any]] = []
        decision = yield from _plan_next_action(
            provider_cfg=provider_cfg,
            state=state,
            history=history,
            iteration=iteration,
            metadata_visible=metadata_visible,
            budget=budget,
            config=config,
            should_cancel=should_cancel,
            on_retry=lambda attempt, total: retry_steps.append(
                _build_retry_trace_step(iteration, attempt, total)
            ),
        )
        for retry_step in retry_steps:
            state.trace.append(retry_step)
            yield {"type": "agent_step", "step": retry_step}
        if iteration >= config.max_iterations and decision.action in {"read_metadata", "read_index", "read_paper"}:
            max_step = _trace_step("max_iterations", "轮次", f"{config.max_iterations}/{config.max_iterations}", status="done")
            state.trace.append(max_step)
            yield {"type": "agent_step", "step": max_step}
            yield from _stream_final_answer(
                provider_cfg=provider_cfg,
                state=state,
                history=history,
                budget=budget,
                draft_answer=decision.answer,
                finish_reason="已达最大轮次，基于已读内容回答。",
                should_cancel=should_cancel,
            )
            return

        if decision.action in {"answer", "not_found"}:
            yield from _stream_final_answer(
                provider_cfg=provider_cfg,
                state=state,
                history=history,
                budget=budget,
                draft_answer=decision.answer,
                finish_reason=decision.reason or decision.action,
                should_cancel=should_cancel,
            )
            return

        if decision.action == "read_metadata":
            state.metadata_items = load_metadata_layer(workspace_id)
            metadata_visible_next = True
            step = _trace_step("read_metadata", "元数据", f"{len(state.metadata_items)} 篇", iteration=iteration, status="done")
            state.trace.append(step)
            yield {"type": "agent_step", "step": step}
            continue

        if decision.action == "read_index":
            new_items = load_index_layer(decision.doc_ids, workspace_id, state, should_cancel=should_cancel)
            step = _read_trace_step("read_index", "索引", new_items, iteration)
            state.trace.append(step)
            yield {"type": "agent_step", "step": step}
            continue

        if decision.action == "read_paper":
            new_items = load_paper_layer(decision.doc_ids, workspace_id, state, top_k=config.paper_top_k, should_cancel=should_cancel)
            step = _read_trace_step("read_paper", "原文", new_items, iteration)
            state.trace.append(step)
            yield {"type": "agent_step", "step": step}
            continue

    yield from _stream_final_answer(
        provider_cfg=provider_cfg,
        state=state,
        history=history,
        budget=budget,
        draft_answer="",
        finish_reason="已达最大轮次，基于已读内容回答。",
        should_cancel=should_cancel,
    )


def load_metadata_layer(workspace_id: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for doc in list_documents(workspace_id=workspace_id):
        if doc.get("status") != "indexed":
            continue
        doc_id = str(doc.get("id") or doc.get("doc_id") or "").strip()
        if not doc_id:
            continue
        record = get_index(doc_id)
        if not record:
            continue
        items.append(
            {
                "doc_id": doc_id,
                "display_name": str(doc.get("display_name") or doc.get("filename") or doc_id),
                "filename": str(doc.get("filename") or ""),
                "file_type": str(doc.get("file_type") or ""),
                "title": record.title,
                "authors": list(record.authors or []),
                "year": record.year,
                "keywords": list(record.keywords or []),
                "one_liner": record.one_liner,
                "core_points": list(record.core_points or [])[:3],
                "custom_fields": dict(list((record.custom_fields or {}).items())[:6]),
            }
        )
    return items


def load_index_layer(
    doc_ids: list[str],
    workspace_id: str,
    state: AgentRunState,
    *,
    should_cancel: Callable[[], bool] | None = None,
) -> list[dict[str, Any]]:
    new_items: list[dict[str, Any]] = []
    for doc_id in _unique_doc_ids(doc_ids):
        _raise_if_cancelled(should_cancel)
        if doc_id in state.loaded_index_doc_ids:
            continue
        item = _load_document_context(doc_id, workspace_id, variant="index_full")
        state.index_items.append(item)
        state.loaded_index_doc_ids.add(doc_id)
        new_items.append(item)
    _refresh_source_ids(state)
    return new_items


def load_paper_layer(
    doc_ids: list[str],
    workspace_id: str,
    state: AgentRunState,
    *,
    top_k: int,
    should_cancel: Callable[[], bool] | None = None,
) -> list[dict[str, Any]]:
    new_items: list[dict[str, Any]] = []
    for doc_id in _unique_doc_ids(doc_ids)[: max(0, int(top_k))]:
        _raise_if_cancelled(should_cancel)
        if doc_id in state.loaded_paper_doc_ids:
            continue
        item = _load_document_context(doc_id, workspace_id, variant="original_full")
        state.paper_items.append(item)
        state.loaded_paper_doc_ids.add(doc_id)
        new_items.append(item)
    _refresh_source_ids(state)
    return new_items


def _plan_next_action(
    *,
    provider_cfg: ProviderConfig,
    state: AgentRunState,
    history: str,
    iteration: int,
    metadata_visible: bool,
    budget: dict[str, int],
    config: AgentRunConfig,
    should_cancel: Callable[[], bool],
    on_retry: Callable[[int, int], None] | None = None,
) -> Iterator[dict[str, Any]]:
    base_user_prompt = PLANNER_USER_PROMPT.format(
        iteration=iteration,
        max_iterations=config.max_iterations,
        remaining_iterations=max(0, config.max_iterations - iteration),
        metadata_visible="是" if metadata_visible else "否",
        metadata_count=len(state.metadata_items),
        paper_top_k=config.paper_top_k,
        question=state.question.strip(),
        history=history,
        trace=_format_trace_for_prompt(state.trace),
        metadata_context=_format_metadata_layer(state.metadata_items) if metadata_visible else "（本轮未注入；如需重新筛选全库，请返回 read_metadata）",
        index_context=_context_for_items(state.index_items, "I", budget),
        paper_context=_context_for_items(state.paper_items, "P", budget),
    )
    last_error: RuntimeError | None = None
    last_error_text: str = ""
    same_error_count = 0
    thinking_id = f"agent_planner_{iteration}"
    thinking_started = False

    for attempt in range(1, PLANNER_DECISION_RETRIES + 1):
        retry_suffix = ""
        if attempt > 1:
            retry_suffix = (
                f"\n\n你上一次输出存在错误：{last_error_text}"
                "\n请严格检查输出格式后重新返回。"
                "只能返回合法 JSON，action 只能是 answer / read_metadata / read_index / read_paper / not_found。"
            )
        response_parts: list[str] = []
        for event in ProviderClient.stream_events(
            config=provider_cfg,
            system_prompt=PLANNER_SYSTEM_PROMPT + "\n" + JSON_SCHEMA_HINT,
            user_prompt=base_user_prompt + retry_suffix,
            should_cancel=should_cancel,
        ):
            if event["type"] == "thinking":
                if not thinking_started:
                    yield {"type": "thinking_start", "thinking_id": thinking_id, "label": f"规划 {iteration}"}
                    thinking_started = True
                yield {"type": "thinking_delta", "thinking_id": thinking_id, "text": event.get("text") or ""}
                continue
            if event["type"] == "text":
                if thinking_started:
                    yield {"type": "thinking_end", "thinking_id": thinking_id}
                    thinking_started = False
                response_parts.append(str(event.get("text") or ""))
                continue
        if thinking_started:
            yield {"type": "thinking_end", "thinking_id": thinking_id}
            thinking_started = False
        try:
            raw = _parse_json_strict("".join(response_parts))
        except RuntimeError as exc:
            last_error = exc
            error_msg = str(exc)
            if error_msg == last_error_text:
                same_error_count += 1
            else:
                same_error_count = 1
            last_error_text = error_msg
            if same_error_count >= 2:
                break
            if on_retry and attempt < PLANNER_DECISION_RETRIES:
                on_retry(attempt, PLANNER_DECISION_RETRIES)
            continue
        record_llm_usage(
            workspace_id=state.workspace_id,
            feature="chat",
            operation="chat_agent_planner",
            provider_cfg=provider_cfg,
            input_text=PLANNER_SYSTEM_PROMPT + "\n" + base_user_prompt + retry_suffix,
            output_text=json.dumps(raw, ensure_ascii=False),
            request_id=state.run_id,
        )
        try:
            return _parse_decision(raw)
        except RuntimeError as exc:
            last_error = exc
            error_msg = str(exc)
            if error_msg == last_error_text:
                same_error_count += 1
            else:
                same_error_count = 1
            last_error_text = error_msg
            if same_error_count >= 2:
                break
            if on_retry and attempt < PLANNER_DECISION_RETRIES:
                on_retry(attempt, PLANNER_DECISION_RETRIES)
    return _fallback_decision(state, metadata_visible, last_error)


def _stream_final_answer(
    *,
    provider_cfg: ProviderConfig,
    state: AgentRunState,
    history: str,
    budget: dict[str, int],
    draft_answer: str,
    finish_reason: str,
    should_cancel: Callable[[], bool],
) -> Iterator[dict[str, Any]]:
    _raise_if_cancelled(should_cancel)
    context_result = _finalize_agent_context(state, budget)
    yield {
        "type": "meta",
        "mode": "agent",
        "sources": [source.__dict__ for source in context_result.sources],
        "context_stats": context_result.stats,
    }
    user_prompt = FINAL_USER_PROMPT.format(
        question=state.question.strip(),
        history=history,
        finish_reason=finish_reason,
        draft_answer=draft_answer.strip() or "（无）",
        context=context_result.context.strip() or "（没有读取到索引或原文内容）",
    )
    finish_reason_holder: dict[str, str | None] = {"value": None}
    output_parts: list[str] = []
    thinking_id = f"agent_final_{state.run_id}"
    thinking_started = False
    thinking_finished = False

    for event in ProviderClient.stream_events(
        config=provider_cfg,
        system_prompt=FINAL_SYSTEM_PROMPT,
        user_prompt=user_prompt,
        should_cancel=should_cancel,
    ):
        if event["type"] == "thinking":
            if not thinking_started:
                yield {"type": "thinking_start", "thinking_id": thinking_id, "label": "回答前思考"}
                thinking_started = True
            yield {"type": "thinking_delta", "thinking_id": thinking_id, "text": event.get("text") or ""}
            continue
        if event["type"] == "text":
            if thinking_started and not thinking_finished:
                yield {"type": "thinking_end", "thinking_id": thinking_id}
                thinking_finished = True
            text = str(event.get("text") or "")
            if text:
                output_parts.append(text)
                yield {"type": "delta", "text": text}
            continue
        if event["type"] == "finish":
            finish_reason_holder["value"] = str(event.get("finish_reason") or "") or None
    if thinking_started and not thinking_finished:
        yield {"type": "thinking_end", "thinking_id": thinking_id}
    record_llm_usage(
        workspace_id=state.workspace_id,
        feature="chat",
        operation="chat_agent_final",
        provider_cfg=provider_cfg,
        input_text=FINAL_SYSTEM_PROMPT + "\n" + user_prompt,
        output_text="".join(output_parts),
        request_id=state.run_id,
    )
    yield {"type": "done", "finish_reason": finish_reason_holder.get("value")}


def _finalize_agent_context(state: AgentRunState, budget: dict[str, int]) -> ContextBuildResult:
    _refresh_source_ids(state)
    sections: list[str] = []
    if state.index_items:
        sections.append("索引层：\n" + _join_context_items(state.index_items, source_prefix="I"))
    if state.paper_items:
        sections.append("正文层：\n" + _join_context_items(state.paper_items, source_prefix="P"))
    context = "\n\n===\n\n".join(sections)
    sources = [item["source"] for item in [*state.index_items, *state.paper_items]]
    result = ContextBuildResult(
        context=context,
        sources=sources,
        stats={
            "agent_strategy": "llm_loop",
            "metadata_count": len(state.metadata_items),
            "read_index_count": len(state.index_items),
            "read_original_count": len(state.paper_items),
            "max_iterations": MAX_ITERATIONS,
            "paper_top_k": PAPER_TOP_K,
            "agent_steps": [step.get("step") for step in state.trace],
            "agent_trace": state.trace,
        },
    )
    return _finalize_context_result(result, budget)


def _refresh_source_ids(state: AgentRunState) -> None:
    if state.index_items:
        _join_context_items(state.index_items, source_prefix="I")
    if state.paper_items:
        _join_context_items(state.paper_items, source_prefix="P")


def _context_for_items(items: list[dict[str, Any]], prefix: Literal["I", "P"], budget: dict[str, int]) -> str:
    if not items:
        return "（无）"
    context = _join_context_items(items, source_prefix=prefix)
    max_tokens = max(1_000, int(budget.get("hard_limit_threshold") or 12_000))
    compressed, _truncated = _compress_context(context, max_tokens)
    return compressed


def _format_metadata_layer(items: list[dict[str, Any]]) -> str:
    if not items:
        return "（无）"
    lines: list[str] = []
    for item in items:
        authors = ", ".join([str(author) for author in item.get("authors") or []][:3])
        keywords = ", ".join([str(keyword) for keyword in item.get("keywords") or []][:6])
        core = "；".join([str(point) for point in item.get("core_points") or []][:3])
        parts = [
            f"doc_id={item.get('doc_id')}",
            f"name={item.get('display_name')}",
            f"title={item.get('title') or ''}",
            f"year={item.get('year') or ''}",
            f"authors={authors}",
            f"keywords={keywords}",
            f"summary={item.get('one_liner') or ''}",
            f"core={core}",
        ]
        lines.append("- " + " | ".join(parts))
    return "\n".join(lines)


def _format_trace_for_prompt(trace: list[dict[str, Any]]) -> str:
    if not trace:
        return "（无）"
    return "\n".join(
        f"- {item.get('label') or item.get('step')}: {item.get('detail') or item.get('status') or ''}"
        for item in trace[-12:]
    )


def _parse_decision(raw: dict[str, Any]) -> AgentDecision:
    action = str(raw.get("action") or "").strip()
    if action not in {"answer", "read_metadata", "read_index", "read_paper", "not_found"}:
        raise RuntimeError(f"探索规划返回了未知动作：{action or 'empty'}")
    doc_ids = raw.get("doc_ids") if isinstance(raw.get("doc_ids"), list) else []
    citations = raw.get("citations") if isinstance(raw.get("citations"), dict) else {}
    return AgentDecision(
        action=action,  # type: ignore[arg-type]
        reason=str(raw.get("reason") or "").strip(),
        doc_ids=[str(item).strip() for item in doc_ids if str(item).strip()],
        answer=str(raw.get("answer") or "").strip(),
        citations={
            "index": [str(item) for item in citations.get("index", [])] if isinstance(citations.get("index"), list) else [],
            "paper": [str(item) for item in citations.get("paper", [])] if isinstance(citations.get("paper"), list) else [],
        },
    )


def _fallback_decision(
    state: AgentRunState,
    metadata_visible: bool,
    error: RuntimeError | None,
) -> AgentDecision:
    if not metadata_visible and not state.index_items and not state.paper_items:
        return AgentDecision(
            action="read_metadata",
            reason=f"planner_fallback: {error or 'missing action'}",
        )
    if metadata_visible and not state.index_items:
        top_doc_ids = [
            str(item.get("doc_id") or "").strip()
            for item in state.metadata_items[:3]
            if str(item.get("doc_id") or "").strip()
        ]
        if top_doc_ids:
            return AgentDecision(
                action="read_index",
                reason=f"planner_fallback: {error or 'missing action'}",
                doc_ids=top_doc_ids,
            )
    return AgentDecision(
        action="answer",
        reason=f"planner_fallback: {error or 'missing action'}",
        answer="当前规划步骤返回无效动作，以下回答基于已读取内容。",
    )


def _build_retry_trace_step(
    iteration: int,
    attempt: int,
    total: int,
) -> dict[str, Any]:
    return _trace_step(
        f"planner_retry_{iteration}_{attempt}",
        "规划",
        f"重试 {attempt}/{total}",
        iteration=iteration,
        status="done",
    )


def _read_trace_step(step: str, label: str, items: list[dict[str, Any]], iteration: int) -> dict[str, Any]:
    return _trace_step(
        step,
        label,
        f"{len(items)} 篇",
        iteration=iteration,
        status="done",
        sources=[item["source"].__dict__ for item in items[:TRACE_SOURCE_PREVIEW_LIMIT]],
    )


def _trace_step(
    step: str,
    label: str,
    detail: str,
    *,
    status: str = "done",
    iteration: int | None = None,
    sources: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "step": step,
        "label": label,
        "detail": detail,
        "status": status,
    }
    if iteration is not None:
        payload["iteration"] = iteration
    if sources:
        payload["sources"] = sources
    return payload


def _unique_doc_ids(doc_ids: list[str]) -> list[str]:
    unique: list[str] = []
    for doc_id in doc_ids:
        cleaned = str(doc_id or "").strip()
        if cleaned and cleaned not in unique:
            unique.append(cleaned)
    return unique


def _hydrate_state_from_history_sources(
    state: AgentRunState,
    history_messages: list[dict[str, Any]],
    *,
    should_cancel: Callable[[], bool] | None = None,
) -> None:
    index_doc_ids: list[str] = []
    paper_doc_ids: list[str] = []
    for item in history_messages:
        sources = item.get("sources") if isinstance(item.get("sources"), list) else []
        for source in sources:
            if not isinstance(source, dict):
                continue
            doc_id = str(source.get("doc_id") or "").strip()
            if not doc_id:
                continue
            source_kind = str(source.get("source_kind") or "index").strip().lower()
            if source_kind == "paper":
                if doc_id not in paper_doc_ids:
                    paper_doc_ids.append(doc_id)
            else:
                if doc_id not in index_doc_ids:
                    index_doc_ids.append(doc_id)
    if index_doc_ids:
        load_index_layer(index_doc_ids, state.workspace_id, state, should_cancel=should_cancel)
    if paper_doc_ids:
        load_paper_layer(
            paper_doc_ids,
            state.workspace_id,
            state,
            top_k=len(paper_doc_ids),
            should_cancel=should_cancel,
        )


def _has_prior_turns(messages: list[dict[str, Any]]) -> bool:
    for item in messages:
        role = str(item.get("role") or "").strip().lower()
        if role in {"user", "assistant"} and str(item.get("content") or "").strip():
            return True
    return False


def _raise_if_cancelled(should_cancel: Callable[[], bool] | None) -> None:
    if should_cancel and should_cancel():
        raise RuntimeError("cancelled by user")
