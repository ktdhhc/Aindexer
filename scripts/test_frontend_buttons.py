"""
test_frontend_buttons.py
验证三个 V2 页面的顶栏/侧栏按钮接入状态
"""

import re
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent / "backend" / "frontend" / "v2"
JS_PAGES = BASE / "assets" / "js" / "pages"
JS_SHARED = BASE / "assets" / "js" / "shared"

PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"

errors = []


def check(label, condition, detail=""):
    if condition:
        print(f"  {PASS}  {label}")
    else:
        print(f"  {FAIL}  {label}" + (f" — {detail}" if detail else ""))
        errors.append(label)


def read(path):
    return Path(path).read_text(encoding="utf-8")


# ── app-shell.js ──────────────────────────────────────────────────────────────
print("\n[app-shell.js]")
shell = read(JS_SHARED / "app-shell.js")
check("exports initAppShell", "export function initAppShell" in shell)
check("binds refreshBtn.onclick", "refreshBtn" in shell and "onclick" in shell)
check("binds themeToggleBtn.onclick", "themeToggleBtn" in shell and "onclick" in shell)
check("binds exportAllBtnSide", "exportAllBtnSide" in shell)
check("binds importAllBtnSide", "importAllBtnSide" in shell)
check("binds backupImportInput", "backupImportInput" in shell)
check("binds exitAppBtn", "exitAppBtn" in shell)
check("calls pingBackend", "pingBackend" in shell)
check("uses window.handleAppRefresh", "window.handleAppRefresh" in shell)

# ── dashboard.js ──────────────────────────────────────────────────────────────
print("\n[dashboard.js]")
dash = read(JS_PAGES / "dashboard.js")
check("defines getCurrentTheme()", "function getCurrentTheme" in dash)
check("defines applyTheme()", "function applyTheme" in dash)
check(
    "defines handleRefresh()",
    "async function handleRefresh" in dash,
    "was deleted in previous session — causes init() crash",
)
check("sets window.handleAppRefresh", "window.handleAppRefresh = handleRefresh" in dash)
check("calls initAppShell()", "initAppShell()" in dash)
check("calls applyTheme in init()", "applyTheme(getCurrentTheme())" in dash)
check("imports exportBackupAll", "exportBackupAll" in dash)
check("imports importBackupAll", "importBackupAll" in dash)
check("imports exitApp", "exitApp" in dash)

# ── index.html ────────────────────────────────────────────────────────────────
print("\n[index.html]")
idx = read(BASE / "index.html")
check("has refreshBtn", 'id="refreshBtn"' in idx)
check("has themeToggleBtn", 'id="themeToggleBtn"' in idx)
check("has themeToggleIcon", 'id="themeToggleIcon"' in idx)
check("has exportAllBtnSide", 'id="exportAllBtnSide"' in idx)
check("has importAllBtnSide", 'id="importAllBtnSide"' in idx)
check("has backupImportInput", 'id="backupImportInput"' in idx)
check("has exitAppBtn", 'id="exitAppBtn"' in idx)
# refreshBtn/themeToggleBtn must NOT use v2-shell-topbar-btn (index.html has no provider-shell.css)
btn_lines = [l for l in idx.splitlines() if "refreshBtn" in l or "themeToggleBtn" in l]
no_shell_class = not any("v2-shell-topbar-btn" in l for l in btn_lines)
check(
    "topbar btns use Tailwind classes (not v2-shell-topbar-btn)",
    no_shell_class,
    "index.html doesn't load provider-shell.css",
)

# ── provider-config.html ──────────────────────────────────────────────────────
print("\n[provider-config.html]")
pc_html = read(BASE / "provider-config.html")
check("has refreshBtn", 'id="refreshBtn"' in pc_html)
check("has themeToggleBtn", 'id="themeToggleBtn"' in pc_html)
check("has themeToggleIcon", 'id="themeToggleIcon"' in pc_html)
check("has exportAllBtnSide", 'id="exportAllBtnSide"' in pc_html)
check("has importAllBtnSide", 'id="importAllBtnSide"' in pc_html)
check("has backupImportInput", 'id="backupImportInput"' in pc_html)
check("has exitAppBtn", 'id="exitAppBtn"' in pc_html)
check("loads provider-shell.css", "provider-shell.css" in pc_html)
check("topbar btns use v2-shell-topbar-btn", "v2-shell-topbar-btn" in pc_html)

# ── provider-config.js ────────────────────────────────────────────────────────
print("\n[provider-config.js]")
pc_js = read(JS_PAGES / "provider-config.js")
check("calls initAppShell()", "initAppShell()" in pc_js)
check("sets window.handleAppRefresh", "window.handleAppRefresh" in pc_js)

# ── words-config.html ─────────────────────────────────────────────────────────
print("\n[words-config.html]")
wc_html = read(BASE / "words-config.html")
check("has refreshBtn", 'id="refreshBtn"' in wc_html)
check("has themeToggleBtn", 'id="themeToggleBtn"' in wc_html)
check("has themeToggleIcon", 'id="themeToggleIcon"' in wc_html)
check("has exportAllBtnSide", 'id="exportAllBtnSide"' in wc_html)
check("has importAllBtnSide", 'id="importAllBtnSide"' in wc_html)
check("has backupImportInput", 'id="backupImportInput"' in wc_html)
check("has exitAppBtn", 'id="exitAppBtn"' in wc_html)
check("loads provider-shell.css", "provider-shell.css" in wc_html)
check("topbar btns use v2-shell-topbar-btn", "v2-shell-topbar-btn" in wc_html)

# ── words-config.js ───────────────────────────────────────────────────────────
print("\n[words-config.js]")
wc_js = read(JS_PAGES / "words-config.js")
check("calls initAppShell()", "initAppShell()" in wc_js)
check("sets window.handleAppRefresh", "window.handleAppRefresh" in wc_js)

# ── provider-shell.css ────────────────────────────────────────────────────────
print("\n[provider-shell.css]")
css = read(BASE / "assets" / "css" / "pages" / "provider-shell.css")
check("defines .v2-shell-topbar-btn", ".v2-shell-topbar-btn" in css)
check("defines .v2-shell-topbar-actions", ".v2-shell-topbar-actions" in css)

# ── Summary ───────────────────────────────────────────────────────────────────
print()
if errors:
    print(f"\033[91m{len(errors)} check(s) FAILED:\033[0m")
    for e in errors:
        print(f"  - {e}")
    sys.exit(1)
else:
    print(f"\033[92mAll checks passed.\033[0m")
