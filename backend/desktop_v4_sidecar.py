from __future__ import annotations

import argparse
import logging
import os
import sys
import traceback
from pathlib import Path

import uvicorn


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Aindexer V4 FastAPI sidecar")
    parser.add_argument("--host", default=os.getenv("APP_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("APP_PORT", "8000")))
    parser.add_argument("--data-dir", default=os.getenv("AINDEXER_DATA_DIR"))
    return parser.parse_args()


def _default_data_dir() -> Path:
    if getattr(sys, "frozen", False):
        if localappdata := os.getenv("LOCALAPPDATA"):
            return Path(localappdata).expanduser().resolve() / "Aindexer" / "v4" / "data"
        if appdata := os.getenv("APPDATA"):
            return Path(appdata).expanduser().resolve() / "Aindexer" / "v4" / "data"
        if home := os.getenv("HOME"):
            return Path(home).expanduser().resolve() / ".local" / "share" / "aindexer-v4" / "data"
        return Path(sys.executable).resolve().parent / "data"
    return Path(__file__).resolve().parents[1] / "data"


def _setup_sidecar_logging(data_dir: Path) -> Path:
    log_dir = data_dir / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "desktop_v4_sidecar.log"

    root = logging.getLogger()
    root.setLevel(logging.INFO)
    if not any(getattr(h, "name", "") == "desktop_v4_sidecar" for h in root.handlers):
        handler = logging.FileHandler(log_path, encoding="utf-8")
        handler.name = "desktop_v4_sidecar"
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")
        )
        root.addHandler(handler)
    return log_path


def main() -> None:
    args = _parse_args()
    data_dir = Path(args.data_dir).expanduser().resolve() if args.data_dir else _default_data_dir()
    os.environ["APP_HOST"] = args.host
    os.environ["APP_PORT"] = str(args.port)
    os.environ["AINDEXER_DATA_DIR"] = str(data_dir)

    log_path = _setup_sidecar_logging(data_dir)
    logger = logging.getLogger(__name__)
    logger.info(
        "Desktop V4 sidecar booting; host=%s port=%s data_dir=%s log=%s",
        args.host,
        args.port,
        data_dir,
        log_path,
    )

    try:
        from app.main import app

        config = uvicorn.Config(
            app,
            host=args.host,
            port=args.port,
            log_level="info",
            log_config=None,
        )
        server = uvicorn.Server(config)
        setattr(server, "install_signal_handlers", lambda: None)
        server.run()
        logger.info("Desktop V4 sidecar exited normally")
    except Exception:
        logger.error("Desktop V4 sidecar crashed:\n%s", traceback.format_exc())
        raise


if __name__ == "__main__":
    main()
