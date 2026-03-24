import { initAppShell } from '../shared/app-shell.js?v=20260319-runtime2';
import { listProviders } from '../api/providers.js?v=20260319-runtime2';
import { deleteFile, getFileDetail, listFiles, uploadFile } from '../api/files.js?v=20260319-runtime2';
import { askChatV0 } from '../api/chat.js?v=20260319-runtime2';
import { exportBackupAll, exportDocUrl, importBackupAll } from '../api/export.js?v=20260319-runtime2';
import { cancelIndex, getIndexDetail, getMarkdown, runAll, runIndex, updateIndexEditor } from '../api/index.js?v=20260319-runtime2';
import { searchDocs } from '../api/search.js?v=20260319-runtime2';
import { exitApp } from '../api/system.js?v=20260319-runtime2';
import {
  DEFAULT_PROVIDER_ORDER,
  MODEL_PRESETS,
  getProviderCustomModels,
  getProviderRetry,
} from '../shared/storage.js?v=20260319-runtime2';

const ACTIVE_STATUSES = new Set(['parsing']);
const DASHBOARD_THEME_KEY = 'aindexer_v2_theme';

const state = {
  providers: [],
  files: [],
  searchRows: [],
  selectedProvider: '',
  selectedModel: '',
  selectedRetry: 3,
  currentDocId: '',
  currentPreviewMarkdown: '',
  autoRefreshTimer: null,
  searchDebounceTimer: null,
  searchSortField: 'created',
  searchSortDirection: 'desc',
  editDocId: '',
};

