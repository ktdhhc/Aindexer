from __future__ import annotations

import copy
import html
import httpx
import logging
import os
import json
import re
import signal
import subprocess
import threading
import time
import xml.etree.ElementTree as ET
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

from ..config import DATA_DIR, LOG_DIR, SOURCE_ROOT, ensure_dirs
from ..services.client_state import get_client_state as read_client_state
from ..services.client_state import set_client_state as write_client_state

router = APIRouter()
logger = logging.getLogger(__name__)

UPDATE_REPO = str(os.getenv("AINDEXER_UPDATE_REPO") or "ktdhhc/Aindexer").strip() or "ktdhhc/Aindexer"
UPDATE_API_URL = f"https://api.github.com/repos/{UPDATE_REPO}/releases/latest"
UPDATE_RELEASES_API_URL = f"https://api.github.com/repos/{UPDATE_REPO}/releases"
UPDATE_ATOM_URL = f"https://github.com/{UPDATE_REPO}/releases.atom"
UPDATE_GITHUB_TOKEN = str(os.getenv("AINDEXER_GITHUB_TOKEN") or "").strip()
UPDATE_TIMEOUT = httpx.Timeout(connect=10.0, read=20.0, write=20.0, pool=20.0)
UPDATE_CACHE_TTL_SECONDS = max(60, min(3600, int(os.getenv("AINDEXER_UPDATE_CACHE_TTL") or "900")))
VERSION_PATTERN = re.compile(r"^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$")
ATOM_NS = {"atom": "http://www.w3.org/2005/Atom"}
ASSET_HREF_PATTERN = re.compile(r'href=["\'](?P<href>/[^"\']+/releases/download/[^"\']+?\.(?:exe|msi))["\']', re.IGNORECASE)
HTML_TAG_PATTERN = re.compile(r"<[^>]+>")
UPDATE_CACHE: dict[str, object] = {
    "expires_at": 0.0,
    "payload": None,
}


DEFAULT_TUTORIAL_MARKDOWN = "# Aindexer\n\n当前安装包未附带本地教程文档。\n请联系发布者获取对应版本的使用说明。\n"


def _resolve_tutorial_path() -> str | None:
    candidates = [
        SOURCE_ROOT / "TUTORIAL.md",
        SOURCE_ROOT / "README.md",
    ]
    for p in candidates:
        if p.exists():
            return p.read_text(encoding="utf-8")
    return None


TUTORIAL_MARKDOWN = _resolve_tutorial_path() or DEFAULT_TUTORIAL_MARKDOWN
LAUNCHER_STATE_PATH = DATA_DIR / "runtime" / "launcher_state.json"


def _github_request_headers() -> dict[str, str]:
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "Aindexer Desktop Update Check",
    }
    if UPDATE_GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {UPDATE_GITHUB_TOKEN}"
    return headers


def _normalize_version(value: str) -> str:
    return str(value or "").strip().lstrip("vV")


def _parse_version(value: str) -> tuple[int, int, int] | None:
    matched = VERSION_PATTERN.match(_normalize_version(value))
    if not matched:
        return None
    return (int(matched.group(1)), int(matched.group(2)), int(matched.group(3)))


def _is_newer_version(current_version: str, latest_version: str) -> bool:
    current = _parse_version(current_version)
    latest = _parse_version(latest_version)
    if current and latest:
        return latest > current
    normalized_current = _normalize_version(current_version)
    normalized_latest = _normalize_version(latest_version)
    return bool(normalized_current and normalized_latest and normalized_current != normalized_latest)


def _select_installer_asset(assets: list[dict]) -> dict | None:
    candidates: list[tuple[int, dict]] = []
    for asset in assets:
        if not isinstance(asset, dict):
            continue
        name = str(asset.get("name") or "").strip()
        download_url = str(asset.get("browser_download_url") or "").strip()
        lower_name = name.lower()
        if not name or not download_url:
            continue

        score = -1
        if lower_name.endswith(".exe"):
            score = 100
        elif lower_name.endswith(".msi"):
            score = 80
        if score < 0:
            continue
        if "setup" in lower_name or "installer" in lower_name:
            score += 40
        if "x64" in lower_name or "win64" in lower_name:
            score += 20
        if "windows" in lower_name:
            score += 10
        candidates.append((score, asset))

    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0], reverse=True)
    return candidates[0][1]


def _read_github_error_detail(response: httpx.Response) -> str:
    detail = response.text
    try:
        payload = response.json()
        detail = str(payload.get("message") or detail)
    except Exception:
        pass
    return detail


