from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from ..schemas import IndexRecordOut


def render_markdown(doc_id: str, record: IndexRecordOut) -> str:
    claims_lines = []
    for idx, claim in enumerate(record.claims, start=1):
        claims_lines.append(f"{idx}. {claim.claim_text}")
        claims_lines.append(f"   - 原文证据：{claim.evidence_quote}")
        claims_lines.append(f"   - 页码：{claim.page}")

    custom_lines = []
    for k, v in record.custom_fields.items():
        custom_lines.append(f"- {k}: {v}")
    if not custom_lines:
        custom_lines = ["- (无)"]

    text = "\n".join(
        [
            "---",
            f"id: {doc_id}",
            f"title: {record.title}",
            f"authors: {record.authors}",
            f"year: {record.year}",
            f"keywords: {record.keywords}",
            f"provider: {record.provider or ''}",
            f"model: {record.model or ''}",
            "---",
            "",
            "# APA 引用",
            record.apa_citation,
            "",
            "# 一句话定位",
            record.one_liner,
            "",
            "# 核心观点",
            *[f"- {x}" for x in record.core_points],
            "",
            "# 重要 Claims（含页码）",
            *claims_lines,
            "",
            "# 自定义字段",
            *custom_lines,
            "",
        ]
    )
    return text


def write_markdown(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        tmp_path.write_text(content, encoding="utf-8")
        tmp_path.replace(path)
    except Exception:
        try:
            tmp_path.unlink()
        except FileNotFoundError:
            pass
        raise
