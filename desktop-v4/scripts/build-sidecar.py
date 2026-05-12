from __future__ import annotations

import argparse
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
FRONTEND_DIST = BACKEND / "frontend" / "v3"
BUILD_ROOT = ROOT / "build" / "desktop-v4-sidecar"
DIST_ROOT = ROOT / "dist" / "desktop-v4-sidecar"
SPEC_ROOT = BUILD_ROOT / "spec"
WORK_ROOT = BUILD_ROOT / "work"
SIDECAR_NAME = "aindexer-sidecar"
CONTENTS_DIR = "_internal"


def run(cmd: list[str], cwd: Path | None = None) -> None:
    print("[RUN]", " ".join(str(part) for part in cmd))
    subprocess.run(cmd, cwd=str(cwd or ROOT), check=True)


def ensure_pyinstaller() -> None:
    try:
        import PyInstaller  # noqa: F401
    except Exception:
        run([sys.executable, "-m", "pip", "install", "pyinstaller==6.16.0"])


def ensure_frontend_dist() -> None:
    index_html = FRONTEND_DIST / "index.html"
    if index_html.exists():
        return
    raise RuntimeError(
        f"Missing frontend build output: {index_html}. Run `cd frontend-v3 && npm run build` first."
    )


def clean_paths() -> None:
    if BUILD_ROOT.exists():
        shutil.rmtree(BUILD_ROOT)
    target_dir = DIST_ROOT / SIDECAR_NAME
    if target_dir.exists():
        shutil.rmtree(target_dir)


def build_sidecar() -> Path:
    ensure_pyinstaller()
    ensure_frontend_dist()
    clean_paths()
    BUILD_ROOT.mkdir(parents=True, exist_ok=True)
    DIST_ROOT.mkdir(parents=True, exist_ok=True)
    SPEC_ROOT.mkdir(parents=True, exist_ok=True)
    WORK_ROOT.mkdir(parents=True, exist_ok=True)

    sep = os.pathsep
    args = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--onedir",
        "--contents-directory",
        CONTENTS_DIR,
        "--name",
        SIDECAR_NAME,
        "--distpath",
        str(DIST_ROOT),
        "--workpath",
        str(WORK_ROOT),
        "--specpath",
        str(SPEC_ROOT),
        "--paths",
        str(BACKEND),
        "--collect-submodules",
        "app.translation",
        "--hidden-import",
        "app.translation.router",
        "--add-data",
        f"{FRONTEND_DIST}{sep}backend/frontend/v3",
        "--add-data",
        f"{(BACKEND / 'prompts')}{sep}backend/prompts",
        "--add-data",
        f"{(BACKEND / 'app' / 'provider_registry' / 'provider_model_registry.json')}{sep}backend/app/provider_registry",
        "--add-data",
        f"{(BACKEND / 'app' / 'provider_registry' / 'model_name_registry.json')}{sep}backend/app/provider_registry",
        str(BACKEND / "desktop_v4_sidecar.py"),
    ]
    run(args, cwd=ROOT)
    return DIST_ROOT / SIDECAR_NAME


def pick_unused_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def read_log_tail(path: Path, lines: int = 40) -> str:
    if not path.exists():
        return f"{path.name}: <missing>"
    try:
        content = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except Exception as exc:
        return f"{path.name}: <unreadable: {exc}>"
    tail = content[-lines:] if content else ["<empty>"]
    return f"{path.name}:\n" + "\n".join(tail)


def smoke_test(target_dir: Path) -> None:
    exe_name = f"{SIDECAR_NAME}.exe" if os.name == "nt" else SIDECAR_NAME
    exe_path = target_dir / exe_name
    if not exe_path.exists():
        raise RuntimeError(f"Built sidecar executable not found: {exe_path}")

    port = pick_unused_port()
    temp_data_dir = Path(tempfile.mkdtemp(prefix="aindexer-sidecar-smoke-"))
    env = os.environ.copy()
    env.update(
        {
            "AINDEXER_RUNTIME_ROOT": str(target_dir),
            "AINDEXER_BACKEND_ROOT": str(target_dir / CONTENTS_DIR / "backend"),
            "AINDEXER_DATA_DIR": str(temp_data_dir),
        }
    )
    proc = subprocess.Popen(
        [
            str(exe_path),
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--data-dir",
            str(temp_data_dir),
        ],
        cwd=str(target_dir),
        env=env,
    )

    last_error: Exception | None = None
    try:
        deadline = time.time() + 40
        providers_url = f"http://127.0.0.1:{port}/api/providers"
        workbench_url = f"http://127.0.0.1:{port}/v3/workbench"
        while time.time() < deadline:
            if proc.poll() is not None:
                raise RuntimeError(f"sidecar exited before becoming ready: {proc.returncode}")
            try:
                with urllib.request.urlopen(providers_url, timeout=2) as resp:
                    if resp.status != 200:
                        raise RuntimeError(f"unexpected providers status {resp.status}")
                with urllib.request.urlopen(workbench_url, timeout=2) as resp:
                    if resp.status != 200:
                        raise RuntimeError(f"unexpected workbench status {resp.status}")
                return
            except Exception as exc:
                last_error = exc
                time.sleep(1)

        log_dir = temp_data_dir / "logs"
        sidecar_log = read_log_tail(log_dir / "desktop_v4_sidecar.log")
        app_log = read_log_tail(log_dir / "app.log")
        raise RuntimeError(
            f"sidecar smoke test failed: {last_error}\n\n{sidecar_log}\n\n{app_log}"
        )
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=8)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)
        shutil.rmtree(temp_data_dir, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build desktop-v4 sidecar bundle")
    parser.add_argument(
        "--skip-smoke-test",
        action="store_true",
        help="Skip launching the packaged sidecar for a local smoke test",
    )
    args = parser.parse_args()

    target_dir = build_sidecar()
    if not args.skip_smoke_test:
        smoke_test(target_dir)

    print(f"[OK] Sidecar output: {target_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
