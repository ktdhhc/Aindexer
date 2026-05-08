from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from collections.abc import Callable
from typing import Any

from ..provider_registry import resolve_model_name_registry_entry
from ..schemas import ClaimItem, IndexRecordIn
from .provider_client import ProviderClient, ProviderConfig
from .prompt_store import get_required_prompt
from .usage_tracker import record_llm_usage


SYSTEM_PROMPT = get_required_prompt("index_system_prompt.txt")
USER_PROMPT_TEMPLATE = get_required_prompt("index_user_prompt_template.txt")
TEXT_FALLBACK_PROMPT_TEMPLATE = get_required_prompt("index_text_fallback_prompt.txt")
DEFAULT_INDEX_INPUT_BUDGET_TOKENS = 50_000
DEFAULT_CONTEXT_WINDOW = 32_000
MIN_EXTRACTABLE_TEXT_CHARS = 24
MIN_EXTRACTABLE_ALNUM_CHARS = 18
_PAGE_MARKER_RE = re.compile(r"\[Page\s+(\d+)\]", re.IGNORECASE)
_SECTION_GROUPS = [
    ("abstract", (r"\babstract\b", r"摘要")),
    ("introduction", (r"\bintroduction\b", r"\bbackground\b", r"引言")),
    ("conclusion", (r"\bconclusion\b", r"\bdiscussion\b", r"结论", r"讨论")),
]


def build_user_prompt(
    text: str,
    custom_fields: list[dict[str, Any]],
    input_budget_tokens: int = DEFAULT_INDEX_INPUT_BUDGET_TOKENS,
) -> str:
    fields = [
        {
            "key": f.get("field_key") or f.get("label"),
            "type": f["field_type"],
            "description": str(f.get("description") or "").strip(),
        }
        for f in custom_fields
        if f["enabled"] and (f.get("field_key") or f.get("label"))
    ]
    doc_full = prepare_index_input_text(text, input_budget_tokens=input_budget_tokens)
    page_count = _count_page_markers(doc_full)
    page_rule = (
        "页码规则：文献文本里若出现 [Page N] 标记，claims.page 必须填写对应 N；"
        "禁止在无法定位时默认写 1，无法确定请写 -1。\n"
    )
    page_hint = (
        f"当前输入中检测到约 {page_count} 个页面标记；若页面大于1，请尽量让 claims 覆盖多个不同页面。\n"
        if page_count > 1
        else ""
    )
    return USER_PROMPT_TEMPLATE.format(
        page_rule=page_rule,
        page_hint=page_hint,
        fields_json=json.dumps(fields, ensure_ascii=False),
        doc_full=doc_full,
    )


def build_text_fallback_prompt(
    text: str,
    custom_fields: list[dict[str, Any]],
    input_budget_tokens: int = DEFAULT_INDEX_INPUT_BUDGET_TOKENS,
) -> str:
    fields = [
        {
            "key": f.get("field_key") or f.get("label"),
            "type": f["field_type"],
            "description": str(f.get("description") or "").strip(),
        }
        for f in custom_fields
        if f["enabled"] and (f.get("field_key") or f.get("label"))
    ]
    doc_full = prepare_index_input_text(text, input_budget_tokens=input_budget_tokens)
    page_count = _count_page_markers(doc_full)
    page_rule = (
        "文献文本里若出现 [Page N] 标记，CLAIMS 中的 page 必须填写对应 N；"
        "若无法确定，请写 -1。\n"
    )
    page_hint = (
        f"当前输入中检测到约 {page_count} 个页面标记；请尽量让 CLAIMS 覆盖多个不同页面。\n"
        if page_count > 1
        else ""
    )
    return TEXT_FALLBACK_PROMPT_TEMPLATE.format(
        page_rule=page_rule,
        page_hint=page_hint,
        fields_json=json.dumps(fields, ensure_ascii=False),
        doc_full=doc_full,
    )


