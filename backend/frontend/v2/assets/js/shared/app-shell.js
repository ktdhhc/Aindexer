const HEALTHCHECK_URL = '/api/providers';
const HEALTHCHECK_INTERVAL_MS = 15000;

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

export function initAppShell() {
  const page = String(document.body.dataset.page || '').trim();
  document.querySelectorAll('[data-nav-link]').forEach((node) => {
    node.classList.toggle('is-active', node.getAttribute('data-nav-link') === page);
  });
  document.querySelectorAll('[data-current-year]').forEach((node) => {
    node.textContent = String(new Date().getFullYear());
  });

  pingBackend();
  if (backendHealthTimer) {
    window.clearInterval(backendHealthTimer);
  }
  backendHealthTimer = window.setInterval(pingBackend, HEALTHCHECK_INTERVAL_MS);
}
