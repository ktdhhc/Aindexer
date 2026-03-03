from __future__ import annotations

from pathlib import Path


def parse_file(file_path: Path, file_type: str) -> str:
    if file_type == "txt":
        return file_path.read_text(encoding="utf-8", errors="ignore")
    if file_type == "docx":
        return _parse_docx(file_path)
    if file_type == "pdf":
        return _parse_pdf(file_path)
    raise ValueError(f"Unsupported file type: {file_type}")


def _parse_docx(file_path: Path) -> str:
    try:
        from docx import Document
    except Exception as exc:  # pragma: no cover
        raise RuntimeError("python-docx is required for DOCX support") from exc

    doc = Document(str(file_path))
    lines = [p.text.strip() for p in doc.paragraphs if p.text and p.text.strip()]
    return "\n".join(lines)


def _parse_pdf(file_path: Path) -> str:
    try:
        import fitz  # PyMuPDF
    except Exception:
        fitz = None

    if fitz:
        with fitz.open(str(file_path)) as doc:
            chunks = []
            for i, page in enumerate(doc):
                chunks.append(f"\n[Page {i + 1}]\n{page.get_text()}")
            return "\n".join(chunks)

    try:
        import pdfplumber
    except Exception as exc:  # pragma: no cover
        raise RuntimeError("Install PyMuPDF or pdfplumber for PDF support") from exc

    chunks = []
    with pdfplumber.open(str(file_path)) as pdf:
        for i, page in enumerate(pdf.pages):
            chunks.append(f"\n[Page {i + 1}]\n{(page.extract_text() or '').strip()}")
    return "\n".join(chunks)
