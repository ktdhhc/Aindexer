from fastapi.testclient import TestClient
import httpx

from app.main import create_app
from app.routers import system


def test_latest_update_endpoint_reports_newer_release(monkeypatch) -> None:
    monkeypatch.setattr(
        system,
        "_load_latest_update_payload",
        lambda force_refresh=False: {
            "repo": "ktdhhc/Aindexer",
            "source": "github_releases",
            "latest_version": "0.1.1",
            "release_name": "v0.1.1",
            "release_url": "https://github.com/ktdhhc/Aindexer/releases/tag/v0.1.1",
            "published_at": "2026-05-09T12:00:00Z",
            "body": "release notes",
            "prerelease": False,
            "draft": False,
            "download_url": "https://example.com/Aindexer-V4-0.1.1-setup.exe",
            "download_filename": "Aindexer V4_0.1.1_x64-setup.exe",
            "download_size": 123,
            "checked_at": "2026-05-09T12:00:00Z",
        },
    )

    client = TestClient(create_app())
    response = client.get("/api/system/updates/latest", params={"current_version": "0.1.0"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["current_version"] == "0.1.0"
    assert payload["latest_version"] == "0.1.1"
    assert payload["has_update"] is True
    assert payload["download_filename"].endswith("setup.exe")


def test_version_compare_supports_v_prefixed_tags() -> None:
    assert system._is_newer_version("0.1.0", "v0.1.1") is True
    assert system._is_newer_version("0.1.1", "v0.1.1") is False


def test_fetch_latest_update_payload_falls_back_to_prerelease_feed(monkeypatch) -> None:
    def fake_get(url: str, **_: object) -> httpx.Response:
        if url == system.UPDATE_API_URL:
            return httpx.Response(404, json={"message": "Not Found"})
        if url == system.UPDATE_RELEASES_API_URL:
            return httpx.Response(
                200,
                json=[
                    {
                        "tag_name": "v0.1.0",
                        "name": "Aindexer v0.1.0",
                        "html_url": "https://github.com/ktdhhc/Aindexer/releases/tag/v0.1.0",
                        "published_at": "2026-05-09T06:50:45Z",
                        "body": "notes",
                        "prerelease": True,
                        "draft": False,
                        "assets": [
                            {
                                "name": "Aindexer.V4_0.1.0_x64-setup.exe",
                                "browser_download_url": "https://github.com/ktdhhc/Aindexer/releases/download/v0.1.0/Aindexer.V4_0.1.0_x64-setup.exe",
                                "size": 123,
                            }
                        ],
                    }
                ],
            )
        raise AssertionError(f"unexpected url: {url}")

    monkeypatch.setattr(system.httpx, "get", fake_get)

    payload = system._fetch_latest_update_payload()

    assert payload["latest_version"] == "0.1.0"
    assert payload["prerelease"] is True
    assert payload["download_filename"].endswith("setup.exe")


def test_fetch_latest_update_payload_falls_back_to_atom_when_rate_limited(monkeypatch) -> None:
    atom_feed = """<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns='http://www.w3.org/2005/Atom'>
  <entry>
    <updated>2026-05-09T06:50:45Z</updated>
    <link rel='alternate' type='text/html' href='https://github.com/ktdhhc/Aindexer/releases/tag/v0.1.0'/>
    <title>Aindexer v0.1.0</title>
    <content type='html'>&lt;h1&gt;Release Notes&lt;/h1&gt;&lt;p&gt;hello&lt;/p&gt;</content>
  </entry>
</feed>
"""
    release_html = '<a href="/ktdhhc/Aindexer/releases/download/v0.1.0/Aindexer.V4_0.1.0_x64-setup.exe">download</a>'

    def fake_get(url: str, **_: object) -> httpx.Response:
        if url == system.UPDATE_API_URL:
            return httpx.Response(
                403,
                headers={"x-ratelimit-remaining": "0"},
                json={"message": "API rate limit exceeded"},
            )
        if url == system.UPDATE_ATOM_URL:
            return httpx.Response(200, text=atom_feed)
        if url == "https://github.com/ktdhhc/Aindexer/releases/tag/v0.1.0":
            return httpx.Response(200, text=release_html)
        raise AssertionError(f"unexpected url: {url}")

    monkeypatch.setattr(system.httpx, "get", fake_get)

    payload = system._fetch_latest_update_payload()

    assert payload["source"] == "github_releases_atom"
    assert payload["latest_version"] == "0.1.0"
    assert payload["body"] == "Release Notes\nhello"
    assert payload["download_url"].endswith("setup.exe")
