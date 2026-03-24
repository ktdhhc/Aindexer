from __future__ import annotations

import hashlib
import importlib

translation_schemas = importlib.import_module("app.translation.schemas")


def normalize_anchor_quote(text: str) -> str:
    return " ".join(str(text or "").replace("\n", " ").split())


def compute_anchor_checksum(*parts: str) -> str:
    raw = "\n".join(str(part or "") for part in parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def build_selection_anchor(
    *,
    page_number: int,
    quote: str,
    rects: list[object] | None = None,
    start_offset: int | None = None,
    end_offset: int | None = None,
    checksum_source: str | None = None,
) -> object:
    normalized_quote = normalize_anchor_quote(quote)
    checksum = compute_anchor_checksum(
        checksum_source or normalized_quote,
        str(page_number),
        str(start_offset or ""),
        str(end_offset or ""),
    )
    return translation_schemas.SelectionAnchor(
        page=page_number,
        quote=normalized_quote,
        rects=rects or [],
        start_offset=start_offset,
        end_offset=end_offset,
        checksum=checksum,
    )


def resolve_anchor_from_text_map(
    page_text_map,
    quote: str,
) -> object:
    normalized_quote = normalize_anchor_quote(quote)
    page_text = normalize_anchor_quote(page_text_map.text_content)
    start_offset = page_text.find(normalized_quote)
    if start_offset < 0:
        raise RuntimeError("Quote could not be resolved from page text map")

    end_offset = start_offset + len(normalized_quote)
    rects = [
        translation_schemas.SelectionRect(
            page=page_text_map.page_number,
            x=span.x0,
            y=span.y0,
            width=max(span.x1 - span.x0, 0.1),
            height=max(span.y1 - span.y0, 0.1),
        )
        for span in page_text_map.spans
        if span.end_offset > start_offset and span.start_offset < end_offset
    ]
    return build_selection_anchor(
        page_number=page_text_map.page_number,
        quote=normalized_quote,
        rects=rects,
        start_offset=start_offset,
        end_offset=end_offset,
        checksum_source=page_text_map.text_content,
    )
