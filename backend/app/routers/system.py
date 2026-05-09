from __future__ import annotations

import logging
import os
import json
import signal
import subprocess
import threading
import time
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, Body, HTTPException

from ..config import BASE_DIR, LOG_DIR, ensure_dirs

router = APIRouter()
logger = logging.getLogger(__name__)


def _resolve_tutorial_path() -> Path:
    candidates = [
        BASE_DIR / "TUTORIAL.md",
        BASE_DIR / "README.md",
        BASE_DIR / "_internal" / "TUTORIAL.md",
    ]
    for p in candidates:
        if p.exists():
            return p
    return candidates[0]


TUTORIAL_PATH = _resolve_tutorial_path()
LAUNCHER_STATE_PATH = BASE_DIR / "data" / "runtime" / "launcher_state.json"


def _exit_soon() -> None:
    time.sleep(0.4)
    parent_pid = os.getppid()
    if _should_terminate_parent(parent_pid):
        try:
            os.kill(parent_pid, signal.SIGTERM)
            logger.warning("Exit requested: terminated parent reloader process %s", parent_pid)
            time.sleep(0.15)
        except Exception:
            logger.exception("Failed to terminate parent reloader process %s", parent_pid)
    os._exit(0)


def _read_process_commandline(pid: int) -> str:
    if pid <= 0:
        return ""

    try:
        if os.name == "nt":
            result = subprocess.run(
                [
                    "powershell",
                    "-NoProfile",
                    "-Command",
                    (
                        f"$p = Get-CimInstance Win32_Process -Filter \"ProcessId = {pid}\" "
                        "-ErrorAction SilentlyContinue; if ($p) { $p.CommandLine }"
                    ),
                ],
                capture_output=True,
                text=True,
                timeout=3,
                check=False,
            )
            return (result.stdout or "").strip()

        cmdline_path = Path(f"/proc/{pid}/cmdline")
        if cmdline_path.exists():
            return cmdline_path.read_text(encoding="utf-8", errors="ignore").replace("\x00", " ").strip()
    except Exception:
        logger.exception("Failed to inspect parent process command line for pid=%s", pid)
    return ""


def _should_terminate_parent(parent_pid: int) -> bool:
    cmdline = _read_process_commandline(parent_pid).lower()
    if not cmdline:
        return False
    return "uvicorn" in cmdline and ("--reload" in cmdline or "watchfiles" in cmdline)


def _terminate_launcher_browser() -> None:
    if not LAUNCHER_STATE_PATH.exists():
        return
    try:
        payload = json.loads(LAUNCHER_STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        logger.exception("Failed to read launcher state from %s", LAUNCHER_STATE_PATH)
        return

    browser_pid = int(payload.get("browser_pid") or 0)
    if browser_pid <= 0:
        return

    try:
        os.kill(browser_pid, signal.SIGTERM)
        logger.warning("Exit requested: terminated launcher browser process %s", browser_pid)
    except ProcessLookupError:
        logger.info("Launcher browser process %s already exited", browser_pid)
    except Exception:
        logger.exception("Failed to terminate launcher browser process %s", browser_pid)


@router.post("/exit")
def exit_app() -> dict:
    logger.warning("Exit requested from UI")
    _terminate_launcher_browser()
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


@router.post("/frontend_log")
def write_frontend_log(payload: dict = Body(...)) -> dict:
    ensure_dirs()
    entry = {
        "created_at": datetime.now(UTC).isoformat(),
        "level": str(payload.get("level") or "error")[:40],
        "source": str(payload.get("source") or "frontend")[:120],
        "message": str(payload.get("message") or "")[:4000],
        "stack": str(payload.get("stack") or "")[:8000],
        "url": str(payload.get("url") or "")[:1000],
        "user_agent": str(payload.get("user_agent") or "")[:1000],
    }
    try:
        with (LOG_DIR / "frontend.log").open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to write frontend log: {exc}")
    return {"ok": True}
