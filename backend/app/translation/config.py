from __future__ import annotations

from pathlib import Path

from ..config import DATA_DIR

TRANSLATION_DATA_DIR = DATA_DIR / "translation"
TRANSLATION_UPLOAD_DIR = TRANSLATION_DATA_DIR / "uploads"
TRANSLATION_MAX_FILE_BYTES = 20 * 1024 * 1024


def ensure_translation_dirs() -> None:
    TRANSLATION_DATA_DIR.mkdir(parents=True, exist_ok=True)
    TRANSLATION_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
