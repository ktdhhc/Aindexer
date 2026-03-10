import argparse
import datetime as dt
import zipfile
from pathlib import Path
from typing import List


ROOT = Path(__file__).resolve().parents[1]
DIST_DIR = ROOT / "dist"

EXCLUDED_PREFIXES = {
    ".git",
    ".ruff_cache",
    "dist",
    "backend/.venv",
    "backend/.pytest_cache",
    "backend/.mypy_cache",
    "data/uploads",
    "data/indexes",
    "data/exports",
    "data/logs",
    "backend/data",
}

EXCLUDED_FILES = {
    "data/app.db",
    ".env",
    "backend/.env",
    "chat_with_llm_md.txt",
}

EXCLUDED_SUFFIXES = {".pyc", ".pyo"}


def is_excluded(path: Path) -> bool:
    rel = path.relative_to(ROOT).as_posix()
    if rel in EXCLUDED_FILES:
        return True
    for prefix in EXCLUDED_PREFIXES:
        if rel == prefix or rel.startswith(prefix + "/"):
            return True
    if "__pycache__" in path.parts:
        return True
    if path.suffix.lower() in EXCLUDED_SUFFIXES:
        return True
    if path.name in {"Thumbs.db", ".DS_Store"}:
        return True
    return False


def collect_files() -> List[Path]:
    files: List[Path] = []
    for p in ROOT.rglob("*"):
        if not p.is_file():
            continue
        if is_excluded(p):
            continue
        files.append(p)
    files.sort(key=lambda x: x.relative_to(ROOT).as_posix())
    return files


def build_zip(output: Path, files: List[Path]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for p in files:
            arc = p.relative_to(ROOT).as_posix()
            zf.write(p, arcname=arc)


def main() -> int:
    parser = argparse.ArgumentParser(description="Package project for sharing")
    parser.add_argument("--dry-run", action="store_true", help="List files only")
    parser.add_argument("--output", type=str, default="", help="Output zip path")
    args = parser.parse_args()

    files = collect_files()
    if not files:
        print("No files to package.")
        return 1

    if args.dry_run:
        print(f"[DRY-RUN] Files to include: {len(files)}")
        for p in files:
            print(p.relative_to(ROOT).as_posix())
        return 0

    if args.output:
        out_path = Path(args.output)
        if not out_path.is_absolute():
            out_path = ROOT / out_path
    else:
        ts = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
        out_path = DIST_DIR / f"aindexer-share-{ts}.zip"

    build_zip(out_path, files)
    print(f"Done. Included {len(files)} files")
    print(f"Archive: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
