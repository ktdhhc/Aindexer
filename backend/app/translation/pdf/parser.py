from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(slots=True)
class ParsedTranslationPdf:
    page_count: int
    pages: list[str]


def parse_translation_pdf(file_path: Path) -> ParsedTranslationPdf:
    try:
        import fitz  # PyMuPDF
    except Exception as exc:  # pragma: no cover
        raise RuntimeError("PyMuPDF is required for translation PDF support") from exc

    pages: list[str] = []
    try:
        with fitz.open(str(file_path)) as doc:
            for page in doc:
                get_text = getattr(page, "get_text", None)
                page_text = get_text() if callable(get_text) else ""
                pages.append(str(page_text or "").strip())
    except Exception as exc:
        raise RuntimeError("Invalid PDF file") from exc

    if not pages:
        raise RuntimeError("PDF has no pages")
    if not any(page for page in pages):
        raise RuntimeError("PDF does not contain selectable text")

    return ParsedTranslationPdf(page_count=len(pages), pages=pages)