def assess_index_quality(record: IndexRecordIn) -> tuple[str, str, str] | None:
    placeholder_markers = (
        "unknown",
        "untitled",
        "待补充",
        "未识别",
        "自动抽取失败",
        "n/a",
        "tbd",
    )

    def is_placeholder(value: object) -> bool:
        text = str(value or "").strip().lower()
        if not text:
            return True
        return any(marker in text for marker in placeholder_markers)

    signals = 0
    if is_placeholder(record.title):
        signals += 1
    if not record.authors or all(is_placeholder(author) for author in record.authors):
        signals += 1
    if not record.keywords or all(is_placeholder(keyword) for keyword in record.keywords):
        signals += 1
    if is_placeholder(record.one_liner):
        signals += 1
    if not record.core_points or all(is_placeholder(point) for point in record.core_points):
        signals += 1
    if not record.claims or all(
        is_placeholder(claim.claim_text) or not str(claim.evidence_quote or "").strip()
        for claim in record.claims
    ):
        signals += 1

    if signals >= 3:
        return (
            "low_quality_index",
            "索引需审核",
            "模型返回内容缺少有效文献信息，请人工审核或更换模型重试",
        )
    return None


def estimate_tokens(text: str) -> int:
    raw = str(text or "")
    if not raw:
        return 0
    ascii_chars = sum(1 for char in raw if ord(char) < 128)
    non_ascii_chars = len(raw) - ascii_chars
    return max(1, int(ascii_chars / 4 + non_ascii_chars / 1.8))


def prepare_index_input_text(
    text: str,
    input_budget_tokens: int = DEFAULT_INDEX_INPUT_BUDGET_TOKENS,
) -> str:
    raw = str(text or "").strip()
    _ensure_extractable_text(raw)
    budget = max(1_000, int(input_budget_tokens or DEFAULT_INDEX_INPUT_BUDGET_TOKENS))
    if estimate_tokens(raw) <= budget:
        return raw

    excerpt = _build_budgeted_excerpt(raw, budget)
    if estimate_tokens(excerpt) > budget:
        excerpt = _trim_text_to_budget(excerpt, budget)
    return excerpt.strip()


def resolve_index_input_budget(
    model_name: str,
    requested_tokens: int = DEFAULT_INDEX_INPUT_BUDGET_TOKENS,
    output_budget_tokens: int = 1500,
) -> int:
    requested = max(1_000, int(requested_tokens or DEFAULT_INDEX_INPUT_BUDGET_TOKENS))
    resolved = resolve_model_name_registry_entry(model_name)
    if not resolved:
        return requested
    try:
        context_window = int(resolved.get("context_window_tokens") or 0)
    except (TypeError, ValueError):
        context_window = 0
    if context_window <= 0:
        context_window = DEFAULT_CONTEXT_WINDOW
    system_reserve = max(1_500, int(context_window * 0.05))
    prompt_overhead = 2_000
    output_reserve = max(1_500, int(output_budget_tokens or 0))
    usable = max(1_000, context_window - system_reserve - prompt_overhead - output_reserve)
    return min(requested, usable)


