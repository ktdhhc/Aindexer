from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Generator

from .config import DB_PATH, ensure_dirs


def utcnow() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def init_db() -> None:
    ensure_dirs()
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                filename TEXT NOT NULL,
                file_type TEXT NOT NULL,
                file_hash TEXT NOT NULL UNIQUE,
                file_path TEXT NOT NULL,
                status TEXT NOT NULL,
                stage TEXT,
                stage_message TEXT,
                cancel_requested INTEGER NOT NULL DEFAULT 0,
                error_message TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS index_records (
                doc_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
                title TEXT,
                authors_json TEXT,
                year INTEGER,
                keywords_json TEXT,
                apa_citation TEXT,
                one_liner TEXT,
                core_points_json TEXT,
                custom_fields_json TEXT,
                provider TEXT,
                model TEXT,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS claims (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                claim_text TEXT NOT NULL,
                evidence_quote TEXT NOT NULL,
                page INTEGER NOT NULL,
                section TEXT,
                paragraph_index INTEGER,
                confidence REAL
            );

            CREATE TABLE IF NOT EXISTS field_definitions (
                field_key TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                field_type TEXT NOT NULL,
                required INTEGER NOT NULL DEFAULT 0,
                enabled INTEGER NOT NULL DEFAULT 1,
                sort_order INTEGER NOT NULL DEFAULT 0,
                is_default INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS provider_configs (
                provider TEXT PRIMARY KEY,
                base_url TEXT,
                model TEXT,
                api_key_enc TEXT,
                temperature REAL,
                timeout INTEGER,
                enabled INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS index_fts USING fts5(
                doc_id UNINDEXED,
                title,
                keywords,
                apa_citation,
                one_liner,
                core_points,
                claims,
                custom_text
            );
            """
        )
        _migrate_schema(conn)
        _seed_default_fields(conn)
        _seed_default_providers(conn)


def _migrate_schema(conn: sqlite3.Connection) -> None:
    cols = {row[1] for row in conn.execute("PRAGMA table_info(documents)").fetchall()}
    if "stage" not in cols:
        conn.execute("ALTER TABLE documents ADD COLUMN stage TEXT")
    if "stage_message" not in cols:
        conn.execute("ALTER TABLE documents ADD COLUMN stage_message TEXT")
    if "cancel_requested" not in cols:
        conn.execute(
            "ALTER TABLE documents ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0"
        )
    idx_cols = {
        row[1] for row in conn.execute("PRAGMA table_info(index_records)").fetchall()
    }
    if "apa_citation" not in idx_cols:
        conn.execute("ALTER TABLE index_records ADD COLUMN apa_citation TEXT")

    fts_cols = {
        row[1] for row in conn.execute("PRAGMA table_info(index_fts)").fetchall()
    }
    if "apa_citation" not in fts_cols:
        conn.execute("DROP TABLE IF EXISTS index_fts")
        conn.execute(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS index_fts USING fts5(
                doc_id UNINDEXED,
                title,
                keywords,
                apa_citation,
                one_liner,
                core_points,
                claims,
                custom_text
            )
            """
        )

    _migrate_provider_api_keys_to_plain(conn)


def _migrate_provider_api_keys_to_plain(conn: sqlite3.Connection) -> None:
    rows = conn.execute(
        "SELECT provider, api_key_enc FROM provider_configs WHERE api_key_enc IS NOT NULL AND api_key_enc != ''"
    ).fetchall()
    if not rows:
        return

    try:
        from .security import decrypt_text
    except Exception:
        return

    for row in rows:
        provider, raw = row
        if not raw:
            continue
        try:
            plain = decrypt_text(raw)
        except Exception:
            continue
        if not plain or plain == raw:
            continue
        conn.execute(
            "UPDATE provider_configs SET api_key_enc = ?, updated_at = ? WHERE provider = ?",
            (plain, utcnow(), provider),
        )


def _seed_default_fields(conn: sqlite3.Connection) -> None:
    default_fields = [
        ("title", "标题", "text", 1, 1, 1, 1),
        ("authors", "作者", "list", 1, 1, 2, 1),
        ("year", "年份", "number", 1, 1, 3, 1),
        ("keywords", "关键词", "list", 1, 1, 4, 1),
        ("apa_citation", "APA引用", "text", 1, 1, 5, 1),
        ("one_liner", "一句话定位", "text", 1, 1, 6, 1),
        ("core_points", "核心观点", "list", 1, 1, 7, 1),
        ("claims", "重要claims", "list", 1, 1, 8, 1),
    ]
    conn.executemany(
        """
        INSERT OR IGNORE INTO field_definitions
        (field_key, label, field_type, required, enabled, sort_order, is_default)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        default_fields,
    )


def _seed_default_providers(conn: sqlite3.Connection) -> None:
    now = utcnow()
    providers = [
        ("openai", "https://api.openai.com/v1", "gpt-4.1-mini", None, 0.1, 120, 1, now),
        (
            "deepseek",
            "https://api.deepseek.com/v1",
            "deepseek-chat",
            None,
            0.1,
            120,
            1,
            now,
        ),
        (
            "glm",
            "https://open.bigmodel.cn/api/paas/v4",
            "glm-4-flash",
            None,
            0.1,
            120,
            1,
            now,
        ),
        (
            "openrouter",
            "https://openrouter.ai/api/v1",
            "openai/gpt-4o-mini",
            None,
            0.1,
            120,
            1,
            now,
        ),
    ]
    conn.executemany(
        """
        INSERT OR IGNORE INTO provider_configs
        (provider, base_url, model, api_key_enc, temperature, timeout, enabled, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        providers,
    )


@contextmanager
def get_conn() -> Generator[sqlite3.Connection, None, None]:
    ensure_dirs()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()