const refs = {
  bgFxLayer: null,
  dashProvider: null,
  dashModel: null,
  dashTopStatus: null,
  runAllBtn: null,
  refreshBtn: null,
  exportAllBtnSide: null,
  importAllBtnSide: null,
  backupImportInput: null,
  footerStatus: null,
  dashIndexedCount: null,
  dashModelCount: null,
  dashboardKeywordCloud: null,
  uploadInput: null,
  uploadDropBox: null,
  uploadEmptyState: null,
  queuePanel: null,
  uploadDragNotice: null,
  uploadState: null,
  queueSummary: null,
  queueRows: null,
  searchInput: null,
  searchBtn: null,
  searchSortTrigger: null,
  searchSortLabel: null,
  searchSortDirectionBtn: null,
  searchSortDirectionIcon: null,
  searchSortMenu: null,
  searchState: null,
  searchRows: null,
  previewDocId: null,
  previewLoadBtn: null,
  previewState: null,
  previewMarkdown: null,
  previewCopyBtn: null,
  previewExportBtn: null,
  previewOriginalBtn: null,
  previewEditBtn: null,
  themeToggleBtn: null,
  themeToggleIcon: null,
  chatMessages: null,
  chatState: null,
  chatQuestion: null,
  chatAskBtn: null,
  exitAppBtn: null,
  editIndexModal: null,
  editModalStatus: null,
  editModalCloseBtn: null,
  editModalCancelBtn: null,
  editModalSaveBtn: null,
  editDisplayName: null,
  editYear: null,
  editGeneratedAt: null,
  editMarkdown: null,
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getCurrentTheme() {
  try {
    const saved = window.localStorage.getItem(DASHBOARD_THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch (_) {
    // ignore storage failures
  }
  return 'dark';
}

function applyTheme(theme) {
  const nextTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.classList.toggle('light', nextTheme === 'light');
  document.documentElement.classList.toggle('dark', nextTheme === 'dark');
  if (refs.themeToggleIcon) {
    refs.themeToggleIcon.textContent = nextTheme === 'light' ? 'dark_mode' : 'light_mode';
  }
  if (refs.themeToggleBtn) {
    refs.themeToggleBtn.title = nextTheme === 'light' ? '切换到暗色' : '切换到浅色';
  }
  try {
    window.localStorage.setItem(DASHBOARD_THEME_KEY, nextTheme);
  } catch (_) {
    // ignore storage failures
  }
}

async function handleRefresh() {
  try {
    await Promise.all([loadFiles(), loadSearchRows(refs.searchInput.value)]);
    setTopStatus('已刷新', 'ok');
  } catch (error) {
    setTopStatus(error.message || '刷新失败', 'err');
  }
}

function formatDateTimeShort(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '');
  const pad = (item) => String(item).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateTimeLocalInput(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (item) => String(item).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getSearchTerms() {
  const q = String(refs.searchInput?.value || '').trim();
  if (!q) return [];
  const terms = q.split(/[\s,，;；]+/g).map((item) => item.trim()).filter(Boolean);
  return [...new Set([q, ...terms])].sort((a, b) => b.length - a.length);
}

function autoresizeTextarea(node) {
  node.style.height = 'auto';
  const next = Math.min(node.scrollHeight, 180);
  node.style.height = `${Math.max(56, next)}px`;
}

async function executeSearch(value) {
  syncSearchInputs(String(value || '').trim());
  await loadSearchRows(refs.searchInput.value, { autoPreviewFirst: true });
}

function bindEvents() {
  refs.dashProvider.addEventListener('change', () => {
    state.selectedProvider = refs.dashProvider.value;
    applyModelSelector(state.selectedProvider, state.selectedModel);
    const retry = getProviderRetry(state.selectedProvider, 3);
    state.selectedRetry = retry;
    refreshChatContextIfIdle();
    if (state.selectedProvider && state.selectedModel) {
      setTopStatus(`就绪 · ${state.selectedProvider} / ${state.selectedModel}`, 'ok');
    } else {
      setTopStatus('未检测到可用 Provider/Model', 'err');
    }
  });

  refs.dashModel.addEventListener('change', () => {
    state.selectedModel = refs.dashModel.value;
    updateControlAvailability();
    refreshChatContextIfIdle();
    if (state.selectedProvider && state.selectedModel) {
      setTopStatus(`就绪 · ${state.selectedProvider} / ${state.selectedModel}`, 'ok');
    } else {
      setTopStatus('未检测到可用 Provider/Model', 'err');
    }
  });

  refs.runAllBtn.addEventListener('click', handleRunAll);
  window.handleAppRefresh = handleRefresh;

  refs.uploadInput.addEventListener('change', handleUploadSelectedFiles);
  refs.uploadEmptyState.addEventListener('click', () => {
    if (refs.uploadInput.disabled) return;
    refs.uploadInput.click();
  });

  refs.uploadDropBox.addEventListener('dragover', (event) => {
    event.preventDefault();
    setDropTargetHighlight(true);
  });
  refs.uploadDropBox.addEventListener('dragleave', () => {
    setDropTargetHighlight(false);
  });
  refs.uploadDropBox.addEventListener('drop', (event) => {
    event.preventDefault();
    setDropTargetHighlight(false);
    const files = [...(event.dataTransfer?.files || [])];
    uploadFiles(files);
  });

  refs.queueRows.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;
    if (!target) return;
    await handleQueueAction(target.getAttribute('data-action') || '', target.getAttribute('data-id') || '');
  });

  refs.dashboardKeywordCloud.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-keyword]') : null;
    if (!target) return;
    await executeSearch(target.getAttribute('data-keyword') || '');
  });

  refs.searchBtn.addEventListener('click', async () => {
    await executeSearch(refs.searchInput.value);
  });
  refs.searchInput.addEventListener('input', () => {
    renderInstrumentPanel();
    renderPreviewContent();
    scheduleSearchReload(true);
  });
  refs.searchInput.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    await executeSearch(refs.searchInput.value);
  });
  refs.searchSortTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSearchSortMenu();
  });
  refs.searchSortDirectionBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    state.searchSortDirection = state.searchSortDirection === 'asc' ? 'desc' : 'asc';
    updateSearchSortControls();
    renderSearchRows();
  });
  refs.searchSortMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    const target = event.target instanceof Element ? event.target.closest('[data-sort-field]') : null;
    if (!target) return;
    state.searchSortField = target.getAttribute('data-sort-field') || 'created';
    updateSearchSortControls();
    closeSearchSortMenu();
    renderSearchRows();
  });
  document.addEventListener('click', (event) => {
    if (!refs.searchSortMenu || refs.searchSortMenu.hidden) return;
    closeSearchSortMenu();
  });

  refs.searchRows.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;
    if (!target) return;
    await handleSearchAction(target.getAttribute('data-action') || '', target.getAttribute('data-id') || '');
  });

  refs.previewLoadBtn.addEventListener('click', async () => {
    await loadPreview(refs.previewDocId.value);
  });
  refs.previewDocId.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    await loadPreview(refs.previewDocId.value);
  });
  refs.previewEditBtn.addEventListener('click', openPreviewEditor);
  refs.previewCopyBtn.addEventListener('click', copyPreview);
  refs.previewOriginalBtn.addEventListener('click', openCurrentOriginal);
  refs.previewExportBtn.addEventListener('click', openCurrentExport);

  refs.editModalCloseBtn.addEventListener('click', closeEditModal);
  refs.editModalCancelBtn.addEventListener('click', closeEditModal);
  refs.editModalSaveBtn.addEventListener('click', savePreviewEditor);
  refs.editIndexModal.addEventListener('click', (event) => {
    if (event.target === refs.editIndexModal) closeEditModal();
  });

  refs.chatQuestion.addEventListener('input', () => autoresizeTextarea(refs.chatQuestion));
  refs.chatQuestion.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleAskChat();
    }
  });
  refs.chatAskBtn.addEventListener('click', handleAskChat);
}

