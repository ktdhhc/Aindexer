from __future__ import annotations

import os
import sys
from pathlib import Path


SOURCE_ROOT = Path(__file__).resolve().parents[2]
SOURCE_BACKEND_ROOT = Path(__file__).resolve().parents[1]


def _expand_path(value: str) -> Path:
    return Path(value).expanduser().resolve()


def _resolve_runtime_root() -> Path:
    override = os.getenv("AINDEXER_RUNTIME_ROOT")
    if override:
        return _expand_path(override)

    if getattr(sys, "frozen", False):
        if getattr(sys, "_MEIPASS", None):
            return Path(sys._MEIPASS).resolve()

        exe_dir = Path(sys.executable).resolve().parent
        internal_dir = exe_dir / "_internal"
        if internal_dir.exists():
            return internal_dir.resolve()
        return exe_dir

    return SOURCE_ROOT


def _first_existing_path(candidates: list[Path]) -> Path:
    for candidate in candidates:
        if candidate.exists():
            return candidate.resolve()
    return candidates[0].resolve()


RUNTIME_ROOT = _resolve_runtime_root()
BASE_DIR = SOURCE_ROOT


def _resolve_backend_root() -> Path:
    candidates: list[Path] = []

    override = os.getenv("AINDEXER_BACKEND_ROOT")
    if override:
        candidates.append(_expand_path(override))

    legacy_override = os.getenv("AINDEXER_BACKEND_DIR")
    if legacy_override:
        candidates.append(_expand_path(legacy_override))

    if getattr(sys, "frozen", False):
        if getattr(sys, "_MEIPASS", None):
            candidates.append(Path(sys._MEIPASS).resolve() / "backend")

        exe_dir = Path(sys.executable).resolve().parent
        candidates.extend(
            [
                exe_dir / "_internal" / "backend",
                exe_dir / "backend",
                RUNTIME_ROOT / "backend",
            ]
        )

    candidates.append(SOURCE_BACKEND_ROOT)
    return _first_existing_path(candidates)


BACKEND_ROOT = _resolve_backend_root()
FRONTEND_ROOT = BACKEND_ROOT / "frontend"
PROMPTS_ROOT = BACKEND_ROOT / "prompts"


def _resolve_data_dir() -> Path:
    override = os.getenv("AINDEXER_DATA_DIR")
    if override:
        return _expand_path(override)

    if getattr(sys, "frozen", False):
        if appdata := os.getenv("APPDATA"):
            return Path(appdata).expanduser().resolve() / "Aindexer" / "v4" / "data"
        if home := os.getenv("HOME"):
            return Path(home).expanduser().resolve() / ".local" / "share" / "aindexer-v4" / "data"

    return BASE_DIR / "data"


DATA_DIR = _resolve_data_dir()
LOG_DIR = DATA_DIR / "logs"
UPLOAD_DIR = DATA_DIR / "uploads"
INDEX_DIR = DATA_DIR / "indexes"
EXPORT_DIR = DATA_DIR / "exports"
DB_PATH = DATA_DIR / "app.db"
APP_LOG_PATH = LOG_DIR / "app.log"

APP_HOST = os.getenv("APP_HOST", "127.0.0.1")
APP_PORT = int(os.getenv("APP_PORT", "8000"))
SECRET_KEY = os.getenv("APP_SECRET_KEY", "change-this-local-secret")


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    INDEX_DIR.mkdir(parents=True, exist_ok=True)
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