def run_extraction(
    text: str,
    provider_cfg: ProviderConfig,
    custom_fields: list[dict[str, Any]],
    retries: int = 3,
    should_cancel: Callable[[], bool] | None = None,
    on_progress: Callable[[str, str, int], None] | None = None,
    output_budget_tokens: int = 1500,
    input_budget_tokens: int = DEFAULT_INDEX_INPUT_BUDGET_TOKENS,
    workspace_id: str | None = None,
    request_id: str | None = None,
) -> IndexRecordIn:
    logger = logging.getLogger(__name__)
    last_error: Exception | None = None
    retry_count = max(1, min(int(retries), 8))
    effective_input_budget = resolve_index_input_budget(
        provider_cfg.model,
        input_budget_tokens,
        output_budget_tokens,
    )
    if effective_input_budget < max(1_000, int(input_budget_tokens or DEFAULT_INDEX_INPUT_BUDGET_TOKENS)):
        logger.info(
            "Clamped index input budget model=%s requested=%s effective=%s",
            provider_cfg.model,
            input_budget_tokens,
            effective_input_budget,
        )
    user_prompt = build_user_prompt(
        text,
        custom_fields,
        input_budget_tokens=effective_input_budget,
    )
    text_fallback_prompt = build_text_fallback_prompt(
        text,
        custom_fields,
        input_budget_tokens=effective_input_budget,
    )

    json_attempts = min(2, retry_count)
    for attempt in range(1, json_attempts + 1):
        try:
            if should_cancel and should_cancel():
                raise RuntimeError("cancelled by user")
            use_stream = attempt == 1
            logger.info(
                "LLM extraction json attempt provider=%s attempt=%s/%s prompt_chars=%s custom_fields=%s stream=%s",
                provider_cfg.provider,
                attempt,
                json_attempts,
                len(user_prompt),
                len(custom_fields),
                use_stream,
            )
            data = ProviderClient.generate_json(
                provider_cfg,
                SYSTEM_PROMPT,
                user_prompt,
                should_cancel=should_cancel,
                on_progress=on_progress,
                max_tokens=output_budget_tokens,
                stream=use_stream,
                use_json_mode=True,
            )
            record_llm_usage(
                workspace_id=workspace_id,
                feature="indexing",
                operation=f"index_extract_json_attempt_{attempt}",
                provider_cfg=provider_cfg,
                input_text=SYSTEM_PROMPT + "\n" + user_prompt,
                output_text=json.dumps(data, ensure_ascii=False),
                request_id=request_id,
            )
            normalized = _normalize_output(data)
            record = IndexRecordIn(**normalized)
            quality_failure = assess_index_quality(record)
            if quality_failure:
                raise RuntimeError(quality_failure[2])
            page_count = _count_page_markers(text)
            if page_count > 2:
                pages = [c.get("page", -1) for c in normalized.get("claims", [])]
                if pages and all(p == 1 for p in pages):
                    logger.warning(
                        "Claims page suspicious provider=%s attempt=%s/%s page_markers=%s pages=%s",
                        provider_cfg.provider,
                        attempt,
                        retry_count,
                        page_count,
                        pages,
                    )
            return record
        except Exception as exc:
            if should_cancel and should_cancel():
                raise RuntimeError("cancelled by user")
            logger.warning(
                "LLM json extraction failed provider=%s attempt=%s/%s err=%s",
                provider_cfg.provider,
                attempt,
                json_attempts,
                str(exc),
            )
            last_error = RuntimeError(
                f"json extract failed at attempt={attempt}/{json_attempts}: {exc}"
            )
            continue

    try:
        if should_cancel and should_cancel():
            raise RuntimeError("cancelled by user")
        logger.info(
            "LLM extraction text fallback provider=%s prompt_chars=%s custom_fields=%s",
            provider_cfg.provider,
            len(text_fallback_prompt),
            len(custom_fields),
        )
        raw_text = ProviderClient.generate_text(
            provider_cfg,
            SYSTEM_PROMPT,
            text_fallback_prompt,
            should_cancel=should_cancel,
            max_tokens=output_budget_tokens,
            stream=False,
        )
        if not raw_text.strip():
            raise RuntimeError("text fallback empty content")
        record_llm_usage(
            workspace_id=workspace_id,
            feature="indexing",
            operation="index_extract_text_fallback",
            provider_cfg=provider_cfg,
            input_text=SYSTEM_PROMPT + "\n" + text_fallback_prompt,
            output_text=raw_text,
            request_id=request_id,
        )
        parsed_text = _parse_text_fallback_output(raw_text)
        normalized = _normalize_output(parsed_text)
        record = IndexRecordIn(**normalized)
        quality_failure = assess_index_quality(record)
        if quality_failure:
            raise RuntimeError(quality_failure[2])
        return record
    except Exception as exc:
        if should_cancel and should_cancel():
            raise RuntimeError("cancelled by user")
        logger.warning(
            "LLM text fallback failed provider=%s err=%s",
            provider_cfg.provider,
            str(exc),
        )
        last_error = RuntimeError(f"text fallback failed: {exc}")

    if last_error:
        raise last_error
    raise RuntimeError("Extraction failed")


