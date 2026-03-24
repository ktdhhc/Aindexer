from __future__ import annotations

import importlib
import logging
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import APP_LOG_PATH, LOG_DIR, ensure_dirs
from .db import init_db
from .routers import chat, export, fields, files, index, providers, search, system


class DailyFileHandler(logging.FileHandler):
    def __init__(self, log_dir: Path, prefix: str = "app") -> None:
        self.log_dir = log_dir
        self.prefix = prefix
        self.current_date = datetime.now().strftime("%Y-%m-%d")
        super().__init__(self._build_path(self.current_date), encoding="utf-8")

    def _build_path(self, date_text: str) -> Path:
        return self.log_dir / f"{self.prefix}-{date_text}.log"

    def emit(self, record: logging.LogRecord) -> None:
        next_date = datetime.now().strftime("%Y-%m-%d")
        if next_date != self.current_date:
            self.acquire()
            try:
                if self.stream:
                    self.stream.close()
                self.current_date = next_date
                self.baseFilename = str(self._build_path(self.current_date))
                self.stream = self._open()
            finally:
                self.release()
        super().emit(record)


def _configure_logging() -> None:
    root = logging.getLogger()
    if any(getattr(h, "name", "") == "app_file" for h in root.handlers) and any(
        getattr(h, "name", "") == "app_dated_file" for h in root.handlers
    ):
        return

    ensure_dirs()
    root.setLevel(logging.INFO)
    formatter = logging.Formatter(
        fmt="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    file_handler = logging.FileHandler(APP_LOG_PATH, encoding="utf-8")
    file_handler.name = "app_file"
    file_handler.setLevel(logging.INFO)
    file_handler.setFormatter(formatter)
    root.addHandler(file_handler)

    dated_file_handler = DailyFileHandler(LOG_DIR)
    dated_file_handler.name = "app_dated_file"
    dated_file_handler.setLevel(logging.INFO)
    dated_file_handler.setFormatter(formatter)
    root.addHandler(dated_file_handler)

    logging.getLogger(__name__).info(
        "Logging initialized at %s and %s",
        APP_LOG_PATH,
        LOG_DIR / f"app-{datetime.now().strftime('%Y-%m-%d')}.log",
    )


def create_app() -> FastAPI:
    _configure_logging()
    init_db()
    translation_router = importlib.import_module("app.translation.router").router
    app = FastAPI(title="Aindexer", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(files.router, prefix="/api/files", tags=["files"])
    app.include_router(index.router, prefix="/api/index", tags=["index"])
    app.include_router(search.router, prefix="/api/search", tags=["search"])
    app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
    app.include_router(export.router, prefix="/api/export", tags=["export"])
    app.include_router(fields.router, prefix="/api/fields", tags=["fields"])
    app.include_router(providers.router, prefix="/api/providers", tags=["providers"])
    app.include_router(system.router, prefix="/api/system", tags=["system"])

    static_dir = Path(__file__).resolve().parents[1] / "frontend"
    translator_static_dir = static_dir / "translator"
    if translator_static_dir.exists():
        app.mount(
            "/translator",
            StaticFiles(directory=str(translator_static_dir), html=True),
            name="translator_frontend",
        )

    app.include_router(
        translation_router,
        prefix="/api/translation",
        tags=["translation"],
    )

    if static_dir.exists():
        app.mount(
            "/", StaticFiles(directory=str(static_dir), html=True), name="frontend"
        )
    return app


app = create_app()
