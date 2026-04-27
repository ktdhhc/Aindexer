from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from collections.abc import Callable
from typing import Any

from ..schemas import ClaimItem, IndexRecordIn
from .provider_client import ProviderClient, ProviderConfig
from .prompt_store import get_required_prompt


SYSTEM_PROMPT = get_required_prompt("index_system_prompt.txt")
USER_PROMPT_TEMPLATE = get_required_prompt("index_user_prompt_template.txt")


def build_user_prompt(
    text: str,
    custom_fields: list[dict[str, Any]],
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
    doc_full = (text or "").strip()
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


def run_extraction(
    text: str,
    provider_cfg: ProviderConfig,
    custom_fields: list[dict[str, Any]],
    retries: int = 3,
    should_cancel: Callable[[], bool] | None = None,
) -> IndexRecordIn:
    logger = logging.getLogger(__name__)
    last_error: Exception | None = None
    retry_count = max(1, min(int(retries), 8))
    for attempt in range(1, retry_count + 1):
        try:
            if should_cancel and should_cancel():
                raise RuntimeError("cancelled by user")
            user_prompt = build_user_prompt(text, custom_fields)
            logger.info(
                "LLM extraction attempt provider=%s attempt=%s/%s prompt_chars=%s custom_fields=%s",
                provider_cfg.provider,
                attempt,
                retry_count,
                len(user_prompt),
                len(custom_fields),
            )
            data = ProviderClient.generate_json(
                provider_cfg,
                SYSTEM_PROMPT,
                user_prompt,
                should_cancel=should_cancel,
            )
            normalized = _normalize_output(data)
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
            return IndexRecordIn(**normalized)
        except Exception as exc:
            if should_cancel and should_cancel():
                raise RuntimeError("cancelled by user")
            logger.warning(
                "LLM extraction failed provider=%s attempt=%s/%s err=%s",
                provider_cfg.provider,
                attempt,
                retry_count,
                str(exc),
            )
            last_error = RuntimeError(
                f"extract failed at attempt={attempt}/{retry_count}: {exc}"
            )
            continue
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
    return 2024


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
    return len(re.findall(r"\[Page\s+\d+\]", text or ""))


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
