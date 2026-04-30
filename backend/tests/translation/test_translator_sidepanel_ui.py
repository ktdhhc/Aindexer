import pytest
import importlib

from tests.translation.pdf_preview_fixtures import build_preview_pdf_bytes

ui_test_server = importlib.import_module("tests.translation.ui_test_server")

playwright_sync_api = importlib.import_module("playwright.sync_api")
sync_playwright = playwright_sync_api.sync_playwright
expect = playwright_sync_api.expect

PREVIEW_PDF = build_preview_pdf_bytes(
    title="Translator Sidepanel Preview",
    body="This PDF preview is used to verify rendered pages remain visible while translating.",
)


@pytest.fixture(scope="module")
def server():
    from app.main import app

    yield from ui_test_server.run_test_server(app)


def test_translator_selection_and_translation(server):
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(viewport={"width": 1280, "height": 720})
        page = context.new_page()

        # Mock APIs
        page.route(
            "**/api/translation/documents*",
            lambda route: route.fulfill(
                json=[
                    {
                        "id": "doc1",
                        "filename": "test.pdf",
                        "display_name": "Test Document",
                        "title": "Test Document",
                        "authors": ["Grace Hopper"],
                        "year": 1952,
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
                        "text_content": "Translate this specific sentence.",
                        "text_map_json": {
                            "spans": [
                                {
                                    "text": "Translate",
                                    "x0": 72,
                                    "y0": 72,
                                    "x1": 130,
                                    "y1": 88,
                                    "start_offset": 0,
                                    "end_offset": 9,
                                },
                                {
                                    "text": "this",
                                    "x0": 136,
                                    "y0": 72,
                                    "x1": 164,
                                    "y1": 88,
                                    "start_offset": 10,
                                    "end_offset": 14,
                                },
                                {
                                    "text": "specific",
                                    "x0": 170,
                                    "y0": 72,
                                    "x1": 226,
                                    "y1": 88,
                                    "start_offset": 15,
                                    "end_offset": 23,
                                },
                                {
                                    "text": "sentence.",
                                    "x0": 232,
                                    "y0": 72,
                                    "x1": 294,
                                    "y1": 88,
                                    "start_offset": 24,
                                    "end_offset": 33,
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

        # Mock translation API
        def handle_translation(route):
            post_data = route.request.post_data_json
            assert post_data["source_text"] == "Translate this specific sentence."
            assert post_data["document_id"] == "doc1"
            assert post_data["target_lang"] == "en"

            route.fulfill(
                json={
                    "request_id": "req1",
                    "document_id": "doc1",
                    "provider": "deepseek",
                    "model": "deepseek-chat",
                    "source_text": "Translate this specific sentence.",
                    "translated_text": "翻译这个特定的句子。",
                    "cached": False,
                    "input_tokens": 18,
                    "output_tokens": 12,
                    "total_tokens": 30,
                    "first_token_ms": 220,
                    "total_duration_ms": 810,
                }
            )

        page.route("**/api/translation/translate-selection", handle_translation)

        page.goto(f"{server}/translator/")

        # Load document
        page.click('[data-doc-id="doc1"]')
        page.select_option("#targetLanguageSelect", "en")

        # Wait for content
        expect(page.locator(".translator-viewer")).to_contain_text(
            "Translate this specific sentence."
        )
        expect(page.locator(".pdf-preview-page canvas")).to_have_count(1)

        # Simulate direct selection inside preview text layer
        page.locator(".pdf-text-layer").select_text()
        page.locator(".pdf-text-layer").dispatch_event("mouseup")

        # Check side panel states
        expect(page.locator(".translator-sidepanel-output")).to_be_visible()
        expect(page.locator(".translator-sidepanel-output")).to_have_text(
            "翻译这个特定的句子。"
        )
        expect(page.locator("#sourceText")).to_have_text(
            "Translate this specific sentence."
        )
        expect(page.locator("#translationMetrics")).to_contain_text("in 18")
        expect(page.locator("#translationMetrics")).to_contain_text("out 12")
        expect(page.locator("#translationMetrics")).to_contain_text("first 220ms")
        expect(page.locator("#translationMetrics")).to_contain_text("total 810ms")
        expect(page.locator("#cancelTranslationBtn")).to_be_disabled()

        browser.close()


def test_translator_provider_config_save_and_test(server):
    """Test that provider config save and test buttons work independently."""
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(viewport={"width": 1280, "height": 720})
        page = context.new_page()

        # Mock provider APIs
        page.route(
            "**/api/providers",
            lambda route: route.fulfill(
                json=[
                    {
                        "provider": "deepseek",
                        "base_url": "https://api.deepseek.com/v1",
                        "model": "deepseek-chat",
                        "has_api_key": False,
                        "api_key_masked": "",
                        "temperature": 0.1,
                        "timeout": 120,
                        "enabled": True,
                    }
                ]
            ),
        )

        # Mock save endpoint
        def handle_save(route):
            route.fulfill(json={"ok": True})

        page.route("**/api/providers/deepseek", handle_save)

        # Mock test endpoint
        def handle_test(route):
            route.fulfill(
                json={
                    "success": True,
                    "message": "Connection successful",
                    "elapsed_seconds": 0.42,
                }
            )

        page.route("**/api/providers/deepseek/test", handle_test)

        page.goto(f"{server}/translator/")

        # Fill in config form
        page.fill("#configBaseUrl", "https://api.deepseek.com/v1")
        page.fill("#configModel", "deepseek-chat")
        page.fill("#configApiKey", "sk-test-api-key-12345")

        # Click save button
        page.click("#saveConfigBtn")

        # Wait for success message
        expect(page.locator("#configMessage")).to_be_visible()
        expect(page.locator("#configMessage")).to_have_text(
            "Configuration saved successfully"
        )

        # Click test button
        page.click("#testConfigBtn")

        # Wait for test result
        expect(page.locator("#configMessage")).to_be_visible()
        expect(page.locator("#configMessage")).to_contain_text("Connection successful")

        browser.close()


def test_translator_upload_refreshes_document_list(server):
    """Test that upload refreshes document list and selects the uploaded doc."""
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(viewport={"width": 1280, "height": 720})
        page = context.new_page()

        uploaded_doc_id = None

        # Mock initial empty documents list
        def handle_documents(route):
            if uploaded_doc_id:
                route.fulfill(
                    json=[
                        {
                            "id": uploaded_doc_id,
                            "filename": "uploaded.pdf",
                            "display_name": "uploaded.pdf",
                        }
                    ]
                )
            else:
                route.fulfill(json=[])

        page.route("**/api/translation/documents*", handle_documents)

        # Mock upload endpoint
        def handle_upload(route):
            nonlocal uploaded_doc_id
            uploaded_doc_id = "doc_uploaded_123"
            route.fulfill(
                json={
                    "document_id": uploaded_doc_id,
                    "duplicate": False,
                    "text_layer_status": "ready",
                }
            )

        page.route("**/api/translation/documents/upload", handle_upload)
        page.route(
            "**/api/translation/documents/doc_uploaded_123/original*",
            lambda route: route.fulfill(
                body=PREVIEW_PDF, content_type="application/pdf"
            ),
        )

        # Mock pages endpoint
        page.route(
            "**/api/translation/documents/doc_uploaded_123/pages",
            lambda route: route.fulfill(
                json=[
                    {
                        "page_number": 1,
                        "text_content": "Uploaded document content.",
                        "text_map_json": {
                            "spans": [
                                {
                                    "text": "Uploaded",
                                    "x0": 72,
                                    "y0": 72,
                                    "x1": 128,
                                    "y1": 88,
                                    "start_offset": 0,
                                    "end_offset": 8,
                                },
                                {
                                    "text": "document",
                                    "x0": 134,
                                    "y0": 72,
                                    "x1": 192,
                                    "y1": 88,
                                    "start_offset": 9,
                                    "end_offset": 17,
                                },
                                {
                                    "text": "content.",
                                    "x0": 198,
                                    "y0": 72,
                                    "x1": 250,
                                    "y1": 88,
                                    "start_offset": 18,
                                    "end_offset": 26,
                                },
                            ]
                        },
                    }
                ]
            ),
        )

        page.goto(f"{server}/translator/")

        # Initially no documents
        expect(page.locator("#documentList")).to_contain_text("No documents yet")

        # Simulate file upload using JS (since file chooser requires user interaction)
        page.evaluate("""() => {
            const mockFile = new File(['mock pdf content'], 'uploaded.pdf', { type: 'application/pdf' });
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(mockFile);
            const input = document.getElementById('uploadFileInput');
            input.files = dataTransfer.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }""")

        # Wait for upload status to show success
        expect(page.locator("#uploadStatus")).to_be_visible()
        expect(page.locator("#uploadStatus")).to_have_text("Upload successful!")

        # Check that document list is refreshed and new doc is selected
        expect(page.locator('[data-doc-id="doc_uploaded_123"]')).to_be_visible()
        expect(page.locator("#documentList")).to_contain_text("uploaded.pdf")

        # Check that viewer loaded the document
        expect(page.locator(".translator-viewer")).to_contain_text(
            "Uploaded document content"
        )
        expect(page.locator(".pdf-preview-page canvas")).to_have_count(1)

        browser.close()
