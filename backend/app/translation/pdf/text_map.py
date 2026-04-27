from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(slots=True)
class PageTextSpan:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    start_offset: int
    end_offset: int


@dataclass(slots=True)
class PageTextMap:
    page_number: int
    text_content: str
    spans: list[PageTextSpan]


def build_pdf_text_map(file_path: Path) -> list[PageTextMap]:
    try:
        import fitz  # PyMuPDF
    except Exception as exc:  # pragma: no cover
        raise RuntimeError("PyMuPDF is required for translation PDF support") from exc

    pages: list[PageTextMap] = []
    try:
        with fitz.open(str(file_path)) as doc:
            page_count = int(getattr(doc, "page_count", 0) or 0)
            for page_index in range(page_count):
                page = doc.load_page(page_index)
                get_text = getattr(page, "get_text", None)
                raw_words = get_text("words") if callable(get_text) else []
                words = raw_words if isinstance(raw_words, list) else []
                pages.append(_build_page_text_map(page_index + 1, words))
    except Exception as exc:
        raise RuntimeError("Invalid PDF file") from exc

    if not pages:
        raise RuntimeError("PDF has no pages")
    if not any(page.text_content for page in pages):
        raise RuntimeError("PDF does not contain selectable text")
    return pages


def page_text_map_to_dict(page_text_map: PageTextMap) -> dict[str, object]:
    return {
        "page_number": page_text_map.page_number,
        "text_content": page_text_map.text_content,
        "spans": [asdict(span) for span in page_text_map.spans],
    }


def _build_page_text_map(page_number: int, words: list[tuple]) -> PageTextMap:
    normalized_parts: list[str] = []
    spans: list[PageTextSpan] = []
    cursor = 0
    previous_span: PageTextSpan | None = None

    for raw_word in words:
        if len(raw_word) < 5:
            continue
        x0, y0, x1, y1, text = raw_word[:5]
        token = str(text or "").strip()
        if not token:
            continue

        join_without_space = False
        if previous_span is not None and normalized_parts:
            previous_text = previous_span.text
            same_line = abs(float(y0) - previous_span.y0) <= 2.0
            if previous_text.endswith("-") and not same_line:
                normalized_parts[-1] = normalized_parts[-1][:-1]
                cursor -= 1
                previous_span = PageTextSpan(
                    text=previous_text[:-1],
                    x0=previous_span.x0,
                    y0=previous_span.y0,
                    x1=previous_span.x1,
                    y1=previous_span.y1,
                    start_offset=previous_span.start_offset,
                    end_offset=max(
                        previous_span.start_offset, previous_span.end_offset - 1
                    ),
                )
                spans[-1] = previous_span
                join_without_space = True

        if normalized_parts and not join_without_space:
            normalized_parts.append(" ")
            cursor += 1

        start_offset = cursor
        normalized_parts.append(token)
        cursor += len(token)
        span = PageTextSpan(
            text=token,
            x0=float(x0),
            y0=float(y0),
            x1=float(x1),
            y1=float(y1),
            start_offset=start_offset,
            end_offset=cursor,
        )
        spans.append(span)
        previous_span = span

    return PageTextMap(
        page_number=page_number,
        text_content="".join(normalized_parts).strip(),
        spans=spans,
    )
