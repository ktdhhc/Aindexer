from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import uuid
from difflib import SequenceMatcher
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from .config import INDEX_DIR
from .db import DEFAULT_FIELD_DEFINITIONS, get_conn, utcnow
from .schemas import ClaimItem, IndexRecordIn, IndexRecordOut, ProviderConfigOut


def hash_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def create_document(
    filename: str, file_type: str, file_hash: str, file_path: str
) -> str:
    doc_id = f"doc_{uuid.uuid4().hex[:12]}"
    now = utcnow()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO documents (
              id, filename, display_name, file_type, file_hash, file_path, status, stage, stage_message, cancel_requested, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, 'uploaded', 'uploaded', '文件上传完成，等待生成索引', 0, ?, ?)
            """,
            (doc_id, filename, filename, file_type, file_hash, file_path, now, now),
        )
    return doc_id


def get_document_by_hash(file_hash: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM documents WHERE file_hash = ?", (file_hash,)
        ).fetchone()
        return dict(row) if row else None


def set_document_status(
    doc_id: str, status: str, error_message: str | None = None
) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE documents SET status = ?, error_message = ?, updated_at = ? WHERE id = ?",
            (status, error_message, utcnow(), doc_id),
        )


def set_cancel_requested(doc_id: str, requested: bool) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE documents SET cancel_requested = ?, updated_at = ? WHERE id = ?",
            (1 if requested else 0, utcnow(), doc_id),
        )


def is_cancel_requested(doc_id: str) -> bool:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT cancel_requested FROM documents WHERE id = ?", (doc_id,)
        ).fetchone()
        if not row:
            return False
        return bool(row["cancel_requested"])


def set_document_stage(
    doc_id: str, stage: str, stage_message: str | None = None
) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE documents SET stage = ?, stage_message = ?, updated_at = ? WHERE id = ?",
            (stage, stage_message, utcnow(), doc_id),
        )


def get_document(doc_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
        return dict(row) if row else None


def save_index(
    doc_id: str, record: IndexRecordIn, provider: str | None, model: str | None
) -> None:
    now = utcnow()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO index_records (
              doc_id, title, authors_json, year, keywords_json, apa_citation, one_liner,
              core_points_json, custom_fields_json, provider, model, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(doc_id) DO UPDATE SET
              title=excluded.title,
              authors_json=excluded.authors_json,
              year=excluded.year,
              keywords_json=excluded.keywords_json,
              apa_citation=excluded.apa_citation,
              one_liner=excluded.one_liner,
              core_points_json=excluded.core_points_json,
              custom_fields_json=excluded.custom_fields_json,
              provider=excluded.provider,
              model=excluded.model,
              updated_at=excluded.updated_at
            """,
            (
                doc_id,
                record.title,
                json.dumps(record.authors, ensure_ascii=False),
                record.year,
                json.dumps(record.keywords, ensure_ascii=False),
                record.apa_citation,
                record.one_liner,
                json.dumps(record.core_points, ensure_ascii=False),
                json.dumps(record.custom_fields, ensure_ascii=False),
                provider,
                model,
                now,
            ),
        )
        conn.execute("DELETE FROM claims WHERE doc_id = ?", (doc_id,))
        for claim in record.claims:
            conn.execute(
                """
                INSERT INTO claims (doc_id, claim_text, evidence_quote, page, section, paragraph_index, confidence)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    doc_id,
                    claim.claim_text,
                    claim.evidence_quote,
                    claim.page,
                    claim.section,
                    claim.paragraph_index,
                    claim.confidence,
                ),
            )
        _update_fts(conn, doc_id, record)


def _update_fts(conn: Any, doc_id: str, record: IndexRecordIn) -> None:
    claims_text = "\n".join(
        [f"{c.claim_text}\n{c.evidence_quote}" for c in record.claims]
    )
    custom_text = "\n".join([f"{k}:{v}" for k, v in record.custom_fields.items()])
    conn.execute("DELETE FROM index_fts WHERE doc_id = ?", (doc_id,))
    conn.execute(
        """
        INSERT INTO index_fts (doc_id, title, keywords, apa_citation, one_liner, core_points, claims, custom_text)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            doc_id,
            record.title,
            " ".join(record.keywords),
            record.apa_citation,
            record.one_liner,
            "\n".join(record.core_points),
            claims_text,
            custom_text,
        ),
    )