def fallback_extract(file_path: Path, text: str) -> IndexRecordIn:
    title = _guess_title(file_path, text)
    return IndexRecordIn(
        title=title,
        authors=["Unknown"],
        year=2024,
        keywords=["待补充"],
        apa_citation="Unknown. (2024). " + title,
        one_liner="自动抽取失败，请人工补充。",
        core_points=["自动抽取失败，请人工补充。"],
        claims=[
            ClaimItem(
                claim_text="自动抽取失败，请人工补充claim",
                evidence_quote="",
                page=-1,
                section="",
            )
        ],
        custom_fields={},
    )


def _guess_title(file_path: Path, text: str) -> str:
    first_line = (text.strip().splitlines() or [""])[0].strip()
    if len(first_line) >= 8:
        return first_line[:200]
    stem = file_path.stem.replace("_", " ")
    return stem[:200]


def _normalize_output(data: dict[str, Any]) -> dict[str, Any]:
    claims = data.get("claims") or []
    normalized_claims = []
    for item in claims:
        if not isinstance(item, dict):
            continue
        page = item.get("page", -1)
        if isinstance(page, str):
            page_match = re.search(r"\d+", page)
            page = int(page_match.group(0)) if page_match else -1
        normalized_claims.append(
            {
                "claim_text": str(item.get("claim_text", "")).strip(),
                "evidence_quote": str(item.get("evidence_quote", "")).strip(),
                "page": _to_int(page, -1),
                "section": item.get("section"),
                "paragraph_index": _to_int(item.get("paragraph_index"), 1),
                "confidence": _to_float(item.get("confidence"), 0.0),
            }
        )

    if not normalized_claims:
        normalized_claims = [
            {
                "claim_text": "未识别到有效claim，请人工补充",
                "evidence_quote": "",
                "page": -1,
                "section": "",
                "paragraph_index": 1,
                "confidence": 0.0,
            }
        ]

    return {
        "title": str(data.get("title", "")).strip() or "Untitled",
        "authors": _normalize_text_list(data.get("authors"), fallback=["Unknown"]),
        "year": _to_year(data.get("year"), data.get("apa_citation")),
        "keywords": _normalize_text_list(data.get("keywords"), fallback=["待补充"]),
        "apa_citation": str(data.get("apa_citation", "")).strip()
        or _build_apa_fallback(data),
        "one_liner": str(data.get("one_liner", "")).strip() or "待补充",
        "core_points": _normalize_text_list(
            data.get("core_points"), fallback=["待补充"]
        ),
        "claims": normalized_claims,
        "custom_fields": _normalize_custom_fields(data.get("custom_fields")),
    }


def _to_int(value: Any, default: int) -> int:
    if value is None:
        return default
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        try:
            return int(value)
        except Exception:
            return default
    text = str(value).strip()
    if not text:
        return default
    m = re.search(r"-?\d+", text)
    if not m:
        return default
    try:
        return int(m.group(0))
    except Exception:
        return default


def _to_float(value: Any, default: float) -> float:
    if value is None:
        return default
    if isinstance(value, (int, float)):
        try:
            return float(value)
        except Exception:
            return default
    text = str(value).strip()
    if not text:
        return default
    m = re.search(r"-?\d+(\.\d+)?", text)
    if not m:
        return default
    try:
        return float(m.group(0))
    except Exception:
        return default


def _to_year(value: Any, apa_citation: Any) -> int:
    year = _to_int(value, -1)
    if 1500 <= year <= 2200:
        return year
    apa = str(apa_citation or "")
    m = re.search(r"\((19\d{2}|20\d{2}|21\d{2})\)", apa)
    if m:
        return int(m.group(1))
    return 0


