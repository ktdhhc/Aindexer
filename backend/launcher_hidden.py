from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path


HOST = "127.0.0.1"
PORT = 8000
URL = f"http://{HOST}:{PORT}"


def _wait_port_open(host: str, port: int, timeout_sec: int) -> bool:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=1.0):
                return True
        except OSError:
            time.sleep(0.5)
    return False


def _pick_browser_exe() -> str | None:
    candidates = [
        shutil.which("msedge"),
        shutil.which("chrome"),
        os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(
            r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
        ),
        os.path.expandvars(r"%LocalAppData%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
    ]
    for exe in candidates:
        if exe and Path(exe).exists():
            return exe
    return None


def _shutdown_server(server: subprocess.Popen) -> None:
    if server.poll() is not None:
        return
    server.terminate()
    try:
        server.wait(timeout=6)
    except subprocess.TimeoutExpired:
        server.kill()


def main() -> int:
    backend_dir = Path(__file__).resolve().parent
    root_dir = backend_dir.parent
    logs_dir = root_dir / "data" / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)

    out_log = logs_dir / "launcher.out.log"
    err_log = logs_dir / "launcher.err.log"

    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)

    with (
        out_log.open("a", encoding="utf-8") as out,
        err_log.open("a", encoding="utf-8") as err,
    ):
        server = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "app.main:app",
                "--host",
                HOST,
                "--port",
                str(PORT),
            ],
            cwd=str(backend_dir),
            stdout=out,
            stderr=err,
            creationflags=creationflags,
        )

        if not _wait_port_open(HOST, PORT, timeout_sec=20):
            _shutdown_server(server)
            return 1

        browser_exe = _pick_browser_exe()
        if not browser_exe:
            subprocess.Popen(
                ["cmd", "/c", "start", "", URL], creationflags=creationflags
            )
            return 0

        browser_profile = Path(
            tempfile.mkdtemp(prefix="indexer-browser-", dir=str(root_dir / "data"))
        )
        browser = subprocess.Popen(
            [
                browser_exe,
                f"--user-data-dir={browser_profile}",
                "--no-first-run",
                f"--app={URL}",
            ],
            creationflags=creationflags,
        )

        try:
            while True:
                if server.poll() is not None:
                    return 1
                if browser.poll() is not None:
                    _shutdown_server(server)
                    return 0
                time.sleep(1)
        finally:
            shutil.rmtree(browser_profile, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