def _is_github_rate_limited(response: httpx.Response) -> bool:
    if response.status_code not in {403, 429}:
        return False
    if str(response.headers.get("x-ratelimit-remaining") or "").strip() == "0":
        return True
    return "rate limit exceeded" in _read_github_error_detail(response).lower()


def _select_release_from_feed(payload: object) -> dict | None:
    if not isinstance(payload, list):
        return None

    def sort_key(item: dict) -> tuple[str, str]:
        return (str(item.get("published_at") or ""), str(item.get("created_at") or ""))

    releases = [item for item in payload if isinstance(item, dict) and not bool(item.get("draft"))]
    if not releases:
        return None

    published = [item for item in releases if str(item.get("published_at") or "").strip()]
    pool = published or releases
    pool.sort(key=sort_key, reverse=True)
    return pool[0]


def _build_release_payload(payload: dict) -> dict:
    try:
        assets = payload.get("assets") if isinstance(payload, dict) else []
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"检查更新失败：{exc}") from exc

    installer = _select_installer_asset(assets if isinstance(assets, list) else [])
    latest_version = _normalize_version(str(payload.get("tag_name") or payload.get("name") or ""))
    checked_at = datetime.now(UTC).isoformat()

    return {
        "repo": UPDATE_REPO,
        "source": "github_releases",
        "latest_version": latest_version,
        "release_name": str(payload.get("name") or latest_version or "未命名版本"),
        "release_url": str(payload.get("html_url") or ""),
        "published_at": str(payload.get("published_at") or ""),
        "body": str(payload.get("body") or ""),
        "prerelease": bool(payload.get("prerelease")),
        "draft": bool(payload.get("draft")),
        "download_url": str(installer.get("browser_download_url") or "") if installer else "",
        "download_filename": str(installer.get("name") or "") if installer else "",
        "download_size": int(installer.get("size") or 0) if installer else 0,
        "checked_at": checked_at,
    }


def _select_installer_url(urls: list[str]) -> str:
    candidates: list[tuple[int, str]] = []
    for url in urls:
        normalized = str(url or "").strip()
        if not normalized:
            continue
        name = normalized.rsplit("/", 1)[-1]
        lower_name = name.lower()
        score = -1
        if lower_name.endswith(".exe"):
            score = 100
        elif lower_name.endswith(".msi"):
            score = 80
        if score < 0:
            continue
        if "setup" in lower_name or "installer" in lower_name:
            score += 40
        if "x64" in lower_name or "win64" in lower_name:
            score += 20
        if "windows" in lower_name:
            score += 10
        candidates.append((score, normalized))

    if not candidates:
        return ""
    candidates.sort(key=lambda item: item[0], reverse=True)
    return candidates[0][1]


def _scrape_release_asset_urls(release_url: str) -> list[str]:
    if not release_url:
        return []

    try:
        response = httpx.get(release_url, headers=_github_request_headers(), timeout=UPDATE_TIMEOUT)
    except httpx.HTTPError:
        return []

    if response.status_code >= 400:
        return []

    matches = ASSET_HREF_PATTERN.findall(response.text)
    urls: list[str] = []
    for href in matches:
        absolute = href if href.startswith("http") else f"https://github.com{href}"
        if absolute not in urls:
            urls.append(absolute)
    return urls


def _html_fragment_to_text(value: str) -> str:
    normalized = html.unescape(str(value or ""))
    normalized = normalized.replace("<br>", "\n").replace("<br/>", "\n").replace("<br />", "\n")
    normalized = normalized.replace("</p>", "\n\n").replace("</li>", "\n").replace("</h1>", "\n").replace("</h2>", "\n").replace("</h3>", "\n")
    normalized = HTML_TAG_PATTERN.sub("", normalized)
    normalized = normalized.replace("\r", "")
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    return normalized.strip()


