from __future__ import annotations

import os
import sys
from pathlib import Path


def _add(path: Path) -> None:
    if not path.exists():
        return
    try:
        os.add_dll_directory(str(path))
    except Exception:
        pass


base = Path(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent))
exe_dir = Path(sys.executable).resolve().parent

for candidate in [base, exe_dir, exe_dir / "_internal"]:
    _add(candidate)
