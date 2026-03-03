from __future__ import annotations

import logging
import os
import threading
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException

from ..config import BASE_DIR

router = APIRouter()
logger = logging.getLogger(__name__)


def _resolve_tutorial_path() -> Path:
    candidates = [
        BASE_DIR / "TUTORIAL.md",
        BASE_DIR / "_internal" / "TUTORIAL.md",
    ]
    for p in candidates:
        if p.exists():
            return p
    return candidates[0]


TUTORIAL_PATH = _resolve_tutorial_path()


def _exit_soon() -> None:
    time.sleep(0.4)
    os._exit(0)


@router.post("/exit")
def exit_app() -> dict:
    logger.warning("Exit requested from UI")
    t = threading.Thread(target=_exit_soon, daemon=True)
    t.start()
    return {"ok": True, "message": "shutting_down"}


@router.get("/tutorial")
def get_tutorial_markdown() -> dict:
    if not TUTORIAL_PATH.exists():
        raise HTTPException(status_code=404, detail="TUTORIAL.md not found")
    try:
        text = TUTORIAL_PATH.read_text(encoding="utf-8")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read tutorial: {exc}")
    return {"markdown": text}