def _fetch_update_payload_from_atom_feed() -> dict:
    try:
        response = httpx.get(UPDATE_ATOM_URL, headers=_github_request_headers(), timeout=UPDATE_TIMEOUT)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"检查更新失败：{exc}") from exc

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"检查更新失败：{_read_github_error_detail(response)}")

    try:
        root = ET.fromstring(response.text)
    except ET.ParseError as exc:
        raise HTTPException(status_code=502, detail=f"检查更新失败：无法解析公开 release feed：{exc}") from exc

    entry = root.find("atom:entry", ATOM_NS)
    if entry is None:
        raise HTTPException(status_code=404, detail="当前仓库还没有可用的 GitHub Release")

    title = (entry.findtext("atom:title", default="", namespaces=ATOM_NS) or "").strip()
    release_url = ""
    for link in entry.findall("atom:link", ATOM_NS):
        if (link.get("rel") or "").strip() == "alternate":
            release_url = str(link.get("href") or "").strip()
            break

    updated = (entry.findtext("atom:updated", default="", namespaces=ATOM_NS) or "").strip()
    content_html = (entry.findtext("atom:content", default="", namespaces=ATOM_NS) or "").strip()
    latest_version = _normalize_version(release_url.rsplit("/", 1)[-1] if release_url else title)
    asset_urls = _scrape_release_asset_urls(release_url)
    download_url = _select_installer_url(asset_urls)
    download_filename = download_url.rsplit("/", 1)[-1] if download_url else ""

    return {
        "repo": UPDATE_REPO,
        "source": "github_releases_atom",
        "latest_version": latest_version,
        "release_name": title or latest_version or "未命名版本",
        "release_url": release_url,
        "published_at": updated,
        "body": _html_fragment_to_text(content_html),
        "prerelease": False,
        "draft": False,
        "download_url": download_url,
        "download_filename": download_filename,
        "download_size": 0,
        "checked_at": datetime.now(UTC).isoformat(),
    }


def _fetch_latest_update_payload() -> dict:
    try:
        response = httpx.get(UPDATE_API_URL, headers=_github_request_headers(), timeout=UPDATE_TIMEOUT)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"检查更新失败：{exc}") from exc

    if response.status_code == 200:
        return _build_release_payload(response.json())

    if _is_github_rate_limited(response):
        return _fetch_update_payload_from_atom_feed()

    if response.status_code != 404:
        raise HTTPException(status_code=502, detail=f"检查更新失败：{_read_github_error_detail(response)}")

    try:
        releases_response = httpx.get(
            UPDATE_RELEASES_API_URL,
            headers=_github_request_headers(),
            timeout=UPDATE_TIMEOUT,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"检查更新失败：{exc}") from exc

    if releases_response.status_code >= 400:
        if _is_github_rate_limited(releases_response):
            return _fetch_update_payload_from_atom_feed()
        raise HTTPException(status_code=502, detail=f"检查更新失败：{_read_github_error_detail(releases_response)}")

    release = _select_release_from_feed(releases_response.json())
    if not release:
        raise HTTPException(status_code=404, detail="当前仓库还没有可用的 GitHub Release")

    return _build_release_payload(release)


def _load_latest_update_payload(force_refresh: bool = False) -> dict:
    now = time.time()
    cached_payload = UPDATE_CACHE.get("payload")
    expires_at = float(UPDATE_CACHE.get("expires_at") or 0.0)
    if not force_refresh and isinstance(cached_payload, dict) and now < expires_at:
        return copy.deepcopy(cached_payload)

    payload = _fetch_latest_update_payload()
    UPDATE_CACHE["payload"] = payload
    UPDATE_CACHE["expires_at"] = now + UPDATE_CACHE_TTL_SECONDS
    return copy.deepcopy(payload)


def _download_response_headers(filename: str, size: int) -> dict[str, str]:
    normalized = filename or "Aindexer-latest-setup.exe"
    encoded = quote(normalized)
    headers = {
        "Content-Disposition": f"attachment; filename=\"{normalized}\"; filename*=UTF-8''{encoded}",
    }
    if size > 0:
        headers["Content-Length"] = str(size)
    return headers


def _exit_soon() -> None:
    time.sleep(0.4)
    parent_pid = os.getppid()
    if _should_terminate_parent(parent_pid):
        try:
            os.kill(parent_pid, signal.SIGTERM)
            logger.warning("Exit requested: terminated parent reloader process %s", parent_pid)
            time.sleep(0.15)
        except Exception:
            logger.exception("Failed to terminate parent reloader process %s", parent_pid)
    os._exit(0)


def _read_process_commandline(pid: int) -> str:
    if pid <= 0:
        return ""

    try:
        if os.name == "nt":
            result = subprocess.run(
                [
                    "powershell",
                    "-NoProfile",
                    "-Command",
                    (
                        f"$p = Get-CimInstance Win32_Process -Filter \"ProcessId = {pid}\" "
                        "-ErrorAction SilentlyContinue; if ($p) { $p.CommandLine }"
                    ),
                ],
                capture_output=True,
                text=True,
                timeout=3,
                check=False,
            )
            return (result.stdout or "").strip()

        cmdline_path = Path(f"/proc/{pid}/cmdline")
        if cmdline_path.exists():
            return cmdline_path.read_text(encoding="utf-8", errors="ignore").replace("\x00", " ").strip()
    except Exception:
        logger.exception("Failed to inspect parent process command line for pid=%s", pid)
    return ""


