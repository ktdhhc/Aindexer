from __future__ import annotations

import importlib
import logging
import mimetypes
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import APP_LOG_PATH, LOG_DIR, ensure_dirs
from .db import init_db
from .routers import (
    chat,
    export,
    fields,
    files,
    index,
    providers,
    search,
    system,
    workspaces,
)


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


def _configure_static_mime_types() -> None:
    # Windows registry mappings can report JS modules as text/plain, which breaks
    # the translator frontend because it is loaded via <script type="module">.
    mimetypes.add_type("text/javascript", ".js")
    mimetypes.add_type("text/javascript", ".mjs")


def create_app() -> FastAPI:
    _configure_logging()
    _configure_static_mime_types()
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
    app.include_router(workspaces.router, prefix="/api/workspaces", tags=["workspaces"])
    app.include_router(system.router, prefix="/api/system", tags=["system"])

    static_dir = Path(__file__).resolve().parents[1] / "frontend"
    translator_static_dir = static_dir / "translator"
    v3_static_dir = static_dir / "v3"
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

    if v3_static_dir.exists():

        def _resolve_v3_path(full_path: str) -> Path:
            target = (v3_static_dir / full_path).resolve()
            v3_root = v3_static_dir.resolve()
            try:
                target.relative_to(v3_root)
            except ValueError as exc:
                raise HTTPException(status_code=404, detail="Not found") from exc
            return target

        @app.get("/v3", include_in_schema=False)
        @app.get("/v3/{full_path:path}", include_in_schema=False)
        def serve_v3(full_path: str = "") -> FileResponse:
            if full_path:
                target = _resolve_v3_path(full_path)
                if target.is_file():
                    return FileResponse(target)
            return FileResponse(v3_static_dir / "index.html")

    if static_dir.exists():
        app.mount(
            "/", StaticFiles(directory=str(static_dir), html=True), name="frontend"
        )
    return app


app = create_app()