function initBackgroundFx() {
  const darkColors = ['#0ea5e9', '#89ceff', '#10b981', '#f59e0b'];
  const lightColors = ['#60a5fa', '#0ea5e9', '#14b8a6', '#f59e0b'];
  const blobs = [];

  function getPalette() {
    return document.documentElement.classList.contains('light') ? lightColors : darkColors;
  }

  function createBlob() {
    const blob = document.createElement('div');
    blob.className = 'absolute rounded-full mix-blend-screen transition-all duration-[14000ms] ease-in-out';
    blob.style.filter = 'blur(80px)';
    refs.bgFxLayer.appendChild(blob);
    return blob;
  }

  function getTravelPoints() {
    const horizontal = Math.random() > 0.5;
    if (horizontal) {
      const y = 8 + Math.random() * 84;
      const fromLeft = Math.random() > 0.5;
      return fromLeft
        ? { startX: -30, startY: y, endX: 118, endY: Math.max(-8, Math.min(108, y + (Math.random() * 18 - 9))) }
        : { startX: 118, startY: y, endX: -30, endY: Math.max(-8, Math.min(108, y + (Math.random() * 18 - 9))) };
    }

    const x = 8 + Math.random() * 84;
    const fromTop = Math.random() > 0.5;
    return fromTop
      ? { startX: x, startY: -30, endX: Math.max(-8, Math.min(108, x + (Math.random() * 18 - 9))), endY: 118 }
      : { startX: x, startY: 118, endX: Math.max(-8, Math.min(108, x + (Math.random() * 18 - 9))), endY: -30 };
  }

  function primeBlob(blob) {
    const size = Math.random() * (520 - 240) + 240;
    const travel = getTravelPoints();
    const palette = getPalette();
    const color = palette[Math.floor(Math.random() * palette.length)];
    const opacity = Math.random() * 0.14 + 0.16;
    blob.style.transition = 'none';
    blob.style.width = `${size}px`;
    blob.style.height = `${size}px`;
    blob.style.left = `${travel.startX}%`;
    blob.style.top = `${travel.startY}%`;
    blob.style.opacity = '0';
    blob.style.background = `radial-gradient(circle, ${color} 0%, transparent 70%)`;
    return { travel, opacity };
  }

  function animateBlob(blob) {
    const { travel, opacity } = primeBlob(blob);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        blob.style.transition = 'all 14000ms ease-in-out';
        blob.style.left = `${travel.endX}%`;
        blob.style.top = `${travel.endY}%`;
        blob.style.opacity = String(opacity);
      });
    });
  }

  for (let index = 0; index < 8; index += 1) {
    const blob = createBlob();
    blobs.push(blob);
    window.setTimeout(() => animateBlob(blob), index * 600);
  }

  window.setInterval(() => {
    blobs.forEach((blob, index) => {
      window.setTimeout(() => animateBlob(blob), index * 180);
    });
  }, 15000);
}