def _should_terminate_parent(parent_pid: int) -> bool:
    cmdline = _read_process_commandline(parent_pid).lower()
    if not cmdline:
        return False
    return "uvicorn" in cmdline and ("--reload" in cmdline or "watchfiles" in cmdline)


def _terminate_launcher_browser() -> None:
    if not LAUNCHER_STATE_PATH.exists():
        return
    try:
        payload = json.loads(LAUNCHER_STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        logger.exception("Failed to read launcher state from %s", LAUNCHER_STATE_PATH)
        return

    browser_pid = int(payload.get("browser_pid") or 0)
    if browser_pid <= 0:
        return

    try:
        os.kill(browser_pid, signal.SIGTERM)
        logger.warning("Exit requested: terminated launcher browser process %s", browser_pid)
    except ProcessLookupError:
        logger.info("Launcher browser process %s already exited", browser_pid)
    except Exception:
        logger.exception("Failed to terminate launcher browser process %s", browser_pid)


@router.post("/exit")
def exit_app() -> dict:
    logger.warning("Exit requested from UI")
    _terminate_launcher_browser()
    t = threading.Thread(target=_exit_soon, daemon=True)
    t.start()
    return {"ok": True, "message": "shutting_down"}


@router.get("/tutorial")
def get_tutorial_markdown() -> dict:
    return {"markdown": TUTORIAL_MARKDOWN}


@router.get("/data_dir")
def get_data_dir() -> dict:
    return {"data_dir": str(DATA_DIR)}


@router.get("/client_state")
def get_client_state() -> dict:
    return read_client_state()


@router.put("/client_state")
def update_client_state(payload: dict = Body(...)) -> dict:
    return write_client_state(payload)


@router.get("/updates/latest")
def get_latest_update(current_version: str = Query(default=""), force_refresh: bool = Query(default=False)) -> dict:
    payload = _load_latest_update_payload(force_refresh=force_refresh)
    normalized_current = _normalize_version(current_version)
    payload["current_version"] = normalized_current
    payload["has_update"] = (
        _is_newer_version(normalized_current, str(payload.get("latest_version") or ""))
        if normalized_current
        else False
    )
    return payload


@router.get("/updates/latest/download")
def download_latest_update_installer(current_version: str = Query(default="")) -> StreamingResponse:
    payload = _load_latest_update_payload(force_refresh=True)
    normalized_current = _normalize_version(current_version)
    latest_version = str(payload.get("latest_version") or "")
    if not normalized_current:
        raise HTTPException(status_code=400, detail="缺少当前版本，无法下载安装包")
    if not _is_newer_version(normalized_current, latest_version):
        raise HTTPException(status_code=409, detail="当前版本已是最新或更高版本，禁止下载安装包")
    download_url = str(payload.get("download_url") or "").strip()
    filename = str(payload.get("download_filename") or "Aindexer-latest-setup.exe").strip()
    size = int(payload.get("download_size") or 0)
    if not download_url:
        raise HTTPException(status_code=404, detail="当前 release 未找到可下载的 Windows 安装包")

    client = httpx.Client(follow_redirects=True, timeout=httpx.Timeout(connect=10.0, read=None, write=30.0, pool=30.0))
    try:
        stream = client.stream("GET", download_url, headers=_github_request_headers())
        response = stream.__enter__()
    except httpx.HTTPError as exc:
        client.close()
        raise HTTPException(status_code=502, detail=f"下载安装包失败：{exc}") from exc

    if response.status_code >= 400:
        stream.__exit__(None, None, None)
        client.close()
        raise HTTPException(status_code=502, detail=f"下载安装包失败：HTTP {response.status_code}")

    media_type = response.headers.get("content-type") or "application/octet-stream"

    def _close_stream() -> None:
        stream.__exit__(None, None, None)
        client.close()

    return StreamingResponse(
        response.iter_bytes(),
        media_type=media_type,
        headers=_download_response_headers(filename, size),
        background=BackgroundTask(_close_stream),
    )


@router.post("/frontend_log")
def write_frontend_log(payload: dict = Body(...)) -> dict:
    ensure_dirs()
    entry = {
        "created_at": datetime.now(UTC).isoformat(),
        "level": str(payload.get("level") or "error")[:40],
        "source": str(payload.get("source") or "frontend")[:120],
        "message": str(payload.get("message") or "")[:4000],
        "stack": str(payload.get("stack") or "")[:8000],
        "url": str(payload.get("url") or "")[:1000],
        "user_agent": str(payload.get("user_agent") or "")[:1000],
    }
    try:
        with (LOG_DIR / "frontend.log").open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to write frontend log: {exc}")
    return {"ok": True}