def _parse_text_fallback_output(raw_text: str) -> dict[str, Any]:
    headers = [
        "TITLE",
        "AUTHORS",
        "YEAR",
        "KEYWORDS",
        "APA_CITATION",
        "ONE_LINER",
        "CORE_POINTS",
        "CLAIMS",
        "CUSTOM_FIELDS",
    ]
    sections: dict[str, list[str]] = {key: [] for key in headers}
    current: str | None = None
    for raw_line in str(raw_text or "").splitlines():
        line = raw_line.strip()
        matched = False
        for header in headers:
            prefix = f"{header}:"
            if line.upper().startswith(prefix):
                current = header
                rest = line[len(prefix):].strip()
                if rest:
                    sections[current].append(rest)
                matched = True
                break
        if matched:
            continue
        if current:
            sections[current].append(raw_line.rstrip())

    def split_inline_items(value: str) -> list[str]:
        parts = re.split(r"[;；,，\n]+", value)
        return [part.strip() for part in parts if part.strip()]

    def parse_bullets(lines: list[str]) -> list[str]:
        items: list[str] = []
        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue
            stripped = re.sub(r"^[\-*+]\s*", "", stripped)
            items.append(stripped)
        return items

    claims: list[dict[str, Any]] = []
    for line in parse_bullets(sections["CLAIMS"]):
        parts = [part.strip() for part in line.split("||")]
        if len(parts) < 3:
            continue
        claims.append(
            {
                "claim_text": parts[0],
                "evidence_quote": parts[1],
                "page": parts[2],
                "section": parts[3] if len(parts) >= 4 else "",
            }
        )

    custom_fields: dict[str, str] = {}
    for line in parse_bullets(sections["CUSTOM_FIELDS"]):
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        custom_fields[key.strip()] = value.strip()

    return {
        "title": "\n".join(sections["TITLE"]).strip(),
        "authors": split_inline_items("\n".join(sections["AUTHORS"]).strip()),
        "year": "\n".join(sections["YEAR"]).strip() or 0,
        "keywords": split_inline_items("\n".join(sections["KEYWORDS"]).strip()),
        "apa_citation": "\n".join(sections["APA_CITATION"]).strip(),
        "one_liner": "\n".join(sections["ONE_LINER"]).strip(),
        "core_points": parse_bullets(sections["CORE_POINTS"]),
        "claims": claims,
        "custom_fields": custom_fields,
    }


def _normalize_text_list(value: Any, fallback: list[str] | None = None) -> list[str]:
    fallback = fallback or []
    if isinstance(value, list):
        items = [str(x).strip() for x in value if str(x).strip()]
        return items or fallback
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return fallback
        separators = [";", "；", "\n", "，", ",", " and ", "、"]
        parts = [text]
        for sep in separators:
            next_parts: list[str] = []
            for part in parts:
                next_parts.extend(part.split(sep))
            parts = next_parts
        items = [p.strip() for p in parts if p.strip()]
        return items or [text]
    if value is None:
        return fallback
    txt = str(value).strip()
    return [txt] if txt else fallback


def _normalize_custom_fields(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, list):
        out: dict[str, Any] = {}
        for item in value:
            if not isinstance(item, dict):
                continue
            key = (
                item.get("key")
                or item.get("field_key")
                or item.get("name")
                or item.get("label")
            )
            if not key:
                continue
            if "value" in item:
                out[str(key)] = item.get("value")
            elif "content" in item:
                out[str(key)] = item.get("content")
            elif "text" in item:
                out[str(key)] = item.get("text")
            else:
                extra = {
                    k: v
                    for k, v in item.items()
                    if k not in {"key", "field_key", "name", "label", "type"}
                }
                out[str(key)] = extra if extra else ""
        return out
    return {}


