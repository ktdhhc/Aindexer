from __future__ import annotations

import pytest
import importlib

from tests.translation.pdf_preview_fixtures import build_preview_pdf_bytes

ui_test_server = importlib.import_module("tests.translation.ui_test_server")

playwright_sync_api = importlib.import_module("playwright.sync_api")
sync_playwright = playwright_sync_api.sync_playwright
expect = playwright_sync_api.expect

PREVIEW_PDF = build_preview_pdf_bytes(
    title="Translator Error Preview",
    body="This rendered preview remains available even when translation fails.",
)


@pytest.fixture(scope="module")
def server():
    from app.main import app

    yield from ui_test_server.run_test_server(app)


def test_translator_error_states(server):
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(viewport={"width": 1280, "height": 720})
        page = context.new_page()

        page.route(
            "**/api/translation/documents*",
            lambda route: route.fulfill(
                json=[
                    {
                        "id": "doc1",
                        "filename": "test.pdf",
                        "display_name": "Test Document",
                    }
                ]
            ),
        )
        page.route(
            "**/api/translation/documents/doc1/pages",
            lambda route: route.fulfill(
                json=[
                    {
                        "page_number": 1,
                        "text_content": "This is a sufficiently long sample passage for translation errors.",
                        "text_map_json": {
                            "spans": [
                                {
                                    "text": "This",
                                    "x0": 72,
                                    "y0": 72,
                                    "x1": 96,
                                    "y1": 88,
                                    "start_offset": 0,
                                    "end_offset": 4,
                                },
                                {
                                    "text": "is",
                                    "x0": 102,
                                    "y0": 72,
                                    "x1": 114,
                                    "y1": 88,
                                    "start_offset": 5,
                                    "end_offset": 7,
                                },
                                {
                                    "text": "a",
                                    "x0": 120,
                                    "y0": 72,
                                    "x1": 126,
                                    "y1": 88,
                                    "start_offset": 8,
                                    "end_offset": 9,
                                },
                                {
                                    "text": "sufficiently",
                                    "x0": 132,
                                    "y0": 72,
                                    "x1": 208,
                                    "y1": 88,
                                    "start_offset": 10,
                                    "end_offset": 22,
                                },
                                {
                                    "text": "long",
                                    "x0": 214,
                                    "y0": 72,
                                    "x1": 242,
                                    "y1": 88,
                                    "start_offset": 23,
                                    "end_offset": 27,
                                },
                                {
                                    "text": "sample",
                                    "x0": 248,
                                    "y0": 72,
                                    "x1": 290,
                                    "y1": 88,
                                    "start_offset": 28,
                                    "end_offset": 34,
                                },
                                {
                                    "text": "passage",
                                    "x0": 296,
                                    "y0": 72,
                                    "x1": 344,
                                    "y1": 88,
                                    "start_offset": 35,
                                    "end_offset": 42,
                                },
                                {
                                    "text": "for",
                                    "x0": 350,
                                    "y0": 72,
                                    "x1": 368,
                                    "y1": 88,
                                    "start_offset": 43,
                                    "end_offset": 46,
                                },
                                {
                                    "text": "translation",
                                    "x0": 374,
                                    "y0": 72,
                                    "x1": 442,
                                    "y1": 88,
                                    "start_offset": 47,
                                    "end_offset": 58,
                                },
                                {
                                    "text": "errors.",
                                    "x0": 448,
                                    "y0": 72,
                                    "x1": 492,
                                    "y1": 88,
                                    "start_offset": 59,
                                    "end_offset": 66,
                                },
                            ]
                        },
                    }
                ]
            ),
        )
        page.route(
            "**/api/translation/documents/doc1/original*",
            lambda route: route.fulfill(
                body=PREVIEW_PDF, content_type="application/pdf"
            ),
        )
        page.route(
            "**/api/translation/translate-selection",
            lambda route: route.fulfill(
                status=400, json={"detail": "Provider timed out."}
            ),
        )

        page.goto(f"{server}/translator/")
        page.click('[data-doc-id="doc1"]')
        expect(page.locator(".translator-viewer")).to_contain_text(
            "sufficiently long sample passage"
        )
        expect(page.locator(".pdf-preview-page canvas")).to_have_count(1)

        page.locator(".pdf-text-layer").select_text()
        page.locator(".pdf-text-layer").dispatch_event("mouseup")

        expect(page.locator("#sidepanelError")).to_be_visible()
        expect(page.locator("#sidepanelErrorText")).to_have_text("Provider timed out.")

        browser.close()
