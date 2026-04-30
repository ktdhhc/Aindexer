import pytest
import importlib

ui_test_server = importlib.import_module("tests.translation.ui_test_server")

playwright_sync_api = importlib.import_module("playwright.sync_api")
sync_playwright = playwright_sync_api.sync_playwright
expect = playwright_sync_api.expect


@pytest.fixture(scope="module")
def server():
    from app.main import app

    yield from ui_test_server.run_test_server(app)


def test_translator_shell_load(server):
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(viewport={"width": 1280, "height": 720})
        page = context.new_page()

        # Mock documents API
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
            "**/api/providers",
            lambda route: route.fulfill(
                json=[
                    {
                        "provider": "openai",
                        "base_url": "https://api.openai.com/v1",
                        "model": "gpt-4.1-mini",
                        "has_api_key": False,
                        "api_key_masked": "",
                        "temperature": 0.1,
                        "timeout": 120,
                        "enabled": True,
                    },
                    {
                        "provider": "ollama",
                        "base_url": "http://localhost:11434/v1",
                        "model": "hy-mt1.5-1.8b:latest",
                        "has_api_key": True,
                        "api_key_masked": "ollama",
                        "temperature": 0.1,
                        "timeout": 120,
                        "enabled": True,
                    },
                ]
            ),
        )

        page.goto(f"{server}/translator/")

        # Check shell elements
        expect(page.locator(".translator-search-input")).to_be_visible()
        expect(page.locator(".translator-sidepanel")).to_be_visible()
        expect(page.locator(".translator-empty-state").first).to_be_visible()

        # Check document loaded in select
        expect(page.locator("#documentSelect")).to_contain_text("Test Document")

        # Check upload controls are visible (independent entry requirement)
        expect(page.locator("#uploadBtn")).to_be_visible()
        expect(page.locator("#uploadBtn")).to_contain_text("Upload PDF")

        # Check provider config panel is visible (independent entry requirement)
        expect(page.locator("#configProviderSelect")).to_be_visible()
        expect(page.locator("#configBaseUrl")).to_be_visible()
        expect(page.locator("#configModel")).to_be_visible()
        expect(page.locator("#configApiKey")).to_be_visible()
        expect(page.locator("#saveConfigBtn")).to_be_visible()
        expect(page.locator("#testConfigBtn")).to_be_visible()

        # Check provider selectors are populated from shared provider config
        expect(page.locator("#configProviderSelect option")).to_have_count(2)
        expect(page.locator("#providerSelect option")).to_have_count(2)

        # Check refresh button is visible
        expect(page.locator("#refreshDocsBtn")).to_be_visible()
        expect(page.locator("#cancelTranslationBtn")).to_be_visible()
        expect(page.locator("#cancelTranslationBtn")).to_be_disabled()

        browser.close()
