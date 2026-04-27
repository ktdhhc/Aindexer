from __future__ import annotations

from pathlib import Path

import pytest

import app.config as app_config
import app.db as app_db
import app.main as app_main
import app.translation.config as translation_config
from app.main import create_app
from tests.translation.pdf_preview_fixtures import build_preview_pdf_bytes
from tests.translation.ui_test_server import run_test_server

playwright_sync_api = pytest.importorskip("playwright.sync_api")
sync_playwright = playwright_sync_api.sync_playwright
expect = playwright_sync_api.expect


def _patch_data_paths(tmp_path, monkeypatch) -> None:
    data_dir = tmp_path / "data"
    log_dir = data_dir / "logs"
    upload_dir = data_dir / "uploads"
    index_dir = data_dir / "indexes"
    export_dir = data_dir / "exports"
    db_path = data_dir / "app.db"
    translation_data_dir = data_dir / "translation"
    translation_upload_dir = translation_data_dir / "uploads"

    monkeypatch.setattr(app_config, "DATA_DIR", data_dir)
    monkeypatch.setattr(app_config, "LOG_DIR", log_dir)
    monkeypatch.setattr(app_config, "UPLOAD_DIR", upload_dir)
    monkeypatch.setattr(app_config, "INDEX_DIR", index_dir)
    monkeypatch.setattr(app_config, "EXPORT_DIR", export_dir)
    monkeypatch.setattr(app_config, "DB_PATH", db_path)
    monkeypatch.setattr(app_db, "DB_PATH", db_path)
    monkeypatch.setattr(app_main, "APP_LOG_PATH", log_dir / "app.log")
    monkeypatch.setattr(app_main, "LOG_DIR", log_dir)
    monkeypatch.setattr(
        translation_config, "TRANSLATION_DATA_DIR", translation_data_dir
    )
    monkeypatch.setattr(
        translation_config, "TRANSLATION_UPLOAD_DIR", translation_upload_dir
    )


@pytest.fixture
def server(tmp_path, monkeypatch):
    _patch_data_paths(tmp_path, monkeypatch)
    app = create_app()
    yield from run_test_server(app)


def test_translator_real_upload_renders_pdf_preview(server, tmp_path) -> None:
    pdf_path = Path(tmp_path) / "real-preview.pdf"
    pdf_path.write_bytes(
        build_preview_pdf_bytes(
            title="Real Upload Preview",
            body="Browser should render this uploaded PDF into the preview canvas.",
        )
    )

    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(viewport={"width": 1440, "height": 960})
        page = context.new_page()

        page.goto(f"{server}/translator/")
        page.set_input_files("#uploadFileInput", str(pdf_path))

        expect(page.locator("#uploadStatus")).to_have_text("Upload successful!")
        expect(page.locator(".pdf-preview-page canvas")).to_have_count(1)
        expect(page.locator("text=Text Workspace")).to_have_count(0)

        rendered = page.evaluate("""() => {
          const canvas = document.querySelector('.pdf-preview-page canvas');
          if (!canvas) return null;
          const ctx = canvas.getContext('2d');
          const points = [
            [Math.floor(canvas.width * 0.2), Math.floor(canvas.height * 0.2)],
            [Math.floor(canvas.width * 0.5), Math.floor(canvas.height * 0.45)],
            [Math.floor(canvas.width * 0.75), Math.floor(canvas.height * 0.75)],
          ];
          const samples = points.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data));
          return { width: canvas.width, height: canvas.height, samples };
        }""")

        assert rendered is not None
        assert rendered["width"] > 0
        assert rendered["height"] > 0
        assert any(sample != [255, 255, 255, 255] for sample in rendered["samples"])

        browser.close()