def get_index(doc_id: str) -> IndexRecordOut | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM index_records WHERE doc_id = ?", (doc_id,)
        ).fetchone()
        if not row:
            return None
        claims_rows = conn.execute(
            "SELECT * FROM claims WHERE doc_id = ? ORDER BY id", (doc_id,)
        ).fetchall()
    claims = [
        ClaimItem(
            claim_text=r["claim_text"],
            evidence_quote=r["evidence_quote"],
            page=r["page"],
            section=r["section"],
            paragraph_index=r["paragraph_index"],
        )
        for r in claims_rows
    ]
    return IndexRecordOut(
        doc_id=doc_id,
        title=row["title"] or "",
        authors=json.loads(row["authors_json"] or "[]"),
        year=row["year"] or 0,
        keywords=json.loads(row["keywords_json"] or "[]"),
        apa_citation=row["apa_citation"] or "",
        one_liner=row["one_liner"] or "",
        core_points=json.loads(row["core_points_json"] or "[]"),
        claims=claims,
        custom_fields=json.loads(row["custom_fields_json"] or "{}"),
        provider=row["provider"],
        model=row["model"],
        updated_at=row["updated_at"],
    )


def get_first_indexed_document() -> dict[str, Any] | None:
    with get_conn() as conn:
        try:
            row = conn.execute(
                "SELECT id, filename, COALESCE(display_name, filename) AS display_name, status FROM documents WHERE status = 'indexed' ORDER BY updated_at DESC, created_at DESC LIMIT 1"
            ).fetchone()
        except sqlite3.OperationalError:
            row = conn.execute(
                "SELECT id, filename, status FROM documents WHERE status = 'indexed' ORDER BY updated_at DESC, created_at DESC LIMIT 1"
            ).fetchone()
            if not row:
                return None
            data = dict(row)
            data["display_name"] = data.get("filename") or ""
            return data
        return dict(row) if row else None


def list_documents() -> list[dict[str, Any]]:
    with get_conn() as conn:
        _recover_stale_parsing(conn)
        rows = conn.execute(
            "SELECT id, filename, COALESCE(display_name, filename) AS display_name, file_type, status, stage, stage_message, cancel_requested, error_message, created_at, updated_at FROM documents ORDER BY created_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]


def update_document_display_name(
    doc_id: str, display_name: str
) -> dict[str, Any] | None:
    cleaned = str(display_name or "").strip()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, filename FROM documents WHERE id = ?", (doc_id,)
        ).fetchone()
        if not row:
            return None
        next_name = cleaned or str(row["filename"] or "")
        conn.execute(
            "UPDATE documents SET display_name = ?, updated_at = ? WHERE id = ?",
            (next_name, utcnow(), doc_id),
        )
        updated = conn.execute(
            "SELECT id, filename, COALESCE(display_name, filename) AS display_name, status, updated_at FROM documents WHERE id = ?",
            (doc_id,),
        ).fetchone()
        return dict(updated) if updated else None


def update_index_editor_fields(
    doc_id: str,
    *,
    display_name: str,
    year: int | None,
    generated_at: str | None,
) -> bool:
    cleaned_name = str(display_name or "").strip()
    with get_conn() as conn:
        doc_row = conn.execute(
            "SELECT id, filename FROM documents WHERE id = ?", (doc_id,)
        ).fetchone()
        index_row = conn.execute(
            "SELECT doc_id FROM index_records WHERE doc_id = ?", (doc_id,)
        ).fetchone()
        if not doc_row or not index_row:
            return False

        next_name = cleaned_name or str(doc_row["filename"] or "")
        next_year = int(year or 0) if year else None
        next_generated_at = str(generated_at or "").strip() or utcnow()

        conn.execute(
            "UPDATE documents SET display_name = ?, updated_at = ? WHERE id = ?",
            (next_name, utcnow(), doc_id),
        )
        conn.execute(
            "UPDATE index_records SET year = ?, updated_at = ? WHERE doc_id = ?",
            (next_year, next_generated_at, doc_id),
        )
        return True


