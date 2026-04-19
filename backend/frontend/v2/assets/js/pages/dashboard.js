import { initAppShell } from '../shared/app-shell.js?v=20260324-dropdown';
import { listProviders } from '../api/providers.js?v=20260324-dropdown';
import { deleteFile, getFileDetail, listFiles, uploadFile } from '../api/files.js?v=20260324-dropdown';
import { askChatV0 } from '../api/chat.js?v=20260324-dropdown';
import { exportBackupAll, exportDocUrl, importBackupAll } from '../api/export.js?v=20260324-dropdown';
import { cancelIndex, getIndexDetail, getMarkdown, runAll, runIndex, updateIndexEditor } from '../api/index.js?v=20260324-dropdown';
import { searchDocs } from '../api/search.js?v=20260324-dropdown';
import { exitApp } from '../api/system.js?v=20260324-dropdown';
import {
  DEFAULT_PROVIDER_ORDER,
  MODEL_PRESETS,
  getProviderCustomModels,
  getProviderRetry,
} from '../shared/storage.js?v=20260324-dropdown';

const ACTIVE_STATUSES = new Set(['parsing']);
const DASHBOARD_THEME_KEY = 'aindexer_v2_theme';

const state = {
  providers: [],
  files: [],
  searchRows: [],
  selectedProvider: '',
  selectedModel: '',
  chatProvider: '',
  chatModel: '',
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
  dashProviderLabel: null,
  dashProviderMenu: null,
  dashModel: null,
  dashModelLabel: null,
  dashModelMenu: null,
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
  chatModelSelector: null,
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

function toProviderKey(provider) {
  return String(provider || '').trim().toLowerCase();
}

function pickAvailableModel(models, preferredModel, fallbackModel) {
  const preferred = String(preferredModel || '').trim();
  if (preferred && models.includes(preferred)) return preferred;
  const fallback = String(fallbackModel || '').trim();
  if (fallback && models.includes(fallback)) return fallback;
  return models[0] || '';
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
  // Provider dropdown toggle
  refs.dashProvider.addEventListener('click', (e) => {
    e.stopPropagation();
    if (refs.dashModelMenu) refs.dashModelMenu.hidden = true;
    if (refs.dashProviderMenu) {
      refs.dashProviderMenu.hidden = !refs.dashProviderMenu.hidden;
    }
  });

  // Provider dropdown item selection
  if (refs.dashProviderMenu) {
    refs.dashProviderMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = e.target.closest('.sort-menu-item');
      if (!item) return;
      const provider = item.dataset.value || '';
      state.selectedProvider = provider;
      if (refs.dashProviderLabel) refs.dashProviderLabel.textContent = provider || '选择 Provider';
      _markDropdownActive(refs.dashProviderMenu, provider);
      refs.dashProviderMenu.hidden = true;
      applyModelSelector(provider, state.selectedModel);
      const retry = getProviderRetry(provider, 3);
      state.selectedRetry = retry;
      refreshChatContextIfIdle();
      if (provider && state.selectedModel) {
        setTopStatus(`就绪 · ${provider} / ${state.selectedModel}`, 'ok');
      } else {
        setTopStatus('未检测到可用 Provider/Model', 'err');
      }
    });
  }

  // Model dropdown toggle
  refs.dashModel.addEventListener('click', (e) => {
    e.stopPropagation();
    if (refs.dashProviderMenu) refs.dashProviderMenu.hidden = true;
    if (refs.dashModelMenu) {
      refs.dashModelMenu.hidden = !refs.dashModelMenu.hidden;
    }
  });

  // Model dropdown item selection
  if (refs.dashModelMenu) {
    refs.dashModelMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = e.target.closest('.sort-menu-item');
      if (!item) return;
      const model = item.dataset.value || '';
      state.selectedModel = model;
      if (refs.dashModelLabel) refs.dashModelLabel.textContent = model || '选择 Model';
      _markDropdownActive(refs.dashModelMenu, model);
      refs.dashModelMenu.hidden = true;
      updateControlAvailability();
      refreshChatContextIfIdle();
      if (state.selectedProvider && model) {
        setTopStatus(`就绪 · ${state.selectedProvider} / ${model}`, 'ok');
      } else {
        setTopStatus('未检测到可用 Provider/Model', 'err');
      }
    });
  }

  // Close dropdowns on outside click
  document.addEventListener('click', () => {
    if (refs.dashProviderMenu) refs.dashProviderMenu.hidden = true;
    if (refs.dashModelMenu) refs.dashModelMenu.hidden = true;
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
    const target = e.target instanceof Element ? e.target.closest('[data-sort-field]') : null;
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
  if (refs.chatModelSelector) {
    refs.chatModelSelector.addEventListener('change', () => {
      const val = refs.chatModelSelector.value || '';
      const [prov, mdl] = val.split('::');
      state.chatProvider = prov || state.selectedProvider || '';
      state.chatModel = mdl || state.selectedModel || '';
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// UI State
// ═══════════════════════════════════════════════════════════════

function setTopStatus(message, type) {
  if (refs.dashTopStatus) {
    const colors = { ok: 'text-green-400', err: 'text-error', muted: 'text-slate-500' };
    refs.dashTopStatus.className = `mt-3 text-[11px] leading-5 min-h-[20px] ${colors[type] || colors.muted}`;
    refs.dashTopStatus.textContent = message;
  }
}

function setUploadState(message, type) {
  if (refs.uploadState) refs.uploadState.textContent = message;
}

function setSearchState(message, type) {
  if (refs.searchState) refs.searchState.textContent = message;
}

function setPreviewState(message, type) {
  if (refs.previewState) refs.previewState.textContent = message;
}

function setChatState(message, type) {
  if (refs.chatState) refs.chatState.textContent = message;
}

// ═══════════════════════════════════════════════════════════════
// Provider / Model
// ═══════════════════════════════════════════════════════════════

async function loadProviders() {
  const providers = await listProviders();
  state.providers = providers;

  const menu = refs.dashProviderMenu;
  if (!menu) return;
  menu.innerHTML = '';

  const enabled = providers.filter((p) => p.enabled !== false);
  if (!enabled.length) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sort-menu-item';
    btn.textContent = '无可用 Provider';
    menu.appendChild(btn);
    state.selectedProvider = '';
    if (refs.dashProviderLabel) refs.dashProviderLabel.textContent = '无可用 Provider';
    applyModelSelector('', null);
    return;
  }

  const order = DEFAULT_PROVIDER_ORDER;
  enabled.sort((a, b) => {
    const ia = order.indexOf(toProviderKey(a.provider));
    const ib = order.indexOf(toProviderKey(b.provider));
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  for (const p of enabled) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sort-menu-item';
    btn.dataset.value = p.provider;
    btn.innerHTML = `<span class="sort-menu-item-label">${escapeHtml(p.provider)}</span><span class="material-symbols-outlined text-[14px] check-icon hidden">check</span>`;
    menu.appendChild(btn);
  }

  const availableProviders = enabled.map((p) => String(p.provider || '').trim()).filter(Boolean);
  if (!availableProviders.includes(state.selectedProvider)) {
    state.selectedProvider = availableProviders[0] || '';
  }
  if (refs.dashProviderLabel) refs.dashProviderLabel.textContent = state.selectedProvider;
  _markDropdownActive(menu, state.selectedProvider);
  applyModelSelector(state.selectedProvider, state.selectedModel);

  const counts = enabled.map((p) => {
    const providerKey = toProviderKey(p.provider);
    const presets = new Set(MODEL_PRESETS[providerKey] || []);
    const custom = new Set(getProviderCustomModels(providerKey));
    if (p.model) presets.add(p.model);
    return new Set([...presets, ...custom]).size;
  });
  if (refs.dashModelCount) refs.dashModelCount.textContent = String(counts.reduce((s, c) => s + c, 0));

  state.selectedRetry = getProviderRetry(state.selectedProvider, 3);
  populateChatModelSelector();
}

function populateChatModelSelector() {
  const select = refs.chatModelSelector;
  if (!select) return;
  select.innerHTML = '';

  const enabled = state.providers.filter((p) => p.enabled !== false);
  if (!enabled.length) {
    const opt = document.createElement('option');
    opt.textContent = '无可用模型';
    opt.value = '';
    select.appendChild(opt);
    state.chatProvider = '';
    state.chatModel = '';
    return;
  }

  const order = DEFAULT_PROVIDER_ORDER;
  enabled.sort((a, b) => {
    const ia = order.indexOf(toProviderKey(a.provider));
    const ib = order.indexOf(toProviderKey(b.provider));
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  let foundCurrent = false;
  for (const p of enabled) {
    const providerKey = toProviderKey(p.provider);
    const presets = MODEL_PRESETS[providerKey] || [];
    const custom = getProviderCustomModels(providerKey);
    const models = [...new Set([...presets, ...custom])];
    if (!models.length && p.model) models.push(p.model);

    for (const model of models) {
      const opt = document.createElement('option');
      opt.value = `${p.provider}::${model}`;
      opt.textContent = `${p.provider} / ${model}`;
      select.appendChild(opt);
      if (p.provider === state.chatProvider && model === state.chatModel) {
        foundCurrent = true;
      }
    }
  }

  if (!foundCurrent || !state.chatProvider || !state.chatModel) {
    const firstOpt = select.querySelector('option');
    if (firstOpt) {
      const [prov, mdl] = firstOpt.value.split('::');
      state.chatProvider = prov;
      state.chatModel = mdl;
    }
  }
  select.value = `${state.chatProvider}::${state.chatModel}`;
}

function _markDropdownActive(menu, value) {
  if (!menu) return;
  menu.querySelectorAll('.sort-menu-item[data-value]').forEach((btn) => {
    const isActive = btn.dataset.value === value;
    btn.classList.toggle('is-active', isActive);
    const check = btn.querySelector('.check-icon');
    if (check) check.classList.toggle('hidden', !isActive);
  });
}

function applyModelSelector(provider, currentModel) {
  const menu = refs.dashModelMenu;
  if (!menu) return;
  menu.innerHTML = '';

  const providerName = String(provider || '').trim();
  if (!providerName) {
    state.selectedModel = '';
    if (refs.dashModelLabel) refs.dashModelLabel.textContent = '选择 Model';
    updateControlAvailability();
    return;
  }

  const providerKey = toProviderKey(providerName);
  const presets = MODEL_PRESETS[providerKey] || [];
  const custom = getProviderCustomModels(providerKey);
  const cfg = state.providers.find((p) => toProviderKey(p.provider) === providerKey);
  const cfgModel = cfg ? cfg.model : '';

  const all = [...new Set([...presets, ...custom])];
  if (cfgModel && !all.includes(cfgModel)) all.unshift(cfgModel);

  if (!all.length) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sort-menu-item';
    btn.textContent = '无可用模型';
    menu.appendChild(btn);
    state.selectedModel = '';
    if (refs.dashModelLabel) refs.dashModelLabel.textContent = '无可用模型';
    updateControlAvailability();
    return;
  }

  for (const model of all) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sort-menu-item';
    btn.dataset.value = model;
    btn.innerHTML = `<span class="sort-menu-item-label">${escapeHtml(model)}</span><span class="material-symbols-outlined text-[14px] check-icon hidden">check</span>`;
    menu.appendChild(btn);
  }

  state.selectedModel = pickAvailableModel(all, currentModel, cfgModel);
  if (refs.dashModelLabel) refs.dashModelLabel.textContent = state.selectedModel;
  _markDropdownActive(menu, state.selectedModel);

  state.selectedRetry = getProviderRetry(providerName, 3);
  updateControlAvailability();
}

function updateControlAvailability() {
  if (refs.runAllBtn) {
    const ok = !!state.selectedProvider && !!state.selectedModel;
    refs.runAllBtn.disabled = !ok;
    refs.runAllBtn.style.opacity = ok ? '1' : '0.5';
  }
}

function refreshChatContextIfIdle() {
  // placeholder
}

// ═══════════════════════════════════════════════════════════════
// File Queue
// ═══════════════════════════════════════════════════════════════

async function loadFiles() {
  state.files = await listFiles();
  renderQueuePanel();

  const indexed = state.files.filter((f) => f.status === 'indexed').length;
  if (refs.dashIndexedCount) refs.dashIndexedCount.textContent = String(indexed);

  const hasActive = state.files.some((f) => ['parsing', 'queued', 'llm_request', 'writing'].includes(f.stage));
  if (hasActive && !state.autoRefreshTimer) {
    state.autoRefreshTimer = window.setInterval(async () => {
      try {
        state.files = await listFiles();
        renderQueuePanel();
        const newIndexed = state.files.filter((f) => f.status === 'indexed').length;
        if (refs.dashIndexedCount) refs.dashIndexedCount.textContent = String(newIndexed);
      } catch (_) {}

      const stillActive = state.files.some((f) => ['parsing', 'queued', 'llm_request', 'writing'].includes(f.stage));
      if (!stillActive) {
        window.clearInterval(state.autoRefreshTimer);
        state.autoRefreshTimer = null;
        await loadSearchRows(refs.searchInput?.value || '', { autoPreviewFirst: true });
        setTopStatus(`索引完成 · ${state.files.filter((f) => f.status === 'indexed').length} 篇`, 'ok');
      }
    }, 3000);
  }
}

function renderQueuePanel() {
  const pending = state.files.filter((f) => f.status !== 'indexed' && f.status !== 'needs_review');
  const hasPending = pending.length > 0;

  if (refs.queueSummary) {
    const active = state.files.filter((f) => ACTIVE_STATUSES.has(f.stage) && f.status === 'parsing').length;
    refs.queueSummary.textContent = active > 0 ? `${active} 生成中` : `${pending.length} 待处理`;
  }

  if (refs.uploadEmptyState) refs.uploadEmptyState.style.display = hasPending ? 'none' : 'flex';
  if (refs.queuePanel) {
    if (hasPending) {
      refs.queuePanel.style.display = 'flex';
      refs.queuePanel.classList.remove('hidden');
    } else {
      refs.queuePanel.style.display = 'none';
      refs.queuePanel.classList.add('hidden');
    }
  }

  renderQueueRows();
}

function renderQueueRows() {
  if (!refs.queueRows) return;

  const pending = state.files.filter((f) => f.status !== 'indexed' && f.status !== 'needs_review');
  if (!pending.length) {
    refs.queueRows.innerHTML = '<p class="text-xs text-slate-500">无待处理文件</p>';
    return;
  }

  const statusMap = {
    uploaded: { label: '已上传', color: 'text-slate-400' },
    parsing: { label: '索引中...', color: 'text-blue-400' },
    queued: { label: '排队中', color: 'text-blue-300' },
    llm_request: { label: '请求模型', color: 'text-blue-300' },
    writing: { label: '写入中', color: 'text-sky-300' },
    cancel_requested: { label: '取消中', color: 'text-amber-400' },
    cancelled: { label: '已取消', color: 'text-slate-500' },
    needs_review: { label: '需审核', color: 'text-amber-400' },
    failed: { label: '失败', color: 'text-error' },
  };

  const html = pending
    .map((file) => {
      const info = statusMap[file.status] || { label: file.status, color: 'text-slate-400' };
      const displayName = escapeHtml(file.display_name || file.filename);
      const isIndexing = ACTIVE_STATUSES.has(file.stage) && file.status === 'parsing';
      const isCancelled = file.status === 'cancelled' || file.stage === 'cancel_requested';

      return `<div class="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] group">
        <div class="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center shrink-0">
          <span class="material-symbols-outlined text-sm text-slate-500">description</span>
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium text-slate-300 truncate">${displayName}</div>
          <div class="text-[11px] ${info.color}">${info.label}${file.stage_message ? ` · ${escapeHtml(file.stage_message)}` : ''}</div>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          ${isIndexing ? `<button data-action="cancel" data-id="${file.id}" class="px-2 py-1 rounded-lg text-xs text-amber-400 hover:bg-amber-400/10 transition" title="取消">取消</button>` : ''}
          ${!isIndexing ? `<button data-action="index" data-id="${file.id}" class="px-2 py-1 rounded-lg text-xs text-primary hover:bg-primary/10 transition" title="索引">索引</button>` : ''}
          ${!isCancelled ? `<button data-action="delete" data-id="${file.id}" class="px-2 py-1 rounded-lg text-xs text-error hover:bg-error/10 transition" title="删除">删除</button>` : ''}
        </div>
      </div>`;
    })
    .join('');

  refs.queueRows.innerHTML = html;
}

async function handleUploadSelectedFiles(event) {
  const files = [...(event.target?.files || [])];
  if (!files.length) return;
  await uploadFiles(files);
  event.target.value = '';
}

async function uploadFiles(files) {
  setUploadState(`上传中 (0/${files.length})`, 'muted');
  setDropTargetHighlight(false);
  let done = 0;
  let errs = 0;

  for (const file of files) {
    try {
      const res = await uploadFile(file);
      state.files.unshift({
        id: res.doc_id,
        filename: file.name,
        display_name: file.name,
        file_type: file.name.split('.').pop()?.toLowerCase() || '',
        status: res.duplicate ? 'duplicate' : 'uploaded',
        stage: 'uploaded',
        stage_message: res.duplicate ? '文件已存在' : '文件上传完成',
        error_message: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      done += 1;
    } catch (err) {
      errs += 1;
      state.files.unshift({
        id: `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        filename: file.name,
        display_name: file.name,
        file_type: '',
        status: 'failed',
        stage: 'failed',
        stage_message: '上传失败',
        error_message: err.message,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
    setUploadState(`上传中 (${done + errs}/${files.length})`, 'muted');
  }

  const msg = `上传完成: ${done} 成功` + (errs > 0 ? `, ${errs} 失败` : '');
  setUploadState(msg, errs > 0 ? 'err' : 'muted');
  renderQueuePanel();
  await loadFiles();
}

function setDropTargetHighlight(active) {
  const notice = refs.uploadDragNotice;
  const box = refs.uploadDropBox;
  if (notice) {
    notice.style.display = active ? 'flex' : 'none';
    notice.classList.toggle('hidden', !active);
  }
  if (box) {
    box.classList.toggle('is-dragover', active);
  }
}

async function handleQueueAction(action, docId) {
  if (!docId) return;

  if (action === 'index') {
    if (!state.selectedProvider || !state.selectedModel) {
      setTopStatus('请先选择 Provider 和 Model', 'err');
      return;
    }
    await runIndex(docId, state.selectedProvider, state.selectedModel, state.selectedRetry);
    setTopStatus(`索引已启动`, 'ok');
  } else if (action === 'cancel') {
    await cancelIndex(docId);
    setTopStatus('取消请求已发送', 'muted');
  } else if (action === 'delete') {
    if (!confirm(`确认删除文件？`)) return;
    await deleteFile(docId);
    state.files = state.files.filter((f) => f.id !== docId);
    if (state.currentDocId === docId) {
      state.currentDocId = '';
      state.currentPreviewMarkdown = '';
      renderPreviewContent();
    }
    setTopStatus('文件已删除', 'muted');
  }

  renderQueuePanel();
  await loadSearchRows(refs.searchInput?.value || '');
}

async function handleRunAll() {
  if (!state.selectedProvider || !state.selectedModel) {
    setTopStatus('请先选择 Provider 和 Model', 'err');
    return;
  }
  if (refs.runAllBtn) {
    refs.runAllBtn.disabled = true;
    refs.runAllBtn.style.opacity = '0.5';
  }
  try {
    const res = await runAll(state.selectedProvider, state.selectedModel, state.selectedRetry);
    setTopStatus(`批量索引已启动: ${res.queued} 条, 跳过 ${res.skipped}`, 'ok');
    await loadFiles();
  } catch (err) {
    setTopStatus(err.message || '批量索引失败', 'err');
  } finally {
    updateControlAvailability();
  }
}

// ═══════════════════════════════════════════════════════════════
// Search
// ═══════════════════════════════════════════════════════════════

async function loadSearchRows(query, { autoPreviewFirst } = {}) {
  setSearchState('搜索中...', 'muted');
  try {
    state.searchRows = await searchDocs(query);
    renderSearchRows();
    setSearchState(state.searchRows.length > 0 ? `共 ${state.searchRows.length} 条` : '无结果', 'muted');
    renderInstrumentPanel();

    if (autoPreviewFirst && state.searchRows.length > 0) {
      const first = state.searchRows.find((r) => r.status === 'indexed');
      if (first) await loadPreview(first.doc_id);
    }
  } catch (err) {
    setSearchState(err.message || '搜索失败', 'err');
  }
}

function syncSearchInputs(value) {
  if (refs.searchInput) refs.searchInput.value = value;
}

function scheduleSearchReload(immediate) {
  if (state.searchDebounceTimer) {
    window.clearTimeout(state.searchDebounceTimer);
    state.searchDebounceTimer = null;
  }
  state.searchDebounceTimer = window.setTimeout(() => loadSearchRows(refs.searchInput?.value || ''), immediate ? 150 : 500);
}

function renderSearchRows() {
  if (!refs.searchRows) return;
  const rows = state.searchRows;
  if (!rows.length) {
    refs.searchRows.innerHTML = '<p class="text-xs text-slate-500">无搜索结果</p>';
    return;
  }

  const sorted = [...rows];
  const dir = state.searchSortDirection === 'asc' ? 1 : -1;
  sorted.sort((a, b) => {
    if (state.searchSortField === 'created') {
      return dir * ((a.created_at || '').localeCompare(b.created_at || ''));
    }
    if (state.searchSortField === 'year') {
      return dir * ((a.year || 0) - (b.year || 0));
    }
    return dir * (a.display_name || a.title || '').localeCompare(b.display_name || b.title || '');
  });

  const query = String(refs.searchInput?.value || '').trim();
  const terms = query
    ? [...new Set([query, ...query.split(/[\s,，;；]+/g).map((t) => t.trim()).filter(Boolean)])].sort((a, b) => b.length - a.length)
    : [];

  const statusColors = {
    indexed: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    parsing: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    uploaded: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
    needs_review: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    failed: 'bg-red-500/20 text-error border-red-500/30',
    cancelled: 'bg-slate-500/20 text-slate-500 border-slate-500/30',
  };
  const statusLabels = { indexed: '已索引', parsing: '索引中', uploaded: '已上传', needs_review: '需审核', failed: '失败', cancelled: '已取消' };

  const html = sorted
    .map((r) => {
      const authors = (r.authors || []).slice(0, 3).join(', ') || '<span class="text-slate-600">-</span>';
      const sc = statusColors[r.status] || 'bg-slate-500/20 text-slate-400 border-slate-500/30';
      const sl = statusLabels[r.status] || r.status;
      const display = escapeHtml(r.display_name || r.title || r.filename || '未命名');
      const yearStr = r.year ? ` · ${r.year}` : '';
      const isActive = r.doc_id === state.currentDocId;
      const keywords = (r.keywords || []).slice(0, 3).map((k) => `<span class="px-1.5 py-0.5 rounded bg-white/[0.04] text-[10px] text-slate-400">${escapeHtml(k)}</span>`).join('');

      return `<div class="p-3 rounded-xl border transition-colors ${isActive ? 'bg-primary/10 border-primary/20' : 'bg-white/[0.03] border-white/[0.06] hover:border-white/[0.12]'}">
        <div class="flex items-start justify-between gap-2 mb-2">
          <div class="flex-1 min-w-0">
            <h4 class="text-sm font-medium text-slate-200 truncate" title="${display}">${highlightTerms(display, terms)}</h4>
            <p class="text-[11px] text-slate-500 mt-0.5">${highlightTerms(escapeHtml(authors), terms)}${yearStr}</p>
          </div>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold border ${sc}">${escapeHtml(sl)}</span>
        </div>
        ${keywords ? `<div class="flex flex-wrap gap-1 mb-2">${keywords}</div>` : ''}
        <div class="flex items-center gap-2 mt-2">
          ${r.status === 'indexed' ? `<button data-action="preview" data-id="${r.doc_id}" class="text-[11px] text-primary hover:underline">预览</button>` : ''}
          ${r.status === 'indexed' ? `<button data-action="export" data-id="${r.doc_id}" class="text-[11px] text-slate-400 hover:text-white">导出</button>` : ''}
          <button data-action="delete" data-id="${r.doc_id}" class="text-[11px] text-slate-500 hover:text-error">删除</button>
        </div>
      </div>`;
    })
    .join('');

  refs.searchRows.innerHTML = html;
}

function handleSearchAction(action, docId) {
  if (!docId) return;
  if (action === 'preview') loadPreview(docId);
  else if (action === 'export') window.open(exportDocUrl(docId), '_blank');
  else if (action === 'delete') {
    if (!confirm('确认删除此文件？')) return;
    deleteFile(docId).then(() => {
      state.searchRows = state.searchRows.filter((r) => r.doc_id !== docId);
      renderSearchRows();
      loadFiles();
      if (state.currentDocId === docId) {
        state.currentDocId = '';
        state.currentPreviewMarkdown = '';
        renderPreviewContent();
      }
    });
  }
}

function updateSearchSortControls() {
  if (refs.searchSortLabel) {
    const labels = { created: '生成时间', year: '年份', display: '显示名' };
    refs.searchSortLabel.textContent = labels[state.searchSortField] || '排序';
  }
  if (refs.searchSortDirectionIcon) {
    refs.searchSortDirectionIcon.textContent = state.searchSortDirection === 'asc' ? 'north' : 'south';
  }
  if (refs.searchSortMenu) {
    refs.searchSortMenu.querySelectorAll('[data-sort-field]').forEach((node) => {
      const isActive = node.getAttribute('data-sort-field') === state.searchSortField;
      node.classList.toggle('is-active', isActive);
      const indicator = node.querySelector('.active-indicator');
      if (indicator) indicator.classList.toggle('hidden', !isActive);
    });
  }
}

function toggleSearchSortMenu() {
  if (!refs.searchSortMenu) return;
  refs.searchSortMenu.hidden = !refs.searchSortMenu.hidden;
}

function closeSearchSortMenu() {
  if (refs.searchSortMenu) refs.searchSortMenu.hidden = true;
}

function renderInstrumentPanel() {
  if (!refs.dashboardKeywordCloud) return;
  const results = state.searchRows;
  if (!results.length) {
    refs.dashboardKeywordCloud.innerHTML = '<p class="text-xs text-slate-500 text-center py-8">暂无语义分布</p>';
    return;
  }

  const kwMap = new Map();
  for (const r of results) {
    for (const kw of r.keywords || []) {
      kwMap.set(kw, (kwMap.get(kw) || 0) + 1);
    }
  }
  const keywords = [...kwMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  if (!keywords.length) {
    refs.dashboardKeywordCloud.innerHTML = '<p class="text-xs text-slate-500 text-center py-8">暂无语义分布</p>';
    return;
  }

  const maxFreq = Math.max(...keywords.map(([, c]) => c));
  const positions = [
    { x: 50, y: 48 },
    { x: 20, y: 25 },
    { x: 78, y: 22 },
    { x: 32, y: 72 },
    { x: 68, y: 75 },
    { x: 12, y: 50 },
    { x: 88, y: 52 },
    { x: 42, y: 20 },
    { x: 58, y: 82 },
    { x: 25, y: 85 },
    { x: 75, y: 12 },
    { x: 8, y: 78 },
    { x: 92, y: 35 },
    { x: 38, y: 58 },
    { x: 62, y: 38 },
    { x: 15, y: 35 },
    { x: 85, y: 68 },
    { x: 45, y: 90 },
    { x: 55, y: 10 },
    { x: 5, y: 60 },
  ];

  const html = keywords.map(([keyword, count], i) => {
    const ratio = count / maxFreq;
    const size = Math.max(0.6, Math.min(1.1, 0.6 + ratio * 0.5));
    const opacity = Math.max(0.45, 0.45 + ratio * 0.55);
    const pos = positions[i % positions.length];
    return `<div class="instrument-cloud-chip text-xs"
      style="left:${pos.x}%;top:${pos.y}%;font-size:${size}rem;opacity:${opacity}"
      data-keyword="${escapeHtml(keyword)}">${escapeHtml(keyword)}</div>`;
  }).join('');

  refs.dashboardKeywordCloud.innerHTML = html;
}

function highlightTerms(text, terms) {
  if (!terms.length) return text;
  const pattern = terms.map((t) => escapeRegExp(t)).join('|');
  try {
    return text.replace(new RegExp(`(${pattern})`, 'gi'), '<mark>$1</mark>');
  } catch {
    return text;
  }
}

// ═══════════════════════════════════════════════════════════════
// Preview
// ═══════════════════════════════════════════════════════════════

async function loadPreview(docId) {
  if (!docId) return;
  state.currentDocId = docId;
  state.currentPreviewMarkdown = '';
  setPreviewState('加载中...', 'muted');

  try {
    const data = await getMarkdown(docId);
    state.currentPreviewMarkdown = data.markdown || '';
    renderPreviewContent();
    setPreviewState(state.currentPreviewMarkdown ? '已加载' : '无索引内容', 'muted');
  } catch (err) {
    setPreviewState(err.message || '加载失败', 'err');
  }

  if (refs.previewDocId) refs.previewDocId.value = docId;
  renderSearchRows();
}

function renderPreviewContent() {
  if (!refs.previewMarkdown) return;
  if (state.currentPreviewMarkdown) {
    let html = escapeHtml(state.currentPreviewMarkdown);
    const terms = getSearchTerms();
    if (terms.length) {
      html = html.replace(new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi'), '<mark>$1</mark>');
    }
    refs.previewMarkdown.innerHTML = html;
  } else {
    refs.previewMarkdown.innerHTML = '<span class="text-slate-500">这里显示 Markdown 索引内容</span>';
  }
}

async function openPreviewEditor() {
  if (!state.currentDocId) {
    setTopStatus('请先加载一个文献', 'err');
    return;
  }
  state.editDocId = state.currentDocId;

  let detail = { display_name: '', year: '', updated_at: '' };
  try {
    detail = await getIndexDetail(state.currentDocId);
    if (refs.editDisplayName) refs.editDisplayName.value = detail.display_name || state.currentDocId;
    if (refs.editYear) refs.editYear.value = detail.year || '';
    if (refs.editGeneratedAt && detail.updated_at) {
      const d = new Date(detail.updated_at);
      if (!isNaN(d.getTime())) {
        const pad = (n) => String(n).padStart(2, '0');
        refs.editGeneratedAt.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      }
    }
  } catch (_) {
    try {
      detail = await getFileDetail(state.currentDocId);
      if (refs.editDisplayName) refs.editDisplayName.value = detail.display_name || state.currentDocId;
      if (refs.editYear) refs.editYear.value = detail.year || '';
    } catch (_) {}
  }

  if (refs.editMarkdown) refs.editMarkdown.value = state.currentPreviewMarkdown;
  if (refs.editIndexModal) {
    refs.editIndexModal.classList.add('is-open');
    refs.editIndexModal.setAttribute('aria-hidden', 'false');
  }
}

function closeEditModal() {
  if (refs.editIndexModal) {
    refs.editIndexModal.classList.remove('is-open');
    refs.editIndexModal.setAttribute('aria-hidden', 'true');
  }
  state.editDocId = '';
}

async function savePreviewEditor() {
  const docId = state.editDocId;
  if (!docId) return;

  const payload = {
    markdown: refs.editMarkdown?.value || '',
    display_name: refs.editDisplayName?.value || '',
    year: refs.editYear?.value ? Number(refs.editYear.value) : null,
    generated_at: refs.editGeneratedAt?.value || '',
  };

  try {
    if (refs.editModalSaveBtn) {
      refs.editModalSaveBtn.disabled = true;
      refs.editModalSaveBtn.style.opacity = '0.6';
    }
    if (refs.editModalStatus) refs.editModalStatus.textContent = '保存中...';

    await updateIndexEditor(docId, payload);
    closeEditModal();
    state.currentPreviewMarkdown = payload.markdown;
    renderPreviewContent();
    setTopStatus('已保存', 'ok');
    setPreviewState('已更新', 'muted');
    await loadSearchRows(refs.searchInput?.value || '');
    await loadFiles();
  } catch (err) {
    setTopStatus(err.message || '保存失败', 'err');
    if (refs.editModalStatus) refs.editModalStatus.textContent = err.message || '保存失败';
  } finally {
    if (refs.editModalSaveBtn) {
      refs.editModalSaveBtn.disabled = false;
      refs.editModalSaveBtn.style.opacity = '1';
    }
  }
}

function copyPreview() {
  if (!state.currentPreviewMarkdown) {
    setTopStatus('无内容可复制', 'err');
    return;
  }
  navigator.clipboard.writeText(state.currentPreviewMarkdown).then(
    () => setTopStatus('已复制到剪贴板', 'ok'),
    () => setTopStatus('复制失败', 'err')
  );
}

function openCurrentOriginal() {
  if (!state.currentDocId) {
    setTopStatus('请先加载一个文献', 'err');
    return;
  }
  window.open(`/api/files/${state.currentDocId}/original`, '_blank');
}

function openCurrentExport() {
  if (!state.currentDocId) {
    setTopStatus('请先加载一个文献', 'err');
    return;
  }
  window.open(exportDocUrl(state.currentDocId), '_blank');
}

// ═══════════════════════════════════════════════════════════════
// Chat
// ═══════════════════════════════════════════════════════════════

function renderInitialChat() {
  if (!refs.chatMessages) return;
  refs.chatMessages.innerHTML = `<div class="flex justify-start">
    <div class="flex gap-3 max-w-[80%]">
      <div class="w-7 h-7 rounded-full bg-gradient-to-tr from-secondary to-primary-container flex items-center justify-center shrink-0"><span class="material-symbols-outlined text-white text-xs">auto_awesome</span></div>
      <div class="bg-white/[0.04] border border-white/[0.06] rounded-2xl rounded-tl-lg px-4 py-3"><p class="text-sm text-slate-400">你好，我是你的文献智能助手。请先上传文献并完成索引，然后即可向我提问。</p></div>
    </div>
  </div>`;
}

function renderChatBubble(role, content) {
  const isUser = role === 'user';
  const wrapper = document.createElement('div');
  wrapper.className = `flex ${isUser ? 'justify-end' : 'justify-start'}`;

  const bubble = document.createElement('div');
  bubble.className = `max-w-[80%] ${isUser ? 'bg-primary/10 border border-primary/20 rounded-2xl rounded-tr-lg px-4 py-3' : 'bg-white/[0.04] border border-white/[0.06] rounded-2xl rounded-tl-lg px-4 py-3'}`;

  if (isUser) {
    bubble.innerHTML = `<p class="text-sm text-slate-200 whitespace-pre-wrap">${escapeHtml(content)}</p>`;
  } else {
    let formatted = escapeHtml(content).replace(/\n{3,}/g, '\n\n');
    formatted = formatted.replace(/\n/g, '<br>');
    formatted = formatted.replace(/((?:^|<br>)\d+\.\s)/g, '<br>$1');
    bubble.innerHTML = `<p class="text-sm text-slate-300 leading-relaxed">${formatted}</p>`;
  }

  wrapper.appendChild(bubble);
  refs.chatMessages?.appendChild(wrapper);
  refs.chatMessages.scrollTop = refs.chatMessages.scrollHeight;
  return wrapper;
}

async function handleAskChat() {
  const q = String(refs.chatQuestion?.value || '').trim();
  if (!q) return;
  const chatProv = state.chatProvider || state.selectedProvider || '';
  const chatMdl = state.chatModel || state.selectedModel || '';
  if (!chatProv || !chatMdl) {
    setTopStatus('请先选择可用模型', 'err');
    return;
  }

  renderChatBubble('user', q);
  refs.chatQuestion.value = '';
  refs.chatQuestion.style.height = '56px';
  setChatState('思考中...', 'muted');

  try {
    const data = await askChatV0({ question: q, provider: chatProv, model: chatMdl });
    let answer = data.answer || '未返回结果';
    if (data.doc_id && data.display_name) {
      answer += `\n\n── 引用文献: ${data.display_name} (${data.doc_id})`;
    }
    renderChatBubble('assistant', answer);
    setChatState('待提问', 'muted');
  } catch (err) {
    renderChatBubble('assistant', `请求失败: ${err.message || '未知错误'}`);
    setChatState('错误', 'err');
  }
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
  refs.dashProviderLabel = document.getElementById('dashProviderLabel');
  refs.dashProviderMenu = document.getElementById('dashProviderMenu');
  refs.dashModel = document.getElementById('dashModel');
  refs.dashModelLabel = document.getElementById('dashModelLabel');
  refs.dashModelMenu = document.getElementById('dashModelMenu');
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
  refs.chatModelSelector = document.getElementById('chatModelSelector');
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
    renderInitialChat();
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
