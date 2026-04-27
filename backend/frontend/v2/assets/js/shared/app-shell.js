import { exportBackupAll, importBackupAll } from '../api/export.js';
import { exitApp } from '../api/system.js';

const HEALTHCHECK_URL = '/api/providers';
const HEALTHCHECK_INTERVAL_MS = 15000;
const THEME_KEY = 'aindexer_v2_theme';

let backendHealthTimer = null;

function applyBackendHealth(ok) {
  document.querySelectorAll('[data-backend-indicator]').forEach((node) => {
    node.dataset.state = ok ? 'ok' : 'err';
    node.title = ok ? '后端运行正常' : '后端异常或不可达';
    node.setAttribute('aria-label', ok ? '后端运行正常' : '后端异常或不可达');
  });
}

async function pingBackend() {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(HEALTHCHECK_URL, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    applyBackendHealth(response.ok);
  } catch (_) {
    applyBackendHealth(false);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function getCurrentTheme() {
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch (_) {}
  return 'dark';
}

function applyTheme(theme) {
  console.log('[Shell] applyTheme called with:', theme);
  const nextTheme = theme === 'light' ? 'light' : 'dark';
  const html = document.documentElement;
  
  console.log('[Shell] Before toggle - html classes:', html.className);
  html.classList.toggle('light', nextTheme === 'light');
  html.classList.toggle('dark', nextTheme === 'dark');
  console.log('[Shell] After toggle - html classes:', html.className);
  
  const icon = document.getElementById('themeToggleIcon');
  if (icon) {
    const newIcon = nextTheme === 'light' ? 'dark_mode' : 'light_mode';
    console.log('[Shell] Updating icon to:', newIcon);
    icon.textContent = newIcon;
  } else {
    console.warn('[Shell] themeToggleIcon not found');
  }
  
  const btn = document.getElementById('themeToggleBtn');
  if (btn) {
    const newTitle = nextTheme === 'light' ? '切换到暗色' : '切换到浅色';
    console.log('[Shell] Updating button title to:', newTitle);
    btn.title = newTitle;
  } else {
    console.warn('[Shell] themeToggleBtn not found');
  }
  
  try {
    window.localStorage.setItem(THEME_KEY, nextTheme);
    console.log('[Shell] Theme saved to localStorage:', nextTheme);
  } catch (e) {
    console.error('[Shell] Failed to save theme:', e);
  }
}

function toggleTheme() {
  console.log('[Shell] toggleTheme called, current classes:', document.documentElement.className);
  const isLight = document.documentElement.classList.contains('light');
  console.log('[Shell] Current is light mode:', isLight);
  applyTheme(isLight ? 'dark' : 'light');
  console.log('[Shell] After toggle, classes:', document.documentElement.className);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function handleBackupExport() {
  console.log('[Shell] Triggering backup export...');
  try {
    const result = await exportBackupAll();
    downloadBlob(result.blob, result.filename);
  } catch (error) {
    alert('导出备份失败: ' + (error.message || '未知错误'));
  }
}

function triggerBackupImport() {
  const input = document.getElementById('backupImportInput');
  if (input) {
    input.value = '';
    input.click();
  }
}

async function handleBackupImport(event) {
  const file = event.target?.files?.[0];
  if (!file) return;

  if (!confirm('导入将覆盖当前文件、索引和配置，是否继续？')) {
    event.target.value = '';
    return;
  }

  console.log('[Shell] Triggering backup import...');
  try {
    const result = await importBackupAll(file);
    const message = result.pre_restore_backup
      ? `导入成功，已创建恢复前快照：${result.pre_restore_backup}`
      : '导入成功';
    alert(message);
    window.location.reload();
  } catch (error) {
    alert('导入失败: ' + (error.message || '未知错误'));
  } finally {
    event.target.value = '';
  }
}

async function handleExitApp() {
  if (!confirm('确定退出 Aindexer 吗？')) return;
  
  console.log('[Shell] Triggering app exit...');
  try {
    await exitApp();
    window.setTimeout(() => {
      try { window.open('', '_self'); } catch (_) {}
      try { window.close(); } catch (_) {}
      try { window.location.replace('about:blank'); } catch (_) {}
    }, 200);
  } catch (error) {
    alert('退出失败: ' + (error.message || '未知错误'));
  }
}

export function initAppShell() {
  const page = String(document.body.dataset.page || '').trim();
  document.querySelectorAll('[data-nav-link]').forEach((node) => {
    node.classList.toggle('is-active', node.getAttribute('data-nav-link') === page);
  });
  
  // Apply theme
  applyTheme(getCurrentTheme());

  // Bind topbar
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.onclick = () => {
      console.log('[Shell] Refresh triggered');
      if (typeof window.handleAppRefresh === 'function') {
        window.handleAppRefresh();
      } else {
        window.location.reload();
      }
    };
  }

  const themeBtn = document.getElementById('themeToggleBtn');
  if (themeBtn) {
    themeBtn.onclick = toggleTheme;
    console.log('[Shell] Theme toggle button bound successfully');
  } else {
    console.warn('[Shell] Theme toggle button not found');
  }

  // Bind sidebar
  const exportBtn = document.getElementById('exportAllBtnSide');
  if (exportBtn) exportBtn.onclick = handleBackupExport;

  const importBtn = document.getElementById('importAllBtnSide');
  if (importBtn) importBtn.onclick = triggerBackupImport;

  const importInput = document.getElementById('backupImportInput');
  if (importInput) importInput.onchange = handleBackupImport;

  const exitBtn = document.getElementById('exitAppBtn');
  if (exitBtn) exitBtn.onclick = handleExitApp;

  pingBackend();
  if (backendHealthTimer) {
    window.clearInterval(backendHealthTimer);
  }
  backendHealthTimer = window.setInterval(pingBackend, HEALTHCHECK_INTERVAL_MS);
}