def _recover_stale_parsing(conn: Any) -> None:
    rows = conn.execute(
        "SELECT id, updated_at FROM documents WHERE status = 'parsing'"
    ).fetchall()
    now = datetime.now(UTC)
    for r in rows:
        try:
            updated = datetime.fromisoformat(r["updated_at"].replace("Z", "+00:00"))
        except Exception:
            continue
        if now - updated > timedelta(minutes=8):
            conn.execute(
                "UPDATE documents SET status='needs_review', stage='failed', stage_message='任务可能中断，请重试', error_message='索引任务超时未完成，可能进程被中断', updated_at=? WHERE id=?",
                (utcnow(), r["id"]),
            )


def delete_document(doc_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
        if not row:
            return None
        conn.execute("DELETE FROM index_fts WHERE doc_id = ?", (doc_id,))
        conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
        return dict(row)


def reset_index_content(doc_id: str) -> bool:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id FROM documents WHERE id = ?", (doc_id,)
        ).fetchone()
        if not row:
            return False
        conn.execute("DELETE FROM claims WHERE doc_id = ?", (doc_id,))
        conn.execute("DELETE FROM index_records WHERE doc_id = ?", (doc_id,))
        conn.execute("DELETE FROM index_fts WHERE doc_id = ?", (doc_id,))
        conn.execute(
            "UPDATE documents SET status='uploaded', stage='uploaded', stage_message='已清空索引，等待重新生成', error_message=NULL, cancel_requested=0, updated_at=? WHERE id=?",
            (utcnow(), doc_id),
        )
        return True


