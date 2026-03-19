from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Generator

from .config import DB_PATH, ensure_dirs


DEFAULT_FIELD_DEFINITIONS = [
    {
        "field_key": "title",
        "label": "标题",
        "field_type": "text",
        "required": 1,
        "enabled": 1,
        "sort_order": 1,
        "is_default": 1,
        "description": "提取文献的完整正式标题，尽量保留原文标题写法，不要自行简写或改写。",
    },
    {
        "field_key": "authors",
        "label": "作者",
        "field_type": "list",
        "required": 1,
        "enabled": 1,
        "sort_order": 2,
        "is_default": 1,
        "description": "提取全部作者姓名，按署名顺序输出；若原文有缩写或多作者，尽量完整保留。",
    },
    {
        "field_key": "year",
        "label": "年份",
        "field_type": "number",
        "required": 1,
        "enabled": 1,
        "sort_order": 3,
        "is_default": 1,
        "description": "提取文献正式发表年份，优先使用期刊/出版信息中的四位年份。",
    },
    {
        "field_key": "keywords",
        "label": "关键词",
        "field_type": "list",
        "required": 1,
        "enabled": 1,
        "sort_order": 4,
        "is_default": 1,
        "description": "提取 3 到 8 个最核心的主题词，优先使用原文关键词，没有时可结合摘要自行归纳。",
    },
    {
        "field_key": "apa_citation",
        "label": "APA引用",
        "field_type": "text",
        "required": 1,
        "enabled": 1,
        "sort_order": 5,
        "is_default": 1,
        "description": "生成规范的 APA 参考文献格式，尽量包含作者、年份、标题、期刊或出版社等关键信息。",
    },
    {
        "field_key": "one_liner",
        "label": "一句话定位",
        "field_type": "text",
        "required": 1,
        "enabled": 1,
        "sort_order": 6,
        "is_default": 1,
        "description": "用一句中文概括这篇文献最重要的研究问题、方法或结论，适合作为快速识别摘要。",
    },
    {
        "field_key": "core_points",
        "label": "核心观点",
        "field_type": "list",
        "required": 1,
        "enabled": 1,
        "sort_order": 7,
        "is_default": 1,
        "description": "提炼 3 到 5 条最重要的核心观点或结论，每条尽量简洁明确，避免泛泛而谈。",
    },
    {
        "field_key": "claims",
        "label": "重要claims",
        "field_type": "list",
        "required": 1,
        "enabled": 1,
        "sort_order": 8,
        "is_default": 1,
        "description": "提取文中关键论断，并尽量给出对应原文证据与页码，优先选择可被直接引用的具体表述。",
    },
]


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
                display_name TEXT,
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
                description TEXT,
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
    if "display_name" not in cols:
        conn.execute("ALTER TABLE documents ADD COLUMN display_name TEXT")
        conn.execute(
            "UPDATE documents SET display_name = filename WHERE display_name IS NULL OR display_name = ''"
        )
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

    field_cols = {
        row[1]
        for row in conn.execute("PRAGMA table_info(field_definitions)").fetchall()
    }
    if "description" not in field_cols:
        conn.execute("ALTER TABLE field_definitions ADD COLUMN description TEXT")

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
    conn.executemany(
        """
        INSERT OR IGNORE INTO field_definitions
        (field_key, label, description, field_type, required, enabled, sort_order, is_default)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                item["field_key"],
                item["label"],
                item["description"],
                item["field_type"],
                item["required"],
                item["enabled"],
                item["sort_order"],
                item["is_default"],
            )
            for item in DEFAULT_FIELD_DEFINITIONS
        ],
    )
    for item in DEFAULT_FIELD_DEFINITIONS:
        conn.execute(
            "UPDATE field_definitions SET description = ? WHERE field_key = ? AND (description IS NULL OR description = '')",
            (item["description"], item["field_key"]),
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
