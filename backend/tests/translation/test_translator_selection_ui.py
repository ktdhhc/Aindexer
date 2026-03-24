import pytest
import importlib

from tests.translation.pdf_preview_fixtures import build_multi_page_preview_pdf_bytes

ui_test_server = importlib.import_module("tests.translation.ui_test_server")

playwright_sync_api = importlib.import_module("playwright.sync_api")
sync_playwright = playwright_sync_api.sync_playwright
expect = playwright_sync_api.expect

PREVIEW_PDF = build_multi_page_preview_pdf_bytes(
    [
        (
            "Translator Preview Page 1",
            "This PDF preview should render visible content while search still uses selectable preview text.",
        ),
        (
            "Translator Preview Page 2",
            "A second preview page ensures search navigation can move across multiple rendered pages.",
        ),
    ]
)


@pytest.fixture(scope="module")
def server():
    from app.main import app

    yield from ui_test_server.run_test_server(app)


def test_translator_document_load_and_search(server):
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(viewport={"width": 1280, "height": 720})
        page = context.new_page()

        # Mock APIs
        page.route(
            "**/api/translation/documents",
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
                        "text_content": "This is a test document with some sample text for translation.",
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
                                    "text": "test",
                                    "x0": 132,
                                    "y0": 72,
                                    "x1": 156,
                                    "y1": 88,
                                    "start_offset": 10,
                                    "end_offset": 14,
                                },
                                {
                                    "text": "document",
                                    "x0": 162,
                                    "y0": 72,
                                    "x1": 220,
                                    "y1": 88,
                                    "start_offset": 15,
                                    "end_offset": 23,
                                },
                                {
                                    "text": "with",
                                    "x0": 226,
                                    "y0": 72,
                                    "x1": 254,
                                    "y1": 88,
                                    "start_offset": 24,
                                    "end_offset": 28,
                                },
                                {
                                    "text": "some",
                                    "x0": 260,
                                    "y0": 72,
                                    "x1": 290,
                                    "y1": 88,
                                    "start_offset": 29,
                                    "end_offset": 33,
                                },
                                {
                                    "text": "sample",
                                    "x0": 296,
                                    "y0": 72,
                                    "x1": 338,
                                    "y1": 88,
                                    "start_offset": 34,
                                    "end_offset": 40,
                                },
                                {
                                    "text": "text",
                                    "x0": 344,
                                    "y0": 72,
                                    "x1": 372,
                                    "y1": 88,
                                    "start_offset": 41,
                                    "end_offset": 45,
                                },
                                {
                                    "text": "for",
                                    "x0": 378,
                                    "y0": 72,
                                    "x1": 396,
                                    "y1": 88,
                                    "start_offset": 46,
                                    "end_offset": 49,
                                },
                                {
                                    "text": "translation.",
                                    "x0": 402,
                                    "y0": 72,
                                    "x1": 474,
                                    "y1": 88,
                                    "start_offset": 50,
                                    "end_offset": 62,
                                },
                            ]
                        },
                    },
                    {
                        "page_number": 2,
                        "text_content": "Another page with more sample text.",
                        "text_map_json": {
                            "spans": [
                                {
                                    "text": "Another",
                                    "x0": 72,
                                    "y0": 72,
                                    "x1": 118,
                                    "y1": 88,
                                    "start_offset": 0,
                                    "end_offset": 7,
                                },
                                {
                                    "text": "page",
                                    "x0": 124,
                                    "y0": 72,
                                    "x1": 154,
                                    "y1": 88,
                                    "start_offset": 8,
                                    "end_offset": 12,
                                },
                                {
                                    "text": "with",
                                    "x0": 160,
                                    "y0": 72,
                                    "x1": 188,
                                    "y1": 88,
                                    "start_offset": 13,
                                    "end_offset": 17,
                                },
                                {
                                    "text": "more",
                                    "x0": 194,
                                    "y0": 72,
                                    "x1": 224,
                                    "y1": 88,
                                    "start_offset": 18,
                                    "end_offset": 22,
                                },
                                {
                                    "text": "sample",
                                    "x0": 230,
                                    "y0": 72,
                                    "x1": 272,
                                    "y1": 88,
                                    "start_offset": 23,
                                    "end_offset": 29,
                                },
                                {
                                    "text": "text.",
                                    "x0": 278,
                                    "y0": 72,
                                    "x1": 312,
                                    "y1": 88,
                                    "start_offset": 30,
                                    "end_offset": 35,
                                },
                            ]
                        },
                    },
                ]
            ),
        )
        page.route(
            "**/api/translation/documents/doc1/original*",
            lambda route: route.fulfill(
                body=PREVIEW_PDF, content_type="application/pdf"
            ),
        )

        page.goto(f"{server}/translator/")

        # Select and load document
        page.select_option("#documentSelect", "doc1")
        page.click("#loadDocBtn")

        # Check viewer content
        viewer = page.locator(".translator-viewer")
        expect(viewer).to_be_visible()
        expect(page.locator(".pdf-preview-page canvas")).to_have_count(2)
        expect(page.locator(".pdf-text-layer")).to_have_count(2)
        expect(page.locator("text=Text Workspace")).to_have_count(0)
        expect(viewer).to_contain_text("This is a test document")

        rendered = page.evaluate("""() => {
          const canvas = document.querySelector('.pdf-preview-page canvas');
          if (!canvas) return null;
          const ctx = canvas.getContext('2d');
          const { width, height } = canvas;
          const sample = ctx.getImageData(Math.floor(width / 2), Math.floor(height / 2), 1, 1).data;
          return { width, height, sample: Array.from(sample) };
        }""")
        assert rendered is not None
        assert rendered["width"] > 0
        assert rendered["height"] > 0
        assert rendered["sample"] != [255, 255, 255, 255]

        # Test search
        page.fill(".translator-search-input", "sample text")

        # Check highlights on preview text layer
        expect(page.locator(".pdf-text-span.search-hit").first).to_be_visible()
        expect(page.locator(".pdf-text-span.search-active").first).to_be_visible()

        # Test search navigation
        page.click("#searchNextBtn")
        expect(page.locator("#searchCount")).to_have_text("2/2")

        browser.close()
