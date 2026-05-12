from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
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


DEFAULT_WORKSPACE_ID = "ws_default"
DEFAULT_WORKSPACE_NAME = "默认工作区"
DEFAULT_FIELD_TEMPLATE_ID = "tpl_default"
DEFAULT_FIELD_TEMPLATE_NAME = "默认字段模板"


def utcnow() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def init_db() -> None:
    ensure_dirs()
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS workspaces (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                description TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                field_template_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                display_name TEXT,
                file_type TEXT NOT NULL,
                file_hash TEXT NOT NULL UNIQUE,
                file_path TEXT NOT NULL,
                status TEXT NOT NULL,
                stage TEXT,
                stage_message TEXT,
                cancel_requested INTEGER NOT NULL DEFAULT 0,
                index_run_id TEXT,
                index_provider TEXT,
                index_model TEXT,
                index_field_template_id TEXT,
                progress INTEGER NOT NULL DEFAULT 0,
                output_seen_tokens INTEGER NOT NULL DEFAULT 0,
                output_budget_tokens INTEGER NOT NULL DEFAULT 0,
                failure_code TEXT,
                failure_label TEXT,
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

            CREATE TABLE IF NOT EXISTS field_templates (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                description TEXT,
                is_default INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS field_template_fields (
                template_id TEXT NOT NULL REFERENCES field_templates(id) ON DELETE CASCADE,
                field_key TEXT NOT NULL,
                label TEXT NOT NULL,
                description TEXT,
                field_type TEXT NOT NULL,
                required INTEGER NOT NULL DEFAULT 0,
                enabled INTEGER NOT NULL DEFAULT 1,
                sort_order INTEGER NOT NULL DEFAULT 0,
                is_default INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY(template_id, field_key)
            );

            CREATE INDEX IF NOT EXISTS idx_field_template_fields_template
            ON field_template_fields(template_id, sort_order ASC);

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

            CREATE TABLE IF NOT EXISTS translation_documents (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                filename TEXT NOT NULL,
                display_name TEXT NOT NULL,
                file_type TEXT NOT NULL,
                file_hash TEXT NOT NULL UNIQUE,
                file_path TEXT NOT NULL,
                page_count INTEGER,
                text_layer_status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS translation_page_text (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                document_id TEXT NOT NULL REFERENCES translation_documents(id) ON DELETE CASCADE,
                page_number INTEGER NOT NULL,
                text_content TEXT NOT NULL,
                text_map_json TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(document_id, page_number)
            );

            CREATE TABLE IF NOT EXISTS translation_requests (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                document_id TEXT NOT NULL,
                provider TEXT NOT NULL,
                model TEXT NOT NULL,
                source_lang TEXT,
                target_lang TEXT NOT NULL,
                source_text TEXT NOT NULL,
                anchor_json TEXT,
                cache_key TEXT NOT NULL,
                status TEXT NOT NULL,
                error_code TEXT,
                error_message TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS translation_results (
                request_id TEXT PRIMARY KEY REFERENCES translation_requests(id) ON DELETE CASCADE,
                translated_text TEXT NOT NULL,
                result_meta_json TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_translation_requests_document_id
            ON translation_requests(document_id, created_at DESC);

            CREATE INDEX IF NOT EXISTS idx_translation_requests_cache_key
            ON translation_requests(cache_key);

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

            CREATE TABLE IF NOT EXISTS llm_usage_events (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                feature TEXT NOT NULL,
                operation TEXT NOT NULL,
                provider TEXT NOT NULL,
                model TEXT NOT NULL,
                api_key_fingerprint TEXT,
                input_tokens INTEGER,
                output_tokens INTEGER,
                total_tokens INTEGER,
                token_source TEXT NOT NULL,
                estimated INTEGER NOT NULL DEFAULT 0,
                cached INTEGER NOT NULL DEFAULT 0,
                success INTEGER NOT NULL DEFAULT 1,
                error_code TEXT,
                duration_ms REAL,
                request_id TEXT,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_llm_usage_events_created_at
            ON llm_usage_events(created_at);

            CREATE INDEX IF NOT EXISTS idx_llm_usage_events_filters
            ON llm_usage_events(workspace_id, feature, provider, model, api_key_fingerprint, created_at);

            CREATE TABLE IF NOT EXISTS llm_pricing_rules (
                id TEXT PRIMARY KEY,
                provider TEXT NOT NULL,
                model TEXT,
                api_key_fingerprint TEXT,
                input_price_per_1m REAL NOT NULL DEFAULT 0,
                output_price_per_1m REAL NOT NULL DEFAULT 0,
                currency TEXT NOT NULL DEFAULT 'USD',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_llm_pricing_rules_lookup
            ON llm_pricing_rules(provider, model, api_key_fingerprint);

            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            """
        )
        _migrate_schema(conn)
        _seed_default_workspace(conn)
        _seed_default_fields(conn)
        _seed_default_field_templates(conn)
        _seed_default_providers(conn)


def _default_document_display_name(filename: str) -> str:
    raw = str(filename or "").strip()
    if not raw:
        return ""
    stem = Path(raw).stem.strip()
    return stem or raw


def _normalize_document_display_names(conn: sqlite3.Connection) -> None:
    rows = conn.execute(
        "SELECT id, filename, COALESCE(display_name, '') AS display_name FROM documents"
    ).fetchall()
    for row in rows:
        doc_id = row[0]
        filename = str(row[1] or "")
        display_name = str(row[2] or "").strip()
        if not display_name or display_name == filename:
            normalized = _default_document_display_name(filename)
            if normalized != display_name:
                conn.execute(
                    "UPDATE documents SET display_name = ?, updated_at = ? WHERE id = ?",
                    (normalized, utcnow(), doc_id),
                )


def _migrate_schema(conn: sqlite3.Connection) -> None:
    cols = {row[1] for row in conn.execute("PRAGMA table_info(documents)").fetchall()}
    if "workspace_id" not in cols:
        conn.execute(
            f"ALTER TABLE documents ADD COLUMN workspace_id TEXT NOT NULL DEFAULT '{DEFAULT_WORKSPACE_ID}'"
        )
    if "field_template_id" not in cols:
        conn.execute(
            f"ALTER TABLE documents ADD COLUMN field_template_id TEXT NOT NULL DEFAULT '{DEFAULT_FIELD_TEMPLATE_ID}'"
        )
    conn.execute(
        "UPDATE documents SET workspace_id = ? WHERE workspace_id IS NULL OR workspace_id = ''",
        (DEFAULT_WORKSPACE_ID,),
    )
    conn.execute(
        "UPDATE documents SET field_template_id = ? WHERE field_template_id IS NULL OR field_template_id = ''",
        (DEFAULT_FIELD_TEMPLATE_ID,),
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_documents_workspace_id ON documents(workspace_id)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_documents_field_template_id ON documents(field_template_id)"
    )

    if "display_name" not in cols:
        conn.execute("ALTER TABLE documents ADD COLUMN display_name TEXT")
        conn.execute(
            "UPDATE documents SET display_name = filename WHERE display_name IS NULL OR display_name = ''"
        )
    _normalize_document_display_names(conn)
    if "stage" not in cols:
        conn.execute("ALTER TABLE documents ADD COLUMN stage TEXT")
    if "stage_message" not in cols:
        conn.execute("ALTER TABLE documents ADD COLUMN stage_message TEXT")
    if "cancel_requested" not in cols:
        conn.execute(
            "ALTER TABLE documents ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0"
        )
    if "index_run_id" not in cols:
        conn.execute("ALTER TABLE documents ADD COLUMN index_run_id TEXT")
    if "index_provider" not in cols:
        conn.execute("ALTER TABLE documents ADD COLUMN index_provider TEXT")
    if "index_model" not in cols:
        conn.execute("ALTER TABLE documents ADD COLUMN index_model TEXT")
    if "index_field_template_id" not in cols:
        conn.execute("ALTER TABLE documents ADD COLUMN index_field_template_id TEXT")
    if "progress" not in cols:
        conn.execute("ALTER TABLE documents ADD COLUMN progress INTEGER NOT NULL DEFAULT 0")
    if "output_seen_tokens" not in cols:
        conn.execute("ALTER TABLE documents ADD COLUMN output_seen_tokens INTEGER NOT NULL DEFAULT 0")
    if "output_budget_tokens" not in cols:
        conn.execute("ALTER TABLE documents ADD COLUMN output_budget_tokens INTEGER NOT NULL DEFAULT 0")
    if "failure_code" not in cols:
        conn.execute("ALTER TABLE documents ADD COLUMN failure_code TEXT")
    if "failure_label" not in cols:
        conn.execute("ALTER TABLE documents ADD COLUMN failure_label TEXT")
    if "seq_num" not in cols:
        conn.execute("ALTER TABLE documents ADD COLUMN seq_num INTEGER")
    _backfill_seq_num(conn)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_documents_seq_num ON documents(workspace_id, seq_num)"
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

    translation_doc_cols = {
        row[1]
        for row in conn.execute("PRAGMA table_info(translation_documents)").fetchall()
    }
    if "workspace_id" not in translation_doc_cols:
        conn.execute(
            f"ALTER TABLE translation_documents ADD COLUMN workspace_id TEXT NOT NULL DEFAULT '{DEFAULT_WORKSPACE_ID}'"
        )
    conn.execute(
        "UPDATE translation_documents SET workspace_id = ? WHERE workspace_id IS NULL OR workspace_id = ''",
        (DEFAULT_WORKSPACE_ID,),
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_translation_documents_workspace_id ON translation_documents(workspace_id, created_at DESC)"
    )

    translation_req_cols = {
        row[1]
        for row in conn.execute("PRAGMA table_info(translation_requests)").fetchall()
    }
    if "workspace_id" not in translation_req_cols:
        conn.execute(
            f"ALTER TABLE translation_requests ADD COLUMN workspace_id TEXT NOT NULL DEFAULT '{DEFAULT_WORKSPACE_ID}'"
        )
    conn.execute(
        "UPDATE translation_requests SET workspace_id = ? WHERE workspace_id IS NULL OR workspace_id = ''",
        (DEFAULT_WORKSPACE_ID,),
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_translation_requests_workspace_id ON translation_requests(workspace_id, created_at DESC)"
    )

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

    _migrate_document_hash_scope(conn)
    _migrate_translation_document_hash_scope(conn)
    _migrate_provider_api_keys_to_plain(conn)
    _migrate_translation_requests_fk(conn)


def _backfill_seq_num(conn: sqlite3.Connection) -> None:
    workspaces = {row[0] for row in conn.execute("SELECT DISTINCT workspace_id FROM documents WHERE seq_num IS NULL").fetchall()}
    for workspace_id in workspaces:
        existing = {row[0] for row in conn.execute(
            "SELECT seq_num FROM documents WHERE workspace_id = ? AND seq_num IS NOT NULL",
            (workspace_id,),
        ).fetchall()}
        null_docs = conn.execute(
            "SELECT id FROM documents WHERE workspace_id = ? AND seq_num IS NULL ORDER BY created_at ASC",
            (workspace_id,),
        ).fetchall()
        seq = 1
        for row in null_docs:
            while seq in existing:
                seq += 1
            conn.execute("UPDATE documents SET seq_num = ? WHERE id = ?", (seq, row[0]))
            existing.add(seq)
            seq += 1


def _migrate_document_hash_scope(conn: sqlite3.Connection) -> None:
    rows = conn.execute("SELECT id, workspace_id, file_hash FROM documents").fetchall()
    for row in rows:
        doc_id = str(row[0] or "")
        workspace_id = (
            str(row[1] or DEFAULT_WORKSPACE_ID).strip() or DEFAULT_WORKSPACE_ID
        )
        file_hash = str(row[2] or "").strip()
        if not doc_id or not file_hash:
            continue
        prefix = f"{workspace_id}:"
        if file_hash.startswith(prefix):
            continue
        scoped_hash = f"{prefix}{file_hash}"
        conn.execute(
            "UPDATE documents SET file_hash = ?, updated_at = ? WHERE id = ?",
            (scoped_hash, utcnow(), doc_id),
        )


def _migrate_translation_document_hash_scope(conn: sqlite3.Connection) -> None:
    rows = conn.execute(
        "SELECT id, workspace_id, file_hash FROM translation_documents"
    ).fetchall()
    for row in rows:
        doc_id = str(row[0] or "")
        workspace_id = (
            str(row[1] or DEFAULT_WORKSPACE_ID).strip() or DEFAULT_WORKSPACE_ID
        )
        file_hash = str(row[2] or "").strip()
        if not doc_id or not file_hash:
            continue
        prefix = f"{workspace_id}:"
        if file_hash.startswith(prefix):
            continue
        scoped_hash = f"{prefix}{file_hash}"
        conn.execute(
            "UPDATE translation_documents SET file_hash = ?, updated_at = ? WHERE id = ?",
            (scoped_hash, utcnow(), doc_id),
        )


def _seed_default_workspace(conn: sqlite3.Connection) -> None:
    now = utcnow()
    conn.execute(
        """
        INSERT OR IGNORE INTO workspaces (id, name, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            DEFAULT_WORKSPACE_ID,
            DEFAULT_WORKSPACE_NAME,
            "系统默认工作区",
            now,
            now,
        ),
    )


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
    # 清除重复 label（保留 sort_order 最小的那条）
    conn.execute("""
        DELETE FROM field_definitions WHERE rowid NOT IN (
            SELECT MIN(rowid) FROM field_definitions GROUP BY label
        )
    """)
    # 添加 label 唯一索引（如果不存在）
    try:
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_field_definitions_label ON field_definitions(label)"
        )
    except sqlite3.OperationalError:
        pass

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


def _seed_default_field_templates(conn: sqlite3.Connection) -> None:
    now = utcnow()
    conn.execute(
        """
        INSERT OR IGNORE INTO field_templates (id, name, description, is_default, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?)
        """,
        (
            DEFAULT_FIELD_TEMPLATE_ID,
            DEFAULT_FIELD_TEMPLATE_NAME,
            "系统默认字段模板",
            now,
            now,
        ),
    )

    count_row = conn.execute(
        "SELECT COUNT(*) FROM field_template_fields WHERE template_id = ?",
        (DEFAULT_FIELD_TEMPLATE_ID,),
    ).fetchone()
    if int(count_row[0] or 0) > 0:
        return

    rows = conn.execute(
        "SELECT field_key, label, description, field_type, required, enabled, sort_order, is_default FROM field_definitions ORDER BY sort_order ASC"
    ).fetchall()
    source = rows if rows else DEFAULT_FIELD_DEFINITIONS

    for item in source:
        if isinstance(item, sqlite3.Row):
            field_key = str(item["field_key"])
            label = str(item["label"])
            description = str(item["description"] or "")
            field_type = str(item["field_type"])
            required = int(item["required"] or 0)
            enabled = int(item["enabled"] or 0)
            sort_order = int(item["sort_order"] or 0)
            is_default = int(item["is_default"] or 0)
        elif isinstance(item, tuple):
            field_key = str(item[0] or "")
            label = str(item[1] or "")
            description = str(item[2] or "")
            field_type = str(item[3] or "text")
            required = int(item[4] or 0)
            enabled = int(item[5] or 0)
            sort_order = int(item[6] or 0)
            is_default = int(item[7] or 0)
        else:
            field_key = str(item["field_key"])
            label = str(item["label"])
            description = str(item["description"] or "")
            field_type = str(item["field_type"])
            required = int(item["required"])
            enabled = int(item["enabled"])
            sort_order = int(item["sort_order"])
            is_default = int(item["is_default"])

        conn.execute(
            """
            INSERT OR REPLACE INTO field_template_fields (
                template_id, field_key, label, description, field_type, required, enabled, sort_order, is_default
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                DEFAULT_FIELD_TEMPLATE_ID,
                field_key,
                label,
                description,
                field_type,
                required,
                enabled,
                sort_order,
                is_default,
            ),
        )


def _seed_default_providers(conn: sqlite3.Connection) -> None:
    now = utcnow()
    providers = [
        ("openai", "https://api.openai.com/v1", "gpt-5.4", None, 0.1, 120, 1, now),
        (
            "deepseek",
            "https://api.deepseek.com/v1",
            "deepseek-v4-flash",
            None,
            0.1,
            120,
            1,
            now,
        ),
        (
            "ali",
            "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "deepseek-v4-flash",
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


def _migrate_translation_requests_fk(conn: sqlite3.Connection) -> None:
    """Remove FK from translation_requests.document_id so workspace documents can be referenced."""
    fkeys = conn.execute("PRAGMA foreign_key_list(translation_requests)").fetchall()
    has_doc_fk = any(r[2] == "translation_documents" for r in fkeys)
    if not has_doc_fk:
        return

    conn.execute(
        "UPDATE translation_requests SET model = COALESCE(NULLIF(TRIM(model), ''), 'unknown')"
    )

    conn.execute("PRAGMA foreign_keys = OFF")

    conn.execute("DROP TABLE IF EXISTS translation_requests_new")
    conn.execute("DROP TABLE IF EXISTS translation_results_new")

    conn.execute(
        """
        CREATE TABLE translation_requests_new (
            id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            source_lang TEXT,
            target_lang TEXT NOT NULL,
            source_text TEXT NOT NULL,
            anchor_json TEXT,
            cache_key TEXT NOT NULL,
            status TEXT NOT NULL,
            error_code TEXT,
            error_message TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute("INSERT INTO translation_requests_new SELECT * FROM translation_requests")

    conn.execute(
        """
        CREATE TABLE translation_results_new (
            request_id TEXT PRIMARY KEY REFERENCES translation_requests_new(id) ON DELETE CASCADE,
            translated_text TEXT NOT NULL,
            result_meta_json TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute("INSERT INTO translation_results_new SELECT * FROM translation_results")

    conn.execute("DROP TABLE translation_results")
    conn.execute("DROP TABLE translation_requests")
    conn.execute("ALTER TABLE translation_results_new RENAME TO translation_results")
    conn.execute("ALTER TABLE translation_requests_new RENAME TO translation_requests")

    conn.execute("PRAGMA foreign_keys = ON")


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
