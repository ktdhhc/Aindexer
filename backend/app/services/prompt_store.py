from __future__ import annotations

import logging
from pathlib import Path

from ..config import BASE_DIR


def _resolve_prompts_dir() -> Path:
    candidates = [
        BASE_DIR / "backend" / "prompts",
        BASE_DIR / "_internal" / "backend" / "prompts",
    ]
    for p in candidates:
        if p.exists():
            return p
    return candidates[0]


PROMPTS_DIR = _resolve_prompts_dir()


def get_prompt(name: str, default: str) -> str:
    path = PROMPTS_DIR / name
    try:
        text = path.read_text(encoding="utf-8").strip()
        if text:
            return text
    except Exception as exc:
        logging.getLogger(__name__).warning(
            "Load prompt failed path=%s err=%s", path, exc
        )
    return default.strip()


def get_required_prompt(name: str) -> str:
    path = PROMPTS_DIR / name
    try:
        text = path.read_text(encoding="utf-8").strip()
    except Exception as exc:
        raise RuntimeError(f"Prompt file missing or unreadable: {path}; {exc}") from exc
    if not text:
        raise RuntimeError(f"Prompt file is empty: {path}")
    return text
