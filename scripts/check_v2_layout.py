import asyncio
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import websockets


ROOT = Path(__file__).resolve().parents[1]
PAGE_URL = "http://127.0.0.1:8000/v2/"
DEBUG_PORT = 9222
DEBUG_BASE = f"http://127.0.0.1:{DEBUG_PORT}"
CHROME_CANDIDATES = (
    Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
)
VIEWPORTS = (
    (1440, 1600),
    (1280, 1200),
    (1100, 980),
)


def debug_endpoint_ready() -> bool:
    try:
        with urllib.request.urlopen(f"{DEBUG_BASE}/json/version", timeout=2) as response:
            return response.status == 200
    except OSError:
        return False


def find_browser() -> Path | None:
    for candidate in CHROME_CANDIDATES:
        if candidate.exists():
            return candidate
    return None


def ensure_browser() -> subprocess.Popen[str] | None:
    if debug_endpoint_ready():
      return None

    browser = find_browser()
    if browser is None:
        raise RuntimeError("未找到 Chrome/Edge，可执行文件缺失。")

    proc = subprocess.Popen(
        [
            str(browser),
            "--headless",
            "--disable-gpu",
            f"--remote-debugging-port={DEBUG_PORT}",
            "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    deadline = time.time() + 10
    while time.time() < deadline:
        if debug_endpoint_ready():
            return proc
        time.sleep(0.2)

    proc.terminate()
    raise RuntimeError("Chrome DevTools 调试端口启动失败。")


def create_target() -> dict:
    request = urllib.request.Request(f"{DEBUG_BASE}/json/new?{PAGE_URL}", method="PUT")
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.load(response)


ASYNC_PROBE = r"""
(() => {
  const addCard = (id) => `
    <article class="rounded-2xl bg-surface-container-lowest/72 border border-white/5 p-4 space-y-3 cursor-pointer">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="text-sm font-semibold text-slate-100">Doc ${id}</div>
          <div class="text-[11px] uppercase tracking-widest text-slate-500">doc-${id}</div>
        </div>
        <span class="shrink-0 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-primary/10 text-primary border border-primary/20">indexed</span>
      </div>
      <div class="text-xs text-slate-400">Year 2026 • Author ${id}</div>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="px-3 py-2 rounded-xl bg-white/5 text-slate-200 text-xs font-semibold">导出</button>
      </div>
    </article>`;

  const searchRows = document.getElementById('searchRows');
  const chatMessages = document.getElementById('chatMessages');
  const preview = document.getElementById('previewMarkdown');
  const searchPanel = document.getElementById('searchPanel');
  const chatPanel = chatMessages.closest('section');
  const rightColumn = document.getElementById('workspaceRightColumn');

  searchRows.innerHTML = Array.from({ length: 28 }, (_, i) => addCard(i + 1)).join('');
  chatMessages.innerHTML = Array.from(
    { length: 18 },
    (_, i) => `<div class="p-4 rounded-2xl bg-surface-container-high border border-white/5 text-sm text-slate-200">message ${i + 1}<br/>${'x '.repeat(80)}</div>`
  ).join('');
  preview.value = Array.from({ length: 120 }, (_, i) => `line ${i + 1} ${'preview '.repeat(10)}`).join('\n');

  searchRows.scrollTop = 400;
  chatMessages.scrollTop = 400;
  preview.scrollTop = 400;

  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    rightDisplay: getComputedStyle(rightColumn).display,
    bottomDiff: Math.round(searchPanel.getBoundingClientRect().bottom - chatPanel.getBoundingClientRect().bottom),
    searchScrollTop: searchRows.scrollTop,
    searchClientHeight: searchRows.clientHeight,
    searchScrollHeight: searchRows.scrollHeight,
    chatScrollTop: chatMessages.scrollTop,
    chatClientHeight: chatMessages.clientHeight,
    chatScrollHeight: chatMessages.scrollHeight,
    previewScrollTop: preview.scrollTop,
    previewClientHeight: preview.clientHeight,
    previewScrollHeight: preview.scrollHeight,
  };
})()
"""


async def send(ws, msg_id: int, method: str, params: dict | None = None) -> tuple[int, dict]:
    msg_id += 1
    await ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
    while True:
        message = json.loads(await ws.recv())
        if message.get("id") == msg_id:
            return msg_id, message


async def probe_viewport(width: int, height: int) -> dict:
    target = create_target()
    ws_url = target["webSocketDebuggerUrl"]
    async with websockets.connect(ws_url, max_size=2**24) as ws:
        msg_id = 0
        msg_id, _ = await send(ws, msg_id, "Page.enable")
        msg_id, _ = await send(ws, msg_id, "Runtime.enable")
        msg_id, _ = await send(
            ws,
            msg_id,
            "Emulation.setDeviceMetricsOverride",
            {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": False},
        )
        msg_id, _ = await send(ws, msg_id, "Page.navigate", {"url": PAGE_URL})
        await asyncio.sleep(2.5)
        msg_id, result = await send(
            ws,
            msg_id,
            "Runtime.evaluate",
            {"expression": ASYNC_PROBE, "returnByValue": True},
        )
        await send(ws, msg_id, "Target.closeTarget", {"targetId": target["id"]})
        return result["result"]["result"]["value"]


def validate(metrics: dict) -> list[str]:
    failures: list[str] = []
    if metrics["rightDisplay"] != "grid":
        failures.append(f"右列未切到 grid，当前为 {metrics['rightDisplay']}")
    if metrics["bottomDiff"] != 0:
        failures.append(f"搜索卡片与 Chat 卡片底边未对齐，差值 {metrics['bottomDiff']}px")

    for name in ("search", "chat", "preview"):
        scroll_top = metrics[f"{name}ScrollTop"]
        client_height = metrics[f"{name}ClientHeight"]
        scroll_height = metrics[f"{name}ScrollHeight"]
        if scroll_height <= client_height:
            failures.append(f"{name} 区域没有形成内部滚动，scrollHeight={scroll_height}, clientHeight={client_height}")
        if scroll_top <= 0:
            failures.append(f"{name} 区域滚动无效，scrollTop={scroll_top}")
    return failures


async def main() -> int:
    browser_proc = ensure_browser()
    overall_failures: list[str] = []

    try:
        for width, height in VIEWPORTS:
            metrics = await probe_viewport(width, height)
            failures = validate(metrics)
            status = "PASS" if not failures else "FAIL"
            print(json.dumps({"status": status, **metrics}, ensure_ascii=False))
            if failures:
                overall_failures.extend([f"{width}x{height}: {item}" for item in failures])
    finally:
        if browser_proc is not None:
            browser_proc.terminate()

    if overall_failures:
        print("\n".join(overall_failures), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
