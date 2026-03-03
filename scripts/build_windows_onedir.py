from __future__ import annotations

import argparse
import datetime as dt
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
DIST = ROOT / "dist"
BUILD = ROOT / "build"
APP_NAME = "LiteratureIndexer"


def run(cmd: list[str], cwd: Path | None = None) -> None:
    print("[RUN]", " ".join(cmd))
    subprocess.run(cmd, cwd=str(cwd or ROOT), check=True)


def ensure_pyinstaller() -> None:
    try:
        import PyInstaller  # noqa: F401
    except Exception:
        run([sys.executable, "-m", "pip", "install", "pyinstaller==6.16.0"])


def write_starter(exe_dir: Path) -> None:
    starter = exe_dir / "start.bat"
    starter.write_text(
        "\r\n".join(
            [
                "@echo off",
                "setlocal",
                "cd /d %~dp0",
                'start "" "http://127.0.0.1:8000"',
                f"{APP_NAME}.exe",
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
        "--name",
        APP_NAME,
        "--distpath",
        str(DIST),
        "--workpath",
        str(BUILD),
        "--specpath",
        str(BUILD),
        "--add-data",
        f"{(BACKEND / 'frontend')}{';'}frontend",
        "--add-data",
        f"{(BACKEND / 'prompts')}{';'}backend/prompts",
        "--add-data",
        f"{(ROOT / 'TUTORIAL.md')}{';'}.",
        str(BACKEND / "desktop_main.py"),
    ]
    run(args, cwd=ROOT)

    write_starter(target_dir)

    readme = target_dir / "README_首次使用.txt"
    readme.write_text(
        "\n".join(
            [
                "双击 start.bat 启动。",
                "首次打开后在浏览器访问 http://127.0.0.1:8000。",
                "如端口 8000 被占用，请先关闭其他同类程序。",
                "日志位于 data/logs/app.log。",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    if no_zip:
        return target_dir

    ts = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_base = DIST / f"literature-indexer-windows-onedir-{ts}"
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