def search_documents(
    query: str | None,
    year_from: int | None,
    year_to: int | None,
    author: str | None,
    keyword: str | None,
    status: str | None,
) -> list[dict[str, Any]]:
    with get_conn() as conn:
        sql = (
            "SELECT d.id, d.filename, d.status, "
            "COALESCE(d.display_name, d.filename) AS display_name, "
            "COALESCE(i.updated_at, d.created_at) AS sort_time, "
            "i.title, i.year, i.authors_json, i.keywords_json, i.apa_citation, i.one_liner, i.core_points_json, i.custom_fields_json "
            "FROM documents d LEFT JOIN index_records i ON i.doc_id = d.id "
            "WHERE 1=1"
        )
        params: list[Any] = []
        if status:
            sql += " AND d.status = ?"
            params.append(status)
        if year_from is not None:
            sql += " AND i.year >= ?"
            params.append(year_from)
        if year_to is not None:
            sql += " AND i.year <= ?"
            params.append(year_to)
        if author:
            sql += " AND i.authors_json LIKE ?"
            params.append(f"%{author}%")
        if keyword:
            sql += " AND i.keywords_json LIKE ?"
            params.append(f"%{keyword}%")
        sql += " ORDER BY COALESCE(i.updated_at, d.created_at) DESC"
        rows = conn.execute(sql, tuple(params)).fetchall()
    ranked: list[tuple[float, dict[str, Any]]] = []
    q = (query or "").strip()
    q_lower = q.lower()
    q_terms = _extract_search_terms(q_lower)

    for r in rows:
        authors = json.loads(r["authors_json"] or "[]")
        keywords = json.loads(r["keywords_json"] or "[]")
        core_points = json.loads(r["core_points_json"] or "[]")
        custom_fields = json.loads(r["custom_fields_json"] or "{}")

        item = {
            "doc_id": r["id"],
            "filename": r["filename"],
            "display_name": r["display_name"],
            "status": r["status"],
            "created_at": r["sort_time"],
            "title": r["title"],
            "year": r["year"],
            "authors": authors,
            "keywords": keywords,
        }

        if not q:
            ranked.append((0.0, item))
            continue

        markdown_text = ""
        md_path = INDEX_DIR / f"{r['id']}.md"
        if md_path.exists():
            try:
                markdown_text = md_path.read_text(encoding="utf-8")
            except Exception:
                markdown_text = ""

        display_name_text = str(r["display_name"] or "")
        original_filename_text = str(r["filename"] or "")
        filename_text = display_name_text or original_filename_text
        title_text = str(r["title"] or "")
        corpus = "\n".join(
            [
                display_name_text,
                original_filename_text,
                filename_text,
                title_text,
                " ".join([str(x) for x in authors]),
                " ".join([str(x) for x in keywords]),
                str(r["apa_citation"] or ""),
                str(r["one_liner"] or ""),
                "\n".join([str(x) for x in core_points]),
                json.dumps(custom_fields, ensure_ascii=False),
                markdown_text,
            ]
        )
        corpus_lower = corpus.lower()

        exact_hit = q_lower in corpus_lower
        filename_exact_hit = (
            q_lower in filename_text.lower()
            or q_lower in original_filename_text.lower()
        )
        term_hits = sum(1 for t in q_terms if t in corpus_lower) if q_terms else 0
        display_ratio = (
            SequenceMatcher(None, q_lower, display_name_text.lower()).ratio()
            if display_name_text
            else 0.0
        )
        original_ratio = (
            SequenceMatcher(None, q_lower, original_filename_text.lower()).ratio()
            if original_filename_text
            else 0.0
        )
        filename_ratio = max(
            display_ratio,
            original_ratio,
            SequenceMatcher(None, q_lower, filename_text.lower()).ratio(),
        )
        title_ratio = SequenceMatcher(None, q_lower, title_text.lower()).ratio()
        corpus_ratio = SequenceMatcher(None, q_lower, corpus_lower[:5000]).ratio()
        fuzzy_ratio = max(filename_ratio, title_ratio, corpus_ratio)

        matched = exact_hit or term_hits > 0 or fuzzy_ratio >= 0.42
        if not matched:
            continue

        score = (
            (1000.0 if exact_hit else 0.0)
            + (300.0 if filename_exact_hit else 0.0)
            + float(term_hits) * 12.0
            + fuzzy_ratio * 10.0
        )
        ranked.append((score, item))

    ranked.sort(key=lambda x: (x[0], x[1]["created_at"] or ""), reverse=True)
    return [x[1] for x in ranked]


def _extract_search_terms(text: str) -> list[str]:
    return [t for t in re.findall(r"[\w\u4e00-\u9fff]+", text or "") if t]


def get_fields() -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM field_definitions ORDER BY sort_order ASC"
        ).fetchall()
        return [dict(r) for r in rows]


def save_fields(items: list[dict[str, Any]]) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM field_definitions")
        for item in items:
            label = str(item.get("label") or item.get("field_key") or "").strip()
            if not label:
                continue
            field_key = str(item.get("field_key") or label).strip() or label
            description = str(item.get("description") or "").strip()
            conn.execute(
                """
                INSERT INTO field_definitions (field_key, label, description, field_type, required, enabled, sort_order, is_default)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    field_key,
                    label,
                    description,
                    item.get("field_type") or "text",
                    1 if item.get("required") else 0,
                    1 if item.get("enabled", True) else 0,
                    item.get("sort_order", 0),
                    1 if item.get("is_default") else 0,
                ),
            )


def reset_fields_to_defaults() -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM field_definitions")
        for item in DEFAULT_FIELD_DEFINITIONS:
            conn.execute(
                """
                INSERT INTO field_definitions (field_key, label, description, field_type, required, enabled, sort_order, is_default)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item["field_key"],
                    item["label"],
                    item["description"],
                    item["field_type"],
                    item["required"],
                    item["enabled"],
                    item["sort_order"],
                    item["is_default"],
                ),
            )


