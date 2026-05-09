from __future__ import annotations

import logging

from ..config import PROMPTS_ROOT


PROMPTS_DIR = PROMPTS_ROOT


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