function cacheRefs() {
  refs.bgFxLayer = document.getElementById('bgFxLayer');
  refs.dashProvider = document.getElementById('dashProvider');
  refs.dashModel = document.getElementById('dashModel');
  refs.dashTopStatus = document.getElementById('dashTopStatus');
  refs.runAllBtn = document.getElementById('runAllBtn');
  refs.refreshBtn = document.getElementById('refreshBtn');
  refs.exportAllBtnSide = document.getElementById('exportAllBtnSide');
  refs.importAllBtnSide = document.getElementById('importAllBtnSide');
  refs.backupImportInput = document.getElementById('backupImportInput');
  refs.footerStatus = document.getElementById('footerStatus');
  refs.dashIndexedCount = document.getElementById('dashIndexedCount');
  refs.dashModelCount = document.getElementById('dashModelCount');
  refs.dashboardKeywordCloud = document.getElementById('dashboardKeywordCloud');
  refs.uploadInput = document.getElementById('uploadInput');
  refs.uploadDropBox = document.getElementById('uploadDropBox');
  refs.uploadEmptyState = document.getElementById('uploadEmptyState');
  refs.queuePanel = document.getElementById('queuePanel');
  refs.uploadDragNotice = document.getElementById('uploadDragNotice');
  refs.uploadState = document.getElementById('uploadState');
  refs.queueSummary = document.getElementById('queueSummary');
  refs.queueRows = document.getElementById('queueRows');
  refs.searchInput = document.getElementById('searchInput');
  refs.searchBtn = document.getElementById('searchBtn');
  refs.searchSortTrigger = document.getElementById('searchSortTrigger');
  refs.searchSortLabel = document.getElementById('searchSortLabel');
  refs.searchSortDirectionBtn = document.getElementById('searchSortDirectionBtn');
  refs.searchSortDirectionIcon = document.getElementById('searchSortDirectionIcon');
  refs.searchSortMenu = document.getElementById('searchSortMenu');
  refs.searchState = document.getElementById('searchState');
  refs.searchRows = document.getElementById('searchRows');
  refs.previewDocId = document.getElementById('previewDocId');
  refs.previewLoadBtn = document.getElementById('previewLoadBtn');
  refs.previewState = document.getElementById('previewState');
  refs.previewMarkdown = document.getElementById('previewMarkdown');
  refs.previewCopyBtn = document.getElementById('previewCopyBtn');
  refs.previewExportBtn = document.getElementById('previewExportBtn');
  refs.previewOriginalBtn = document.getElementById('previewOriginalBtn');
  refs.previewEditBtn = document.getElementById('previewEditBtn');
  refs.themeToggleBtn = document.getElementById('themeToggleBtn');
  refs.themeToggleIcon = document.getElementById('themeToggleIcon');
  refs.chatMessages = document.getElementById('chatMessages');
  refs.chatState = document.getElementById('chatState');
  refs.chatQuestion = document.getElementById('chatQuestion');
  refs.chatAskBtn = document.getElementById('chatAskBtn');
  refs.exitAppBtn = document.getElementById('exitAppBtn');
  refs.editIndexModal = document.getElementById('editIndexModal');
  refs.editModalStatus = document.getElementById('editModalStatus');
  refs.editModalCloseBtn = document.getElementById('editModalCloseBtn');
  refs.editModalCancelBtn = document.getElementById('editModalCancelBtn');
  refs.editModalSaveBtn = document.getElementById('editModalSaveBtn');
  refs.editDisplayName = document.getElementById('editDisplayName');
  refs.editYear = document.getElementById('editYear');
  refs.editGeneratedAt = document.getElementById('editGeneratedAt');
  refs.editMarkdown = document.getElementById('editMarkdown');
}

async function init() {
  cacheRefs();
  applyTheme(getCurrentTheme());
  initAppShell();
  initBackgroundFx();
  updateSearchSortControls();
  bindEvents();
  autoresizeTextarea(refs.chatQuestion);
  renderPreviewContent();

  try {
    await loadProviders();
    await loadFiles();
    await loadSearchRows('', { autoPreviewFirst: true });

    if (!state.selectedProvider || !state.selectedModel) {
      setTopStatus('未检测到可用 Provider/Model', 'err');
    } else {
      setTopStatus(`就绪 · ${state.selectedProvider} / ${state.selectedModel}`, 'ok');
    }

    setUploadState('待上传', 'muted');
    setPreviewState('待加载', 'muted');
    setChatState('待提问', 'muted');
  } catch (error) {
    renderInitialChat();
    setTopStatus(error.message || '初始化失败，请检查 Provider 配置', 'err');
    setUploadState('初始化失败', 'err');
    setSearchState('初始化失败', 'err');
    setPreviewState('初始化失败', 'err');
    setChatState('不可用', 'err');
  }
}

window.addEventListener('beforeunload', () => {
  if (state.autoRefreshTimer) {
    window.clearInterval(state.autoRefreshTimer);
    state.autoRefreshTimer = null;
  }
  if (state.searchDebounceTimer) {
    window.clearTimeout(state.searchDebounceTimer);
    state.searchDebounceTimer = null;
  }
});

init();