def _build_apa_fallback(data: dict[str, Any]) -> str:
    title = str(data.get("title", "Untitled")).strip() or "Untitled"
    year = data.get("year", 2024)
    try:
        year = int(year)
    except Exception:
        year = 2024
    authors = data.get("authors") or ["Unknown"]
    if isinstance(authors, list) and authors:
        author_text = ", ".join([str(a).strip() for a in authors if str(a).strip()])
        if not author_text:
            author_text = "Unknown"
    else:
        author_text = "Unknown"
    return f"{author_text}. ({year}). {title}."


def _count_page_markers(text: str) -> int:
    return len(_PAGE_MARKER_RE.findall(text or ""))


def _ensure_extractable_text(text: str) -> None:
    content = _PAGE_MARKER_RE.sub(" ", text or "")
    compact = re.sub(r"\s+", "", content)
    alnum_count = sum(1 for char in content if char.isalnum())
    if (
        len(compact) < MIN_EXTRACTABLE_TEXT_CHARS
        or alnum_count < MIN_EXTRACTABLE_ALNUM_CHARS
    ):
        raise RuntimeError(
            "解析内容不足：未能从文件中提取足够文本，可能是扫描版PDF或图片型文档"
        )


def _build_budgeted_excerpt(text: str, budget_tokens: int) -> str:
    original_tokens = estimate_tokens(text)
    notice = (
        "注意：原文较长，以下内容已启用长文档预算裁剪策略。"
        f"原文约 {original_tokens} tokens，当前输入预算约 {budget_tokens} tokens。"
        "系统优先保留标题页、摘要、引言、结论和代表性页面。\n\n"
    )
    body_budget = max(500, budget_tokens - estimate_tokens(notice))
    page_chunks = _split_page_chunks(text)
    if page_chunks:
        body = _build_page_excerpt(page_chunks, body_budget)
    else:
        body = _build_span_excerpt(text, body_budget)
    if not body.strip():
        body = _trim_text_to_budget(text, body_budget)
    prepared = notice + body.strip()
    if estimate_tokens(prepared) <= budget_tokens:
        return prepared
    body_budget = max(200, budget_tokens - estimate_tokens(notice))
    return notice + _trim_text_to_budget(body, body_budget)


def _split_page_chunks(text: str) -> list[tuple[int | None, str]]:
    matches = list(_PAGE_MARKER_RE.finditer(text or ""))
    if not matches:
        return []
    chunks: list[tuple[int | None, str]] = []
    prefix = text[: matches[0].start()].strip()
    if prefix:
        chunks.append((None, prefix))
    for idx, match in enumerate(matches):
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        chunk = text[match.start() : end].strip()
        if not chunk:
            continue
        try:
            page_no = int(match.group(1))
        except (TypeError, ValueError):
            page_no = None
        chunks.append((page_no, chunk))
    return chunks


