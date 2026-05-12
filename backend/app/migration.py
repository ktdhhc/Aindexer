from __future__ import annotations

import json
import logging
import shutil
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .config import BASE_DIR, DATA_DIR, DB_PATH, EXPORT_DIR, INDEX_DIR, LOG_DIR, UPLOAD_DIR, ensure_dirs
from .translation.config import TRANSLATION_UPLOAD_DIR, ensure_translation_dirs

logger = logging.getLogger(__name__)

MIGRATION_KEY = "data_root_migration_v1"


def _score_data_root(root: Path) -> int:
    score = 0
    db_path = root / "app.db"
    if db_path.exists():
        try:
            conn = sqlite3.connect(str(db_path))
            conn.row_factory = sqlite3.Row
            doc_count = conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0] or 0
            ws_count = conn.execute("SELECT COUNT(*) FROM workspaces").fetchone()[0] or 0
            provider_count = conn.execute("SELECT COUNT(*) FROM provider_configs").fetchone()[0] or 0
            providers_with_keys = (
                conn.execute(
                    "SELECT COUNT(*) FROM provider_configs WHERE api_key_enc IS NOT NULL AND api_key_enc != ''"
                ).fetchone()[0]
                or 0
            )
            conn.close()
            score += doc_count * 10
            score += ws_count * 5
            score += provider_count * 2
            score += providers_with_keys * 4
        except Exception:
            pass

    for subdir in ["uploads", "indexes"]:
        subpath = root / subdir
        if subpath.exists():
            try:
                file_count = sum(1 for _ in subpath.rglob("*") if _.is_file())
                score += file_count
            except Exception:
                pass

    translation_uploads = root / "translation" / "uploads"
    if translation_uploads.exists():
        try:
            file_count = sum(1 for _ in translation_uploads.rglob("*") if _.is_file())
            score += file_count
        except Exception:
            pass

    return score


def _has_migration_marker() -> bool:
    if not DB_PATH.exists():
        return False
    try:
        conn = sqlite3.connect(str(DB_PATH))
        row = conn.execute(
            "SELECT value FROM app_settings WHERE key = ?", (MIGRATION_KEY,)
        ).fetchone()
        conn.close()
        return row is not None
    except Exception:
        return False


def _write_migration_marker(source_dir: str, summary: dict[str, Any]) -> None:
    marker = {
        "version": 1,
        "source_dir": source_dir,
        "migrated_at": datetime.now(UTC).isoformat(),
        "summary": summary,
    }
    marker_json = json.dumps(marker, ensure_ascii=False)
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)",
        (MIGRATION_KEY, marker_json, datetime.now(UTC).isoformat()),
    )
    conn.commit()
    conn.close()


def _copy_db_safe(source: Path, target: Path) -> None:
    for suffix in ["", "-wal", "-shm"]:
        src = Path(str(source) + suffix)
        dst = Path(str(target) + suffix)
        if src.exists():
            shutil.copy2(str(src), str(dst))


def _copy_tree_merge(source_dir: Path, target_dir: Path) -> None:
    if not source_dir.exists():
        return
    if target_dir.exists():
        shutil.rmtree(str(target_dir), ignore_errors=True)
    target_dir.mkdir(parents=True, exist_ok=True)
    for item in source_dir.iterdir():
        dest = target_dir / item.name
        if item.is_dir():
            shutil.copytree(str(item), str(dest), dirs_exist_ok=True)
        else:
            shutil.copy2(str(item), str(dest))


def run_data_root_migration() -> bool:
    old_root = (BASE_DIR / "data").resolve()
    current_root = DATA_DIR.resolve()

    if current_root == old_root:
        return False

    if _has_migration_marker():
        logger.info("Data root migration already completed, skipping.")
        return False

    ensure_dirs()
    ensure_translation_dirs()

    if not old_root.exists():
        logger.info("Old data root %s does not exist, skipping migration.", old_root)
        return False

    current_score = _score_data_root(current_root)
    old_score = _score_data_root(old_root)

    logger.info(
        "Migration check: current=%s (score=%d) | old=%s (score=%d)",
        current_root, current_score, old_root, old_score,
    )

    if old_score <= current_score:
        logger.info("Current data root is more complete, skipping migration.")
        return False

    logger.info("Migrating data from %s to %s ...", old_root, current_root)

    _copy_db_safe(old_root / "app.db", DB_PATH)

    dirs_to_migrate: list[tuple[Path, Path]] = [
        (old_root / "uploads", UPLOAD_DIR),
        (old_root / "indexes", INDEX_DIR),
        (old_root / "exports", EXPORT_DIR),
        (old_root / "logs", LOG_DIR),
    ]

    translation_old = old_root / "translation" / "uploads"
    if translation_old.exists():
        dirs_to_migrate.append((translation_old, TRANSLATION_UPLOAD_DIR))

    for src, dst in dirs_to_migrate:
        _copy_tree_merge(src, dst)

    summary = {
        "old_score": old_score,
        "current_score_before": current_score,
    }
    _write_migration_marker(str(old_root), summary)

    logger.info("Data root migration completed: %s -> %s", old_root, current_root)
    return True
