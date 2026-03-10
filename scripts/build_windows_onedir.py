from __future__ import annotations

import argparse
import datetime as dt
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
DIST = ROOT / "dist"
BUILD = ROOT / "build"
APP_NAME = "Aindexer"


def run(cmd: list[str], cwd: Path | None = None) -> None:
    print("[RUN]", " ".join(cmd))
    subprocess.run(cmd, cwd=str(cwd or ROOT), check=True)


def ensure_pyinstaller() -> None:
    try:
        import PyInstaller  # noqa: F401
    except Exception:
        run([sys.executable, "-m", "pip", "install", "pyinstaller==6.16.0"])


def collect_runtime_binaries() -> list[Path]:
    base = Path(sys.base_prefix)
    candidates = [
        base / "Library" / "bin" / "sqlite3.dll",
        base / "Library" / "bin" / "ffi-8.dll",
        base / "Library" / "bin" / "ffi.dll",
        base / "Library" / "bin" / "ffi-7.dll",
        base / "DLLs" / "libffi-8.dll",
        base / "DLLs" / "libffi-7.dll",
    ]
    return [p for p in candidates if p.exists()]


def is_port_in_use(host: str = "127.0.0.1", port: int = 8000) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex((host, port)) == 0


def _read_log_tail(path: Path, lines: int = 20) -> str:
    if not path.exists():
        return f"{path.name}: <missing>"
    try:
        content = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except Exception as exc:
        return f"{path.name}: <unreadable: {exc}>"
    tail = content[-lines:] if content else ["<empty>"]
    return f"{path.name}:\n" + "\n".join(tail)


def _smoke_test_once(target_dir: Path) -> None:
    exe_path = target_dir / f"{APP_NAME}.exe"
    print(f"[TEST] Starting smoke test: {exe_path}")
    proc = subprocess.Popen([str(exe_path)], cwd=str(target_dir))
    try:
        deadline = time.time() + 25
        last_error: Exception | None = None
        while time.time() < deadline:
            if proc.poll() is not None:
                raise RuntimeError(
                    f"Smoke test failed: {APP_NAME}.exe exited with code {proc.returncode}"
                )
            try:
                with urllib.request.urlopen(
                    "http://127.0.0.1:8000/api/providers", timeout=2
                ) as resp:
                    if resp.status == 200:
                        print("[TEST] Smoke test passed: /api/providers returned 200")
                        return
                    last_error = RuntimeError(f"unexpected status {resp.status}")
            except Exception as exc:
                last_error = exc
                time.sleep(1)
        raise RuntimeError(
            f"Smoke test failed: backend did not become ready ({last_error})"
        )
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=8)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)


def smoke_test(target_dir: Path) -> None:
    if is_port_in_use():
        raise RuntimeError("Smoke test skipped: port 8000 is already in use")

    logs_dir = target_dir / "data" / "logs"
    last_exc: Exception | None = None
    for attempt in range(1, 3):
        try:
            _smoke_test_once(target_dir)
            return
        except Exception as exc:
            last_exc = exc
            print(f"[TEST] Smoke test attempt {attempt} failed: {exc}")
            time.sleep(2)

    launcher_log = _read_log_tail(logs_dir / "launcher_runtime.log")
    app_log = _read_log_tail(logs_dir / "app.log")
    raise RuntimeError(
        f"Smoke test failed after 2 attempts: {last_exc}\n\n{launcher_log}\n\n{app_log}"
    )


def write_starter(exe_dir: Path) -> None:
    starter = exe_dir / "start.bat"
    starter.write_text(
        "\r\n".join(
            [
                "@echo off",
                "setlocal",
                "cd /d %~dp0",
                f'start "" "{APP_NAME}.exe"',
                "ping 127.0.0.1 -n 3 >nul",
                'start "" "http://127.0.0.1:8000"',
            ]
        )
        + "\r\n",
        encoding="utf-8",
    )


def write_debug_starter(exe_dir: Path) -> None:
    starter = exe_dir / "start_debug.bat"
    starter.write_text(
        "\r\n".join(
            [
                "@echo off",
                "setlocal",
                "cd /d %~dp0",
                "echo [RUN] Starting Aindexer in visible debug mode...",
                "echo [RUN] Browser will open in ~2 seconds.",
                'start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process \'http://127.0.0.1:8000\'"',
                f'"{APP_NAME}.exe"',
                "echo.",
                "echo [INFO] Aindexer exited.",
                "pause",
            ]
        )
        + "\r\n",
        encoding="utf-8",
    )


def build(no_zip: bool) -> Path:
    ensure_pyinstaller()

    if BUILD.exists():
        shutil.rmtree(BUILD)
    target_dir = DIST / APP_NAME
    if target_dir.exists():
        shutil.rmtree(target_dir)

    args = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onedir",
        "--noconsole",
        "--name",
        APP_NAME,
        "--distpath",
        str(DIST),
        "--workpath",
        str(BUILD),
        "--specpath",
        str(BUILD),
        "--runtime-hook",
        str(ROOT / "scripts" / "pyi_rth_dll_path.py"),
        "--add-data",
        f"{(BACKEND / 'frontend')}{';'}frontend",
        "--add-data",
        f"{(BACKEND / 'prompts')}{';'}backend/prompts",
        "--add-data",
        f"{(ROOT / 'TUTORIAL.md')}{';'}.",
        str(BACKEND / "desktop_main.py"),
    ]
    for dll in collect_runtime_binaries():
        args += ["--add-binary", f"{dll}{';'}."]
    run(args, cwd=ROOT)

    write_starter(target_dir)
    write_debug_starter(target_dir)
    smoke_test(target_dir)

    readme = target_dir / "README_首次使用.txt"
    readme.write_text(
        "\n".join(
            [
                "双击 start.bat 启动。",
                "首次打开后在浏览器访问 http://127.0.0.1:8000。",
                "若需可见调试窗口，双击 start_debug.bat。",
                "如端口 8000 被占用，请先关闭其他同类程序。",
                "日志位于 data/logs/ 目录。",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    if no_zip:
        return target_dir

    ts = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_base = DIST / f"Aindexer-windows-onedir-{ts}"
    zip_path = shutil.make_archive(
        str(zip_base), "zip", root_dir=DIST, base_dir=APP_NAME
    )
    return Path(zip_path)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build Windows onedir package")
    parser.add_argument("--no-zip", action="store_true", help="Skip zip archive")
    args = parser.parse_args()

    out = build(args.no_zip)
    print(f"[OK] Output: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
