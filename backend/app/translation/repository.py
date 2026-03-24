from __future__ import annotations

import json
import uuid
from typing import Any

from ..db import get_conn, utcnow


def create_translation_document(
    *,
    filename: str,
    display_name: str,
    file_type: str,
    file_hash: str,
    file_path: str,
    page_count: int | None = None,
    text_layer_status: str = "pending",
) -> str:
    document_id = f"tdoc_{uuid.uuid4().hex[:12]}"
    now = utcnow()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO translation_documents (
              id, filename, display_name, file_type, file_hash, file_path, page_count,
              text_layer_status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                document_id,
                filename,
                display_name,
                file_type,
                file_hash,
                file_path,
                page_count,
                text_layer_status,
                now,
                now,
            ),
        )
    return document_id


def get_translation_document(document_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM translation_documents WHERE id = ?", (document_id,)
        ).fetchone()
        return dict(row) if row else None


def get_translation_document_by_hash(file_hash: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM translation_documents WHERE file_hash = ?", (file_hash,)
        ).fetchone()
        return dict(row) if row else None


def list_translation_documents() -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM translation_documents ORDER BY created_at DESC"
        ).fetchall()
        return [dict(row) for row in rows]


def upsert_translation_page_text(
    *,
    document_id: str,
    page_number: int,
    text_content: str,
    text_map: dict[str, Any] | None = None,
) -> None:
    now = utcnow()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO translation_page_text (
              document_id, page_number, text_content, text_map_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(document_id, page_number) DO UPDATE SET
              text_content=excluded.text_content,
              text_map_json=excluded.text_map_json,
              updated_at=excluded.updated_at
            """,
            (
                document_id,
                page_number,
                text_content,
                json.dumps(text_map, ensure_ascii=False)
                if text_map is not None
                else None,
                now,
                now,
            ),
        )


def list_translation_page_text(document_id: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM translation_page_text WHERE document_id = ? ORDER BY page_number",
            (document_id,),
        ).fetchall()
        return [dict(row) for row in rows]


def create_translation_request(
    *,
    document_id: str,
    provider: str,
    model: str,
    target_lang: str,
    source_text: str,
    cache_key: str,
    source_lang: str | None = None,
    anchor: dict[str, Any] | None = None,
    status: str = "pending",
) -> str:
    request_id = f"treq_{uuid.uuid4().hex[:12]}"
    now = utcnow()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO translation_requests (
              id, document_id, provider, model, source_lang, target_lang, source_text,
              anchor_json, cache_key, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                request_id,
                document_id,
                provider,
                model,
                source_lang,
                target_lang,
                source_text,
                json.dumps(anchor, ensure_ascii=False) if anchor is not None else None,
                cache_key,
                status,
                now,
                now,
            ),
        )
    return request_id


def save_translation_result(
    *,
    request_id: str,
    translated_text: str,
    result_meta: dict[str, Any] | None = None,
    status: str = "completed",
) -> None:
    now = utcnow()
    with get_conn() as conn:
        conn.execute(
            "UPDATE translation_requests SET status = ?, updated_at = ? WHERE id = ?",
            (status, now, request_id),
        )
        conn.execute(
            """
            INSERT INTO translation_results (request_id, translated_text, result_meta_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(request_id) DO UPDATE SET
              translated_text=excluded.translated_text,
              result_meta_json=excluded.result_meta_json,
              updated_at=excluded.updated_at
            """,
            (
                request_id,
                translated_text,
                json.dumps(result_meta, ensure_ascii=False)
                if result_meta is not None
                else None,
                now,
                now,
            ),
        )


def save_translation_failure(
    *,
    request_id: str,
    error_code: str,
    error_message: str,
    status: str = "failed",
) -> None:
    now = utcnow()
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE translation_requests
            SET status = ?, error_code = ?, error_message = ?, updated_at = ?
            WHERE id = ?
            """,
            (status, error_code, error_message, now, request_id),
        )


def get_translation_request(request_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM translation_requests WHERE id = ?", (request_id,)
        ).fetchone()
        return dict(row) if row else None


def get_translation_result(request_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM translation_results WHERE request_id = ?", (request_id,)
        ).fetchone()
        return dict(row) if row else None


def find_completed_translation_by_cache_key(cache_key: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT r.*, o.translated_text, o.result_meta_json
            FROM translation_requests r
            JOIN translation_results o ON o.request_id = r.id
            WHERE r.cache_key = ? AND r.status = 'completed'
            ORDER BY r.updated_at DESC, r.created_at DESC
            LIMIT 1
            """,
            (cache_key,),
        ).fetchone()
        return dict(row) if row else None


def list_translation_history(document_id: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT r.id AS request_id, r.provider, r.model, r.source_text, r.target_lang,
                   r.created_at, r.updated_at, r.status, r.error_code, r.error_message,
                   o.translated_text, o.result_meta_json
            FROM translation_requests r
            LEFT JOIN translation_results o ON o.request_id = r.id
            WHERE r.document_id = ?
            ORDER BY r.created_at DESC, r.id DESC
            """,
            (document_id,),
        ).fetchall()
        return [dict(row) for row in rows]