def delete_field(field_key: str) -> bool:
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM field_definitions WHERE field_key = ?",
            (field_key,),
        )
    return (cur.rowcount or 0) > 0


def get_provider_configs() -> list[ProviderConfigOut]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM provider_configs ORDER BY provider ASC"
        ).fetchall()
    return [
        ProviderConfigOut(
            provider=r["provider"],
            base_url=r["base_url"],
            model=r["model"],
            has_api_key=bool(r["api_key_enc"]),
            temperature=r["temperature"] if r["temperature"] is not None else 0.1,
            timeout=r["timeout"] if r["timeout"] is not None else 120,
            enabled=bool(r["enabled"]),
        )
        for r in rows
    ]


def get_provider_config_raw(provider: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM provider_configs WHERE provider = ?", (provider,)
        ).fetchone()
        return dict(row) if row else None


def save_provider_config(
    provider: str,
    base_url: str | None,
    model: str | None,
    api_key_enc: str | None,
    temperature: float,
    timeout: int,
    enabled: bool,
) -> None:
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT api_key_enc FROM provider_configs WHERE provider = ?", (provider,)
        ).fetchone()
        api_value = (
            api_key_enc
            if api_key_enc is not None
            else (existing["api_key_enc"] if existing else None)
        )
        conn.execute(
            """
            INSERT INTO provider_configs (provider, base_url, model, api_key_enc, temperature, timeout, enabled, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(provider) DO UPDATE SET
              base_url=excluded.base_url,
              model=excluded.model,
              api_key_enc=excluded.api_key_enc,
              temperature=excluded.temperature,
              timeout=excluded.timeout,
              enabled=excluded.enabled,
              updated_at=excluded.updated_at
            """,
            (
                provider,
                base_url,
                model,
                api_value,
                temperature,
                timeout,
                1 if enabled else 0,
                utcnow(),
            ),
        )


def delete_provider_config(provider: str) -> bool:
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM provider_configs WHERE provider = ?",
            (provider,),
        )
    return (cur.rowcount or 0) > 0


def reset_provider_configs_to_defaults() -> None:
    now = utcnow()
    defaults = [
        ("openai", "https://api.openai.com/v1", "gpt-4.1-mini", 0.1, 120, 1, now),
        (
            "deepseek",
            "https://api.deepseek.com/v1",
            "deepseek-chat",
            0.1,
            120,
            1,
            now,
        ),
        (
            "glm",
            "https://open.bigmodel.cn/api/paas/v4",
            "glm-4-flash",
            0.1,
            120,
            1,
            now,
        ),
        (
            "openrouter",
            "https://openrouter.ai/api/v1",
            "openai/gpt-4o-mini",
            0.1,
            120,
            1,
            now,
        ),
    ]
    names = tuple(x[0] for x in defaults)
    placeholders = ",".join(["?"] * len(names))
    with get_conn() as conn:
        conn.execute(
            f"DELETE FROM provider_configs WHERE provider NOT IN ({placeholders})",
            names,
        )
        for item in defaults:
            conn.execute(
                """
                INSERT INTO provider_configs (provider, base_url, model, api_key_enc, temperature, timeout, enabled, updated_at)
                VALUES (?, ?, ?, NULL, ?, ?, ?, ?)
                ON CONFLICT(provider) DO UPDATE SET
                  base_url=excluded.base_url,
                  model=excluded.model,
                  api_key_enc=NULL,
                  temperature=excluded.temperature,
                  timeout=excluded.timeout,
                  enabled=excluded.enabled,
                  updated_at=excluded.updated_at
                """,
                item,
            )


def markdown_path(doc_id: str) -> Path:
    return INDEX_DIR / f"{doc_id}.md"
