from __future__ import annotations

import logging
import traceback
from pathlib import Path

import uvicorn


def _setup_launcher_logging() -> Path:
    base_dir = Path(__file__).resolve().parents[1]
    log_dir = base_dir / "data" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "launcher_runtime.log"

    root = logging.getLogger()
    root.setLevel(logging.INFO)
    if not any(getattr(h, "name", "") == "launcher_runtime" for h in root.handlers):
        handler = logging.FileHandler(log_path, encoding="utf-8")
        handler.name = "launcher_runtime"
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")
        )
        root.addHandler(handler)
    return log_path


def main() -> None:
    log_path = _setup_launcher_logging()
    logger = logging.getLogger(__name__)
    logger.info("Desktop launcher booting; log=%s", log_path)
    try:
        from app.config import APP_HOST, APP_PORT
        from app.main import app

        config = uvicorn.Config(
            app,
            host=APP_HOST,
            port=APP_PORT,
            log_level="info",
            log_config=None,
        )
        server = uvicorn.Server(config)
        setattr(server, "install_signal_handlers", lambda: None)
        logger.info("Starting uvicorn server on http://%s:%s", APP_HOST, APP_PORT)
        server.run()
        logger.info("Uvicorn server exited normally")
    except Exception:
        logger.error("Desktop launcher crashed:\n%s", traceback.format_exc())
        raise


if __name__ == "__main__":
    main()
