from __future__ import annotations

import importlib
from pathlib import Path

import fitz
import pytest

translation_anchors = importlib.import_module("app.translation.pdf.anchors")
translation_parser = importlib.import_module("app.translation.pdf.parser")
translation_text_map = importlib.import_module("app.translation.pdf.text_map")


def _write_multiline_pdf(file_path: Path) -> None:
    doc = fitz.open()
    page = getattr(doc, "new_page")()
    insert_text = getattr(page, "insert_text")
    insert_text((72, 72), "transformer models improve translation quality")
    insert_text((72, 96), "multi-")
    insert_text((72, 120), "line anchors remain stable")
    doc.save(str(file_path))


def _write_scan_like_pdf(file_path: Path) -> None:
    doc = fitz.open()
    getattr(doc, "new_page")()
    doc.save(str(file_path))


def test_pdf_text_map_handles_multiline_and_hyphenation(tmp_path: Path) -> None:
    pdf_path = tmp_path / "sample_multiline.pdf"
    _write_multiline_pdf(pdf_path)

    parsed = translation_parser.parse_translation_pdf(pdf_path)
    page_maps = translation_text_map.build_pdf_text_map(pdf_path)
    page_map = page_maps[0]
    page_map_dict = translation_text_map.page_text_map_to_dict(page_map)
    anchor = translation_anchors.resolve_anchor_from_text_map(
        page_map, "multiline anchors remain stable"
    )

    assert parsed.page_count == 1
    assert "transformer models improve translation quality" in parsed.pages[0]
    assert (
        "multiline anchors remain stable"
        in translation_anchors.normalize_anchor_quote(page_map.text_content)
    )
    assert page_map_dict["page_number"] == 1
    assert page_map_dict["spans"]
    assert anchor.page == 1
    assert anchor.start_offset is not None
    assert anchor.end_offset is not None
    assert anchor.end_offset > anchor.start_offset
    assert anchor.rects


def test_pdf_text_map_rejects_scan_like_pdf(tmp_path: Path) -> None:
    pdf_path = tmp_path / "sample_scan_stub.pdf"
    _write_scan_like_pdf(pdf_path)

    with pytest.raises(RuntimeError, match="selectable text"):
        translation_parser.parse_translation_pdf(pdf_path)

    with pytest.raises(RuntimeError, match="selectable text"):
        translation_text_map.build_pdf_text_map(pdf_path)
