from __future__ import annotations

import logging
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import APP_LOG_PATH, ensure_dirs
from .db import init_db
from .routers import chat, export, fields, files, index, providers, search, system


def _configure_logging() -> None:
    root = logging.getLogger()
    if any(getattr(h, "name", "") == "app_file" for h in root.handlers):
        return

    ensure_dirs()
    root.setLevel(logging.INFO)
    formatter = logging.Formatter(
        fmt="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    file_handler = TimedRotatingFileHandler(
        APP_LOG_PATH,
        when="midnight",
        interval=1,
        backupCount=0,
        encoding="utf-8",
    )
    file_handler.suffix = "%Y-%m-%d"
    file_handler.name = "app_file"
    file_handler.setLevel(logging.INFO)
    file_handler.setFormatter(formatter)
    root.addHandler(file_handler)
    logging.getLogger(__name__).info("Logging initialized at %s", APP_LOG_PATH)


def create_app() -> FastAPI:
    _configure_logging()
    init_db()
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
    if static_dir.exists():
        app.mount(
            "/", StaticFiles(directory=str(static_dir), html=True), name="frontend"
        )
    return app


app = create_app()