def _build_page_excerpt(chunks: list[tuple[int | None, str]], budget_tokens: int) -> str:
    selected = _select_page_chunk_indices(chunks)
    parts: list[str] = []
    remaining = budget_tokens
    for pos, idx in enumerate(selected):
        page_no, chunk = chunks[idx]
        label = f"page {page_no}" if page_no is not None else "front matter"
        slots_left = max(1, len(selected) - pos)
        chunk_budget = min(remaining, max(200, remaining // slots_left))
        chunk_remaining = _append_excerpt_chunk(parts, label, chunk, chunk_budget)
        remaining = max(0, remaining - (chunk_budget - chunk_remaining))
        if remaining <= 200:
            break
    return "".join(parts).strip()


def _select_page_chunk_indices(chunks: list[tuple[int | None, str]]) -> list[int]:
    selected: list[int] = []

    def add(idx: int) -> None:
        if 0 <= idx < len(chunks) and idx not in selected:
            selected.append(idx)

    for idx in range(min(4, len(chunks))):
        add(idx)
    for _label, patterns in _SECTION_GROUPS:
        for idx, (_page_no, chunk) in enumerate(chunks):
            if any(re.search(pattern, chunk, re.IGNORECASE) for pattern in patterns):
                add(idx)
                break
    add(len(chunks) // 2)
    add(len(chunks) - 1)
    return sorted(selected)


def _build_span_excerpt(text: str, budget_tokens: int) -> str:
    spans: list[tuple[int, int, str]] = []

    def add_span(start: int, end: int, label: str) -> None:
        start = max(0, start)
        end = min(len(text), end)
        if end <= start:
            return
        length = end - start
        for existing_start, existing_end, _existing_label in spans:
            overlap = max(0, min(end, existing_end) - max(start, existing_start))
            if overlap >= int(length * 0.6):
                return
        spans.append((start, end, label))

    front_size = _chars_for_tokens(int(budget_tokens * 0.35))
    add_span(0, front_size, "front matter")
    section_size = _chars_for_tokens(int(budget_tokens * 0.18))
    for label, patterns in _SECTION_GROUPS:
        idx = _find_first_pattern(text, patterns)
        if idx >= 0:
            start = max(0, idx - section_size // 4)
            add_span(start, start + section_size, label)
    middle_size = _chars_for_tokens(int(budget_tokens * 0.12))
    middle = max(0, len(text) // 2 - middle_size // 2)
    add_span(middle, middle + middle_size, "middle sample")
    end_size = _chars_for_tokens(int(budget_tokens * 0.15))
    add_span(max(0, len(text) - end_size), len(text), "ending sample")

    parts: list[str] = []
    remaining = budget_tokens
    ordered_spans = sorted(spans, key=lambda item: item[0])
    for pos, (start, end, label) in enumerate(ordered_spans):
        slots_left = max(1, len(ordered_spans) - pos)
        chunk_budget = min(remaining, max(200, remaining // slots_left))
        chunk_remaining = _append_excerpt_chunk(parts, label, text[start:end], chunk_budget)
        remaining = max(0, remaining - (chunk_budget - chunk_remaining))
        if remaining <= 200:
            break
    return "".join(parts).strip()


def _append_excerpt_chunk(
    parts: list[str],
    label: str,
    chunk: str,
    remaining_tokens: int,
) -> int:
    header = f"\n\n[Excerpt: {label}]\n"
    available = remaining_tokens - estimate_tokens(header)
    if available <= 80:
        return remaining_tokens
    fitted = _trim_text_to_budget(chunk, available)
    if not fitted:
        return remaining_tokens
    part = header + fitted
    parts.append(part)
    return max(0, remaining_tokens - estimate_tokens(part))


def _trim_text_to_budget(text: str, budget_tokens: int) -> str:
    raw = str(text or "").strip()
    if not raw or budget_tokens <= 0:
        return ""
    if estimate_tokens(raw) <= budget_tokens:
        return raw
    low = 0
    high = len(raw)
    best = ""
    while low <= high:
        mid = (low + high) // 2
        candidate = raw[:mid].strip()
        if estimate_tokens(candidate) <= budget_tokens:
            best = candidate
            low = mid + 1
        else:
            high = mid - 1
    return best.strip()


def _chars_for_tokens(tokens: int) -> int:
    return max(400, int(max(1, tokens) * 3))


def _find_first_pattern(text: str, patterns: tuple[str, ...]) -> int:
    positions = []
    for pattern in patterns:
        match = re.search(pattern, text or "", re.IGNORECASE)
        if match:
            positions.append(match.start())
    return min(positions) if positions else -1


def _pick_middle_chunk(text: str, chunk_size: int) -> str:
    lower = text.lower()
    markers = ["abstract", "摘要", "introduction", "结论", "conclusion", "method"]
    for m in markers:
        idx = lower.find(m)
        if idx >= 0:
            start = max(0, idx - chunk_size // 2)
            end = min(len(text), start + chunk_size)
            return text[start:end]
    mid = len(text) // 2
    start = max(0, mid - chunk_size // 2)
    end = min(len(text), start + chunk_size)
    return text[start:end]
