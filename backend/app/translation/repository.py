from __future__ import annotations

import json
import uuid
from typing import Any

from ..db import DEFAULT_WORKSPACE_ID, get_conn, utcnow
from ..repository import score_document_search_match


def normalize_workspace_id(workspace_id: str | None) -> str:
    value = str(workspace_id or DEFAULT_WORKSPACE_ID).strip()
    return value or DEFAULT_WORKSPACE_ID


def create_translation_document(
    *,
    filename: str,
    display_name: str,
    file_type: str,
    file_hash: str,
    file_path: str,
    page_count: int | None = None,
    text_layer_status: str = "pending",
    workspace_id: str = DEFAULT_WORKSPACE_ID,
) -> str:
    document_id = f"tdoc_{uuid.uuid4().hex[:12]}"
    now = utcnow()
    workspace = normalize_workspace_id(workspace_id)
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO translation_documents (
              id, workspace_id, filename, display_name, file_type, file_hash, file_path, page_count,
              text_layer_status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                document_id,
                workspace,
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


def get_translation_document_in_workspace(
    document_id: str,
    workspace_id: str | None,
) -> dict[str, Any] | None:
    workspace = normalize_workspace_id(workspace_id)
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM translation_documents WHERE id = ? AND workspace_id = ?",
            (document_id, workspace),
        ).fetchone()
        return dict(row) if row else None


def get_translation_document_by_hash(
    file_hash: str,
    workspace_id: str = DEFAULT_WORKSPACE_ID,
) -> dict[str, Any] | None:
    workspace = normalize_workspace_id(workspace_id)
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM translation_documents WHERE file_hash = ? AND workspace_id = ?",
            (file_hash, workspace),
        ).fetchone()
        return dict(row) if row else None


def list_translation_documents(
    workspace_id: str = DEFAULT_WORKSPACE_ID,
    query: str | None = None,
) -> list[dict[str, Any]]:
    workspace = normalize_workspace_id(workspace_id)
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT td.*, d.id AS source_doc_id, i.title, i.year, i.authors_json,
                   COALESCE(tp.page_text, '') AS page_text
            FROM translation_documents td
            LEFT JOIN documents d
              ON d.file_hash = td.file_hash AND d.workspace_id = td.workspace_id
            LEFT JOIN index_records i ON i.doc_id = d.id
            LEFT JOIN (
              SELECT document_id, GROUP_CONCAT(text_content, '\n') AS page_text
              FROM translation_page_text
              GROUP BY document_id
            ) tp ON tp.document_id = td.id
            WHERE td.workspace_id = ?
            ORDER BY td.created_at DESC
            """,
            (workspace,),
        ).fetchall()

    ranked: list[tuple[float, dict[str, Any]]] = []
    q = str(query or "").strip()
    for row in rows:
        authors = json.loads(row["authors_json"] or "[]")
        item = {
            "id": row["id"],
            "workspace_id": row["workspace_id"],
            "filename": row["filename"],
            "display_name": row["display_name"],
            "file_type": row["file_type"],
            "file_hash": row["file_hash"],
            "file_path": row["file_path"],
            "page_count": row["page_count"],
            "text_layer_status": row["text_layer_status"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "source_doc_id": row["source_doc_id"],
            "title": row["title"],
            "authors": authors,
            "year": row["year"],
        }
        if not q:
            ranked.append((0.0, item))
            continue

        display_name_text = str(row["display_name"] or "")
        filename_text = str(row["filename"] or "")
        title_text = str(row["title"] or "")
        corpus = "\n".join(
            [
                display_name_text,
                filename_text,
                title_text,
                " ".join([str(author) for author in authors]),
                str(row["year"] or ""),
            ]
        )
        score = score_document_search_match(
            q,
            display_name_text=display_name_text,
            original_filename_text=filename_text,
            title_text=title_text,
            corpus_text=corpus,
        )
        if score is None:
            continue
        ranked.append((score, item))

    ranked.sort(key=lambda x: (x[0], x[1]["created_at"] or ""), reverse=True)
    return [item for _, item in ranked]


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
    workspace_id: str = DEFAULT_WORKSPACE_ID,
) -> str:
    request_id = f"treq_{uuid.uuid4().hex[:12]}"
    now = utcnow()
    workspace = normalize_workspace_id(workspace_id)
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO translation_requests (
              id, workspace_id, document_id, provider, model, source_lang, target_lang, source_text,
              anchor_json, cache_key, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                request_id,
                workspace,
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


def find_completed_translation_by_cache_key(
    cache_key: str,
    workspace_id: str = DEFAULT_WORKSPACE_ID,
) -> dict[str, Any] | None:
    workspace = normalize_workspace_id(workspace_id)
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT r.*, o.translated_text, o.result_meta_json
            FROM translation_requests r
            JOIN translation_results o ON o.request_id = r.id
            WHERE r.cache_key = ? AND r.workspace_id = ? AND r.status = 'completed'
            ORDER BY r.updated_at DESC, r.created_at DESC
            LIMIT 1
            """,
            (cache_key, workspace),
        ).fetchone()
        return dict(row) if row else None


def list_translation_history(
    document_id: str,
    workspace_id: str | None = None,
) -> list[dict[str, Any]]:
    with get_conn() as conn:
        if workspace_id is None:
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
        else:
            workspace = normalize_workspace_id(workspace_id)
            rows = conn.execute(
                """
                SELECT r.id AS request_id, r.provider, r.model, r.source_text, r.target_lang,
                       r.created_at, r.updated_at, r.status, r.error_code, r.error_message,
                       o.translated_text, o.result_meta_json
                FROM translation_requests r
                LEFT JOIN translation_results o ON o.request_id = r.id
                WHERE r.document_id = ? AND r.workspace_id = ?
                ORDER BY r.created_at DESC, r.id DESC
                """,
                (document_id, workspace),
            ).fetchall()
        return [dict(row) for row in rows]
