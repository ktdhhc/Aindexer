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
  searchSortTypeBtn: null,
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

function toggleTheme() {
  applyTheme(document.documentElement.classList.contains('light') ? 'dark' : 'light');
}

function setTopStatus(text, tone = 'muted') {
  const classMap = {
    muted: 'mt-3 text-[11px] text-slate-400 leading-5 min-h-[20px]',
    ok: 'mt-3 text-[11px] text-primary leading-5 min-h-[20px]',
    err: 'mt-3 text-[11px] text-error leading-5 min-h-[20px]',
    warn: 'mt-3 text-[11px] text-tertiary leading-5 min-h-[20px]',
  };
  refs.dashTopStatus.className = classMap[tone] || classMap.muted;
  refs.dashTopStatus.textContent = text;
}

function setDropTargetHighlight(active) {
  refs.uploadDropBox.classList.toggle('is-dragover', active);
  refs.uploadDropBox.classList.toggle('border-primary/40', active);
  refs.uploadDropBox.classList.toggle('bg-surface-container-lowest', active);
  refs.uploadDragNotice.classList.toggle('hidden', !active);
  refs.uploadDragNotice.classList.toggle('flex', active);
}

function setUploadState(text, tone = 'muted') {
  refs.uploadState.textContent = text;
  refs.uploadState.dataset.tone = tone;
  refs.uploadDropBox.title = text;
}

function setSearchState(text, tone = 'muted') {
  const classMap = {
    muted: 'text-xs text-slate-400',
    ok: 'text-xs text-primary',
    err: 'text-xs text-error',
    warn: 'text-xs text-tertiary',
  };
  refs.searchState.className = classMap[tone] || classMap.muted;
  refs.searchState.textContent = text;
}

function setPreviewState(text, tone = 'muted') {
  const classMap = {
    muted: 'text-xs text-slate-400',
    ok: 'text-xs text-primary',
    err: 'text-xs text-error',
    warn: 'text-xs text-tertiary',
  };
  refs.previewState.className = classMap[tone] || classMap.muted;
  refs.previewState.textContent = text;
}

function setPreviewSummary(metaText, statusText = '') {
  const meta = String(metaText || '').trim();
  const status = String(statusText || '').trim();
  refs.previewState.textContent = [meta, status].filter(Boolean).join(' · ') || '未加载文献';
}

function setChatState(text, tone = 'muted') {
  const classMap = {
    muted: 'text-[11px] uppercase tracking-widest text-slate-500',
    ok: 'text-[11px] uppercase tracking-widest text-primary',
    err: 'text-[11px] uppercase tracking-widest text-error',
    warn: 'text-[11px] uppercase tracking-widest text-tertiary',
  };
  refs.chatState.className = classMap[tone] || classMap.muted;
  refs.chatState.textContent = text;
}

function sortProviders(items) {
  const order = new Map(DEFAULT_PROVIDER_ORDER.map((provider, index) => [provider, index]));
  return [...items].sort((a, b) => {
    const left = String(a.provider || '').toLowerCase();
    const right = String(b.provider || '').toLowerCase();
    const li = order.has(left) ? order.get(left) : 999;
    const ri = order.has(right) ? order.get(right) : 999;
    if (li !== ri) return li - ri;
    return left.localeCompare(right);
  });
}

function getActiveModelOptions(provider) {
  const key = String(provider || '').trim().toLowerCase();
  if (!key) return [];
  const backendProvider = state.providers.find((item) => String(item.provider || '').toLowerCase() === key);
  const current = String(backendProvider?.model || '').trim();
  const presets = MODEL_PRESETS[key] || [];
  const custom = getProviderCustomModels(key);
  return [...new Set([current, ...presets, ...custom].filter(Boolean))];
}

function applyModelSelector(provider, preferredModel = '') {
  const options = getActiveModelOptions(provider);
  if (!options.length) {
    refs.dashModel.innerHTML = '<option value="">-</option>';
    refs.dashModel.value = '';
    state.selectedModel = '';
    updateControlAvailability();
    return;
  }
  refs.dashModel.innerHTML = options
    .map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`)
    .join('');
  const fallback = preferredModel && options.includes(preferredModel) ? preferredModel : options[0] || '';
  refs.dashModel.value = fallback;
  state.selectedModel = fallback;
  updateControlAvailability();
}

function getCurrentProviderModel() {
  return {
    provider: String(state.selectedProvider || refs.dashProvider.value || '').trim(),
    model: String(state.selectedModel || refs.dashModel.value || '').trim(),
    retries: Number(state.selectedRetry || 3),
  };
}

function updateControlAvailability() {
  const hasProvider = !!String(state.selectedProvider || '').trim();
  const hasModel = !!String(state.selectedModel || '').trim();
  const enabled = hasProvider && hasModel;
  refs.runAllBtn.disabled = !enabled;
  refs.chatAskBtn.disabled = !enabled;
}

async function loadProviders() {
  const providers = await listProviders();
  state.providers = sortProviders(providers).filter((item) => !!item.enabled);

  if (!state.providers.length) {
    refs.dashProvider.innerHTML = '<option value="">-</option>';
    refs.dashModel.innerHTML = '<option value="">-</option>';
    refs.dashProvider.value = '';
    refs.dashModel.value = '';
    state.selectedProvider = '';
    state.selectedModel = '';
    state.selectedRetry = 3;
    updateControlAvailability();
    renderInstrumentPanel();
    renderInitialChat();
    return;
  }

  refs.dashProvider.innerHTML = state.providers
    .map((item) => {
      const suffix = item.has_api_key ? '' : ' · 未配置';
      return `<option value="${escapeHtml(item.provider)}">${escapeHtml(item.provider)}${suffix}</option>`;
    })
    .join('');

  const availableWithKey = state.providers.filter((item) => !!item.has_api_key);
  const preferredProvider = availableWithKey[0]?.provider || state.providers[0]?.provider || '';
  state.selectedProvider = preferredProvider;
  refs.dashProvider.value = preferredProvider;
  applyModelSelector(preferredProvider);

  const retry = getProviderRetry(preferredProvider, 3);
  state.selectedRetry = retry;
  updateControlAvailability();
  renderInstrumentPanel();
  renderInitialChat();
}

function formatStage(row) {
  const stage = String(row.stage || '').trim();
  const stageMessage = String(row.stage_message || '').trim();
  if (stage && stageMessage) return `${stage} · ${stageMessage}`;
  if (stage) return stage;
  if (stageMessage) return stageMessage;
  return '等待处理';
}

function estimateProgress(row) {
  const progress = Number(row.progress);
  if (Number.isFinite(progress)) {
    return Math.max(0, Math.min(100, Math.round(progress)));
  }

  const stage = String(row.stage || '').toLowerCase();
  const status = String(row.status || '').toLowerCase();
  const stageMap = {
    queued: 10,
    uploaded: 14,
    parsing: 42,
    chunking: 56,
    embedding: 68,
    summarizing: 80,
    saving: 92,
    cancel_requested: 60,
    cancelled: 100,
    failed: 100,
    needs_review: 100,
    indexed: 100,
  };
  return stageMap[stage] ?? stageMap[status] ?? 8;
}

function statusBadgeClass(status) {
  const key = String(status || '').toLowerCase();
  if (key === 'indexed') return 'bg-primary/10 text-primary border border-primary/20';
  if (key === 'parsing') return 'bg-sky-500/10 text-sky-300 border border-sky-400/20';
  if (key === 'needs_review') return 'bg-tertiary/10 text-tertiary border border-tertiary/20';
  if (key === 'failed' || key === 'cancelled') return 'bg-error/10 text-error border border-error/20';
  return 'bg-white/5 text-slate-300 border border-white/10';
}

function collectCounts() {
  return state.files.reduce(
    (acc, row) => {
      const status = String(row.status || '').toLowerCase();
      if (status === 'indexed') acc.indexed += 1;
      else if (ACTIVE_STATUSES.has(status)) acc.active += 1;
      else acc.queue += 1;
      return acc;
    },
    { indexed: 0, active: 0, queue: 0 },
  );
}

function updateFooterStatus() {
  const counts = collectCounts();
  if (counts.active > 0) {
    refs.footerStatus.textContent = `系统在线 • 索引中 ${counts.active} • 已索引 ${counts.indexed}`;
    return;
  }
  refs.footerStatus.textContent = `系统在线 • 待处理 ${counts.queue} • 已索引 ${counts.indexed}`;
}

function parseKeywordTokens(value) {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => parseKeywordTokens(item))
      .filter(Boolean);
  }

  if (typeof value !== 'string') return [];
  return value
    .split(/[\n,;|/\\，；、]+/)
    .map((item) => String(item || '').trim())
    .filter((item) => item.length >= 2);
}

function buildKeywordCloudItems() {
  const counts = new Map();
  const labels = new Map();

  state.searchRows.forEach((row) => {
    const tokens = parseKeywordTokens(row.keywords);
    const unique = new Set(tokens.map((token) => token.toLowerCase()));
    tokens.forEach((token) => {
      const key = token.toLowerCase();
      if (!unique.has(key)) return;
      unique.delete(key);
      counts.set(key, (counts.get(key) || 0) + 1);
      if (!labels.has(key)) labels.set(key, token);
    });
  });

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 14)
    .map(([key, count], index, items) => {
      const max = items[0]?.[1] || 1;
      const ratio = count / max;
      return {
        label: labels.get(key) || key,
        count,
        size: 0.92 + ratio * 0.9,
        opacity: 0.58 + ratio * 0.34,
        hueShift: (index % 4) * 6,
      };
    });
}

const CLOUD_POSITIONS = [
  { x: 50, y: 18 },
  { x: 35, y: 24 },
  { x: 66, y: 25 },
  { x: 24, y: 39 },
  { x: 78, y: 40 },
  { x: 18, y: 57 },
  { x: 83, y: 58 },
  { x: 33, y: 72 },
  { x: 66, y: 73 },
  { x: 50, y: 81 },
  { x: 48, y: 35 },
  { x: 61, y: 49 },
  { x: 39, y: 52 },
  { x: 50, y: 63 },
];

function getAvailableModelCount() {
  const models = new Set();
  state.providers
    .filter((provider) => provider.has_api_key)
    .forEach((provider) => {
      getActiveModelOptions(provider.provider).forEach((model) => {
        if (model) models.add(model);
      });
    });
  return models.size;
}

function renderInstrumentPanel() {
  const counts = collectCounts();
  if (refs.dashIndexedCount) refs.dashIndexedCount.textContent = String(counts.indexed);
  if (refs.dashModelCount) refs.dashModelCount.textContent = String(getAvailableModelCount());

  if (!refs.dashboardKeywordCloud) return;
  const items = buildKeywordCloudItems();
  const activeQuery = String(refs.searchInput?.value || '').trim().toLowerCase();
  if (!items.length) {
    refs.dashboardKeywordCloud.innerHTML = '<div class="instrument-cloud-empty">暂无索引语义分布</div>';
    return;
  }

  refs.dashboardKeywordCloud.innerHTML = items
    .map((item, index) => {
      const position = CLOUD_POSITIONS[index] || { x: 50, y: 50 };
      return `
      <span
        class="instrument-cloud-chip"
        data-keyword="${escapeHtml(item.label)}"
        style="left:${position.x}%; top:${position.y}%; font-size:${item.size.toFixed(2)}rem; opacity:${item.opacity.toFixed(2)}; ${activeQuery === item.label.toLowerCase() ? 'background:rgba(137,206,255,0.14); border-color:rgba(137,206,255,0.28);' : ''} box-shadow:0 0 0 1px rgba(137,206,255,${(0.05 + item.hueShift / 100).toFixed(2)});"
        title="出现 ${item.count} 次"
      >${escapeHtml(item.label)}</span>
    `;
    })
    .join('');
}

function renderQueueRows() {
  const queueRows = state.files.filter((row) => String(row.status || '').toLowerCase() !== 'indexed');
  refs.queueSummary.textContent = `${queueRows.length} 待生成`;
  updateFooterStatus();
  renderInstrumentPanel();

  if (!queueRows.length) {
    refs.queuePanel.classList.add('hidden');
    refs.queuePanel.classList.remove('flex');
    refs.uploadEmptyState.classList.remove('hidden');
    refs.uploadEmptyState.classList.add('flex');
    refs.uploadDropBox.classList.add('cursor-pointer');
    refs.queueRows.innerHTML = '';
    return;
  }

  refs.uploadEmptyState.classList.add('hidden');
  refs.uploadEmptyState.classList.remove('flex');
  refs.queuePanel.classList.remove('hidden');
  refs.queuePanel.classList.add('flex');
  refs.uploadDropBox.classList.remove('cursor-pointer');

  refs.queueRows.innerHTML = queueRows
    .map((row) => {
      const docId = String(row.id || '');
      const displayName = String(row.display_name || row.filename || docId);
      const status = String(row.status || 'uploaded');
      const progress = estimateProgress(row);
      return `
        <article class="rounded-2xl bg-surface-container-lowest/72 border border-white/5 p-3.5 space-y-3">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-sm font-semibold text-slate-100 truncate" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</div>
              <div class="text-[11px] uppercase tracking-widest text-slate-500 truncate">${escapeHtml(docId)}</div>
            </div>
            <span class="shrink-0 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${statusBadgeClass(status)}">${escapeHtml(status)}</span>
          </div>
          <div class="space-y-2">
            <div class="flex items-center justify-between text-[11px] text-slate-400 gap-3">
              <span class="truncate">${escapeHtml(formatStage(row))}</span>
              <span class="text-primary">${progress}%</span>
            </div>
            <div class="h-1.5 w-full bg-surface-container rounded-full overflow-hidden">
              <div class="h-full rounded-full bg-gradient-to-r from-primary to-primary-container shadow-[0_0_12px_rgba(137,206,255,0.35)]" style="width:${progress}%"></div>
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <button type="button" data-action="run" data-id="${escapeHtml(docId)}" class="px-3 py-2 rounded-xl bg-white/5 text-slate-200 text-xs font-semibold hover:bg-white/10 transition-all">索引</button>
            <button type="button" data-action="cancel" data-id="${escapeHtml(docId)}" class="px-3 py-2 rounded-xl bg-white/5 text-slate-200 text-xs font-semibold hover:bg-white/10 transition-all">中断</button>
            <button type="button" data-action="preview" data-id="${escapeHtml(docId)}" class="px-3 py-2 rounded-xl bg-white/5 text-slate-200 text-xs font-semibold hover:bg-white/10 transition-all">预览</button>
            <button type="button" data-action="original" data-id="${escapeHtml(docId)}" class="px-3 py-2 rounded-xl bg-white/5 text-slate-200 text-xs font-semibold hover:bg-white/10 transition-all">原文</button>
            <button type="button" data-action="delete" data-id="${escapeHtml(docId)}" class="px-3 py-2 rounded-xl bg-error/10 text-error text-xs font-semibold hover:bg-error/15 transition-all">删除</button>
          </div>
        </article>
      `;
    })
    .join('');
}

function normalizeAuthors(row) {
  if (Array.isArray(row.authors)) return row.authors.join(', ');
  if (typeof row.authors === 'string') return row.authors;
  return '';
}

function getDocDisplayName(row) {
  return String(row?.display_name || row?.filename || '').trim();
}

function updateSearchSortControls() {
  const labelMap = {
    created: '生成时间',
    year: '年份',
    display: '显示名',
  };
  if (refs.searchSortTypeBtn) refs.searchSortTypeBtn.textContent = labelMap[state.searchSortField] || '生成时间';
  if (refs.searchSortDirectionIcon) refs.searchSortDirectionIcon.textContent = state.searchSortDirection === 'asc' ? 'north' : 'south';
  if (refs.searchSortMenu) {
    [...refs.searchSortMenu.querySelectorAll('[data-sort-field]')].forEach((node) => {
      node.classList.toggle('is-active', node.getAttribute('data-sort-field') === state.searchSortField);
    });
  }
}

function sortSearchRows(rows) {
  const list = [...rows];
  const sign = state.searchSortDirection === 'asc' ? 1 : -1;

  const byName = (a, b) => getDocDisplayName(a).localeCompare(getDocDisplayName(b), 'zh-CN', { sensitivity: 'base' });
  const byYear = (a, b) => Number(a?.year || 0) - Number(b?.year || 0);
  const byCreated = (a, b) => {
    const left = Date.parse(a?.created_at || '');
    const right = Date.parse(b?.created_at || '');
    return (Number.isNaN(left) ? 0 : left) - (Number.isNaN(right) ? 0 : right);
  };

  const comparator = state.searchSortField === 'display' ? byName : state.searchSortField === 'year' ? byYear : byCreated;
  list.sort((a, b) => {
    const result = comparator(a, b);
    if (result !== 0) return result * sign;
    return byCreated(a, b) * -1;
  });
  return list;
}

function renderSearchRows() {
  if (!state.searchRows.length) {
    refs.searchRows.innerHTML = `
      <div class="rounded-2xl bg-surface-container-lowest/70 border border-white/5 p-4 text-sm text-slate-500">
        暂无已索引结果
      </div>
    `;
    renderInstrumentPanel();
    return;
  }

  const sortedRows = sortSearchRows(state.searchRows);

  refs.searchRows.innerHTML = sortedRows
    .map((row) => {
      const docId = String(row.doc_id || row.id || '');
      const displayName = String(row.display_name || row.filename || docId);
      const authors = normalizeAuthors(row);
      const metaBits = [row.year ? `Year ${row.year}` : '', authors, row.created_at ? formatDateTimeShort(row.created_at) : ''].filter(Boolean);
      const active = state.currentDocId === docId;
      return `
        <article data-action="preview" data-id="${escapeHtml(docId)}" class="rounded-2xl ${active ? 'bg-surface-container-low/85 border-primary/30 shadow-[0_0_0_1px_rgba(137,206,255,0.16)]' : 'bg-surface-container-lowest/72 border-white/5'} border p-4 space-y-3 cursor-pointer transition-all duration-200 hover:bg-surface-container-low/80 hover:border-primary/25 hover:shadow-[0_0_0_1px_rgba(137,206,255,0.14)]" title="点击预览">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-sm font-semibold text-slate-100 truncate" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</div>
              <div class="text-[11px] uppercase tracking-widest text-slate-500 truncate">${escapeHtml(docId)}</div>
            </div>
            <span class="shrink-0 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-primary/10 text-primary border border-primary/20">indexed</span>
          </div>
          <div class="text-xs text-slate-400">${escapeHtml(metaBits.join(' • ') || '已建立索引')}</div>
          <div class="flex flex-wrap gap-2">
            <button type="button" data-action="export" data-id="${escapeHtml(docId)}" class="px-3 py-2 rounded-xl bg-white/5 text-slate-200 text-xs font-semibold hover:bg-white/10 transition-all">导出</button>
            <button type="button" data-action="delete" data-id="${escapeHtml(docId)}" class="px-3 py-2 rounded-xl bg-error/10 text-error text-xs font-semibold hover:bg-error/15 transition-all">删除</button>
          </div>
        </article>
      `;
    })
    .join('');

  renderInstrumentPanel();
}

function syncAutoRefresh() {
  const hasActiveJobs = state.files.some((row) => {
    const status = String(row.status || '').toLowerCase();
    const stage = String(row.stage || '').toLowerCase();
    return ACTIVE_STATUSES.has(status) || stage === 'cancel_requested';
  });

  if (hasActiveJobs && !state.autoRefreshTimer) {
    state.autoRefreshTimer = window.setInterval(async () => {
      try {
        await Promise.all([loadFiles(), loadSearchRows(refs.searchInput.value)]);
      } catch (_) {
        // ignore polling failures; next cycle retries
      }
    }, 2500);
  }

  if (!hasActiveJobs && state.autoRefreshTimer) {
    window.clearInterval(state.autoRefreshTimer);
    state.autoRefreshTimer = null;
  }
}

async function loadFiles() {
  state.files = await listFiles();
  renderQueueRows();
  syncAutoRefresh();
}

function syncSearchInputs(value) {
  refs.searchInput.value = value;
  renderInstrumentPanel();
}

async function loadSearchRows(query = refs.searchInput.value, options = {}) {
  const q = String(query || '').trim();
  state.searchRows = await searchDocs(q, { status: 'indexed' });
  renderSearchRows();
  setSearchState(`结果 ${state.searchRows.length}`, state.searchRows.length ? 'ok' : 'muted');

  if (options.autoPreviewFirst) {
    const first = state.searchRows[0];
    const firstId = String(first?.doc_id || first?.id || '').trim();
    if (!firstId) return;
    if (firstId === state.currentDocId) {
      renderPreviewContent();
      return;
    }
    await loadPreview(firstId);
  }
}

function scheduleSearchReload(autoPreviewFirst = true) {
  if (state.searchDebounceTimer) {
    window.clearTimeout(state.searchDebounceTimer);
  }
  state.searchDebounceTimer = window.setTimeout(() => {
    loadSearchRows(refs.searchInput.value, { autoPreviewFirst }).catch((error) => {
      setSearchState(error.message || '搜索失败', 'err');
    });
  }, 160);
}

function closeSearchSortMenu() {
  if (refs.searchSortMenu) refs.searchSortMenu.hidden = true;
}

function toggleSearchSortMenu() {
  if (!refs.searchSortMenu) return;
  refs.searchSortMenu.hidden = !refs.searchSortMenu.hidden;
}

function getMetaRow(docId) {
  const id = String(docId || '').trim();
  return (
    state.searchRows.find((row) => String(row.doc_id || row.id || '') === id)
    || state.files.find((row) => String(row.id || '') === id)
    || null
  );
}

function renderPreviewMeta(docId) {
  const row = getMetaRow(docId);
  if (!row) {
    return docId || '未加载文献';
  }
  const displayName = String(row.display_name || row.filename || docId);
  const bits = [displayName];
  if (row.year) bits.push(String(row.year));
  if (row.status) bits.push(String(row.status));
  return bits.join(' • ');
}

function renderPreviewContent() {
  const text = String(state.currentPreviewMarkdown || '').trim();
  const terms = getSearchTerms();
  if (!text) {
    refs.previewMarkdown.innerHTML = '<span class="text-slate-500">这里显示 Markdown 索引内容</span>';
    return;
  }

  let html = escapeHtml(state.currentPreviewMarkdown).replace(/\n/g, '<br>');
  if (terms.length) {
    const pattern = terms.map(escapeRegExp).join('|');
    const regex = new RegExp(pattern, 'gi');
    html = html.replace(regex, (match) => `<mark>${match}</mark>`);
  }
  refs.previewMarkdown.innerHTML = html;
}

async function loadPreview(docId) {
  const id = String(docId || refs.previewDocId.value || '').trim();
  if (!id) {
    setPreviewState('请输入或选择 DocID', 'err');
    return;
  }

  try {
    const result = await getMarkdown(id);
    state.currentDocId = id;
    refs.previewDocId.value = id;
    state.currentPreviewMarkdown = String(result.markdown || '');
    renderPreviewContent();
    const metaText = renderPreviewMeta(id);
    setPreviewState('', 'ok');
    setPreviewSummary(metaText, `已加载 ${id}`);
    renderSearchRows();
  } catch (error) {
    setPreviewState(error.message || '加载预览失败', 'err');
  }
}

async function copyPreview() {
  const text = String(state.currentPreviewMarkdown || '');
  if (!text.trim()) {
    setPreviewState('当前没有可复制内容', 'err');
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    setPreviewState('已复制 Markdown', 'ok');
  } catch (_) {
    setPreviewState('复制失败，请手动复制', 'err');
  }
}

function setEditModalStatus(text, tone = 'muted') {
  const classMap = {
    muted: 'text-xs text-slate-400 mt-2',
    ok: 'text-xs text-primary mt-2',
    err: 'text-xs text-error mt-2',
    warn: 'text-xs text-tertiary mt-2',
  };
  refs.editModalStatus.className = classMap[tone] || classMap.muted;
  refs.editModalStatus.textContent = text;
}

function openEditModal() {
  refs.editIndexModal.classList.add('is-open');
  refs.editIndexModal.setAttribute('aria-hidden', 'false');
}

function closeEditModal() {
  refs.editIndexModal.classList.remove('is-open');
  refs.editIndexModal.setAttribute('aria-hidden', 'true');
  state.editDocId = '';
}

async function openPreviewEditor() {
  const id = String(state.currentDocId || refs.previewDocId.value || '').trim();
  if (!id) {
    setPreviewState('请先加载文献', 'err');
    return;
  }

  refs.previewEditBtn.disabled = true;
  setPreviewState('正在打开编辑窗口', 'warn');
  try {
    const [fileDetail, indexDetail, markdownDetail] = await Promise.all([
      getFileDetail(id),
      getIndexDetail(id),
      getMarkdown(id),
    ]);
    state.editDocId = id;
    refs.editDisplayName.value = String(fileDetail.display_name || fileDetail.filename || id);
    refs.editYear.value = indexDetail.year ? String(indexDetail.year) : '';
    refs.editGeneratedAt.value = formatDateTimeLocalInput(indexDetail.updated_at || fileDetail.updated_at || fileDetail.created_at);
    refs.editMarkdown.value = String(markdownDetail.markdown || '');
    setEditModalStatus(`编辑 ${id}`, 'muted');
    openEditModal();
  } catch (error) {
    setPreviewState(error.message || '打开编辑窗口失败', 'err');
  } finally {
    refs.previewEditBtn.disabled = false;
  }
}

async function savePreviewEditor() {
  const id = String(state.editDocId || '').trim();
  if (!id) return;

  refs.editModalSaveBtn.disabled = true;
  setEditModalStatus('正在保存修改', 'warn');
  try {
    await updateIndexEditor(id, {
      display_name: refs.editDisplayName.value,
      year: refs.editYear.value,
      generated_at: refs.editGeneratedAt.value,
      markdown: refs.editMarkdown.value,
    });
    state.currentPreviewMarkdown = String(refs.editMarkdown.value || '');
    renderPreviewContent();
    closeEditModal();
    await Promise.all([loadFiles(), loadSearchRows(refs.searchInput.value)]);
    await loadPreview(id);
    setTopStatus(`已更新 ${id}`, 'ok');
  } catch (error) {
    setEditModalStatus(error.message || '保存失败', 'err');
  } finally {
    refs.editModalSaveBtn.disabled = false;
  }
}

async function handleUploadSelectedFiles() {
  await uploadFiles([...(refs.uploadInput.files || [])]);
}

async function uploadFiles(files) {
  if (!files.length) {
    setUploadState('请先选择文件', 'err');
    return;
  }

  refs.uploadInput.disabled = true;
  refs.uploadDropBox.classList.add('opacity-75', 'pointer-events-none');
  setUploadState(`上传中 ${files.length} 项`, 'warn');

  let success = 0;
  let duplicate = 0;
  let failed = 0;

  for (const file of files) {
    try {
      const result = await uploadFile(file);
      if (result.duplicate) duplicate += 1;
      else success += 1;
    } catch (_) {
      failed += 1;
    }
  }

  refs.uploadInput.value = '';
  refs.uploadInput.disabled = false;
  refs.uploadDropBox.classList.remove('opacity-75', 'pointer-events-none');

  if (failed > 0) {
    setUploadState(`成功 ${success} · 重复 ${duplicate} · 失败 ${failed}`, 'err');
  } else {
    setUploadState(`成功 ${success} · 重复 ${duplicate}`, 'ok');
  }

  await Promise.all([loadFiles(), loadSearchRows(refs.searchInput.value)]);
}

async function handleQueueAction(action, docId) {
  const { provider, model, retries } = getCurrentProviderModel();

  if (action === 'run') {
    if (!provider || !model) {
      setTopStatus('请先配置可用 Provider/Model', 'err');
      return;
    }
    try {
      await runIndex(docId, provider, model, retries);
      setTopStatus(`已启动 ${docId}`, 'ok');
      await loadFiles();
    } catch (error) {
      setTopStatus(error.message || '索引启动失败', 'err');
    }
    return;
  }

  if (action === 'cancel') {
    try {
      await cancelIndex(docId);
      setTopStatus(`已请求中断 ${docId}`, 'warn');
      await loadFiles();
    } catch (error) {
      setTopStatus(error.message || '中断失败', 'err');
    }
    return;
  }

  if (action === 'preview') {
    await loadPreview(docId);
    return;
  }

  if (action === 'original') {
    window.open(`/api/files/${encodeURIComponent(docId)}/original`, '_blank', 'noopener');
    return;
  }

  if (action === 'delete') {
    const yes = window.confirm(`确定删除文献 ${docId}？`);
    if (!yes) return;
    try {
      await deleteFile(docId);
      if (state.currentDocId === docId) {
        state.currentDocId = '';
        refs.previewDocId.value = '';
        state.currentPreviewMarkdown = '';
        renderPreviewContent();
        setPreviewState('待加载', 'muted');
      }
      setTopStatus(`已删除 ${docId}`, 'ok');
      await Promise.all([loadFiles(), loadSearchRows(refs.searchInput.value)]);
    } catch (error) {
      setTopStatus(error.message || '删除失败', 'err');
    }
  }
}

async function handleSearchAction(action, docId) {
  if (action === 'preview') {
    await loadPreview(docId);
    return;
  }

  if (action === 'export') {
    window.open(exportDocUrl(docId), '_blank', 'noopener');
    return;
  }

  if (action === 'delete') {
    await handleQueueAction('delete', docId);
  }
}

async function handleRunAll() {
  const { provider, model, retries } = getCurrentProviderModel();
  if (!provider || !model) {
    setTopStatus('请先配置可用 Provider/Model', 'err');
    return;
  }

  refs.runAllBtn.disabled = true;
  setTopStatus('正在提交批量索引任务', 'warn');
  try {
    const result = await runAll(provider, model, retries);
    setTopStatus(`queued ${result.queued || 0} · skipped ${result.skipped || 0}`, 'ok');
    await loadFiles();
  } catch (error) {
    setTopStatus(error.message || '批量索引失败', 'err');
  } finally {
    updateControlAvailability();
  }
}

function scrollChatToBottom() {
  refs.chatMessages.scrollTop = refs.chatMessages.scrollHeight;
}

function createAssistantMessage(text, meta = '') {
  return `
    <div class="flex gap-4 max-w-[90%]">
      <div class="w-8 h-8 rounded-full bg-primary/20 flex-shrink-0 flex items-center justify-center border border-primary/20">
        <span class="material-symbols-outlined text-primary text-sm">smart_toy</span>
      </div>
      <div class="space-y-2">
        <div class="p-4 rounded-2xl rounded-tl-none bg-surface-container-high border border-white/5 text-sm text-slate-200 whitespace-pre-wrap">${escapeHtml(text)}</div>
        ${meta ? `<div class="pl-1 text-[11px] uppercase tracking-widest text-slate-500">${escapeHtml(meta)}</div>` : ''}
      </div>
    </div>
  `;
}

function createUserMessage(text) {
  return `
    <div class="flex gap-4 max-w-[90%] ml-auto flex-row-reverse">
      <div class="w-8 h-8 rounded-full bg-secondary/20 flex-shrink-0 flex items-center justify-center border border-secondary/20">
        <span class="material-symbols-outlined text-secondary text-sm">person</span>
      </div>
      <div class="p-4 rounded-2xl rounded-tr-none bg-primary/10 border border-primary/20 text-sm text-slate-100 whitespace-pre-wrap">${escapeHtml(text)}</div>
    </div>
  `;
}

function renderInitialChat() {
  const providerText = state.selectedProvider && state.selectedModel
    ? `${state.selectedProvider} / ${state.selectedModel}`
    : '未配置模型';
  refs.chatMessages.innerHTML = createAssistantMessage('工作台已连接。可以基于已索引文献提问。', providerText);
  scrollChatToBottom();
}

function refreshChatContextIfIdle() {
  if (refs.chatMessages.children.length <= 1) {
    renderInitialChat();
  }
}

function appendChatHtml(html) {
  refs.chatMessages.insertAdjacentHTML('beforeend', html);
  scrollChatToBottom();
}

function appendThinkingMessage() {
  const wrapper = document.createElement('div');
  wrapper.className = 'flex gap-4';
  wrapper.innerHTML = `
    <div class="w-8 h-8 rounded-full bg-primary/20 flex-shrink-0 flex items-center justify-center border border-primary/20">
      <span class="material-symbols-outlined text-primary text-sm">smart_toy</span>
    </div>
    <div class="flex items-center gap-2 px-4 py-3 rounded-full bg-surface-container-high border border-white/5 italic text-xs text-slate-400">
      <div class="flex gap-1">
        <div class="w-1 h-1 rounded-full bg-primary animate-pulse"></div>
        <div class="w-1 h-1 rounded-full bg-primary animate-pulse [animation-delay:120ms]"></div>
        <div class="w-1 h-1 rounded-full bg-primary animate-pulse [animation-delay:240ms]"></div>
      </div>
      <span>正在分析文献索引...</span>
    </div>
  `;
  refs.chatMessages.appendChild(wrapper);
  scrollChatToBottom();
  return wrapper;
}

async function handleAskChat() {
  const question = String(refs.chatQuestion.value || '').trim();
  const { provider, model } = getCurrentProviderModel();
  if (!question) {
    setChatState('问题不能为空', 'err');
    return;
  }
  if (!provider || !model) {
    setChatState('未配置模型', 'err');
    return;
  }

  refs.chatAskBtn.disabled = true;
  appendChatHtml(createUserMessage(question));
  refs.chatQuestion.value = '';
  autoresizeTextarea(refs.chatQuestion);
  const thinkingNode = appendThinkingMessage();
  setChatState('处理中', 'warn');

  try {
    const result = await askChatV0({ question, provider, model });
    thinkingNode.remove();
    const answer = String(result.answer || '').trim() || '(空响应)';
    const meta = result.display_name || result.doc_id || `${provider} / ${model}`;
    appendChatHtml(createAssistantMessage(answer, meta));
    setChatState('完成', 'ok');
  } catch (error) {
    thinkingNode.remove();
    appendChatHtml(createAssistantMessage(error.message || 'Chat V0 请求失败'));
    setChatState('失败', 'err');
  } finally {
    updateControlAvailability();
  }
}

function autoresizeTextarea(node) {
  node.style.height = 'auto';
  const next = Math.min(node.scrollHeight, 180);
  node.style.height = `${Math.max(56, next)}px`;
}

function openCurrentOriginal() {
  const id = String(state.currentDocId || refs.previewDocId.value || '').trim();
  if (!id) {
    setPreviewState('请先加载文献', 'err');
    return;
  }
  window.open(`/api/files/${encodeURIComponent(id)}/original`, '_blank', 'noopener');
}

function openCurrentExport() {
  const id = String(state.currentDocId || refs.previewDocId.value || '').trim();
  if (!id) {
    setPreviewState('请先加载文献', 'err');
    return;
  }
  window.open(exportDocUrl(id), '_blank', 'noopener');
}

async function handleRefresh() {
  try {
    await Promise.all([loadFiles(), loadSearchRows(refs.searchInput.value)]);
    setTopStatus('已刷新', 'ok');
  } catch (error) {
    setTopStatus(error.message || '刷新失败', 'err');
  }
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

function exitFrontendWindow() {
  window.setTimeout(() => {
    try {
      window.open('', '_self');
    } catch (_) {
      // ignore
    }
    try {
      window.close();
    } catch (_) {
      // ignore
    }
    try {
      window.location.replace('about:blank');
    } catch (_) {
      // ignore
    }
  }, 180);
}

async function handleBackupExport() {
  setTopStatus('正在准备备份包', 'warn');
  try {
    const result = await exportBackupAll();
    downloadBlob(result.blob, result.filename);
    setTopStatus('备份导出成功', 'ok');
  } catch (error) {
    setTopStatus(error.message || '导出失败', 'err');
  }
}

function triggerBackupImport() {
  if (!refs.backupImportInput) return;
  refs.backupImportInput.value = '';
  refs.backupImportInput.click();
}

async function handleBackupImport(event) {
  const file = event.target?.files?.[0];
  if (!file) return;

  const yes = window.confirm('导入将覆盖当前文件、索引和配置，是否继续？');
  if (!yes) {
    refs.backupImportInput.value = '';
    return;
  }

  setTopStatus('正在导入并恢复数据', 'warn');
  try {
    const result = await importBackupAll(file);
    const message = result.pre_restore_backup
      ? `导入成功，已创建恢复前快照：${result.pre_restore_backup}`
      : '导入成功';
    setTopStatus(message, 'ok');
    await Promise.all([loadProviders(), loadFiles(), loadSearchRows(refs.searchInput.value)]);
  } catch (error) {
    setTopStatus(error.message || '导入失败', 'err');
  } finally {
    refs.backupImportInput.value = '';
  }
}

async function handleExitApp() {
  const yes = window.confirm('确定退出 Aindexer 吗？');
  if (!yes) return;

  if (refs.exitAppBtn) refs.exitAppBtn.disabled = true;
  setTopStatus('正在退出应用', 'warn');
  try {
    await exitApp();
    setTopStatus('应用已退出，可关闭此页面', 'ok');
    exitFrontendWindow();
  } catch (error) {
    setTopStatus(error.message || '退出失败', 'err');
    if (refs.exitAppBtn) refs.exitAppBtn.disabled = false;
  }
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
  refs.refreshBtn.addEventListener('click', handleRefresh);

  refs.exportAllBtnSide.addEventListener('click', handleBackupExport);
  refs.importAllBtnSide.addEventListener('click', triggerBackupImport);
  refs.backupImportInput.addEventListener('change', handleBackupImport);

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
  refs.searchSortTypeBtn.addEventListener('click', toggleSearchSortMenu);
  refs.searchSortDirectionBtn.addEventListener('click', () => {
    state.searchSortDirection = state.searchSortDirection === 'asc' ? 'desc' : 'asc';
    updateSearchSortControls();
    renderSearchRows();
  });
  refs.searchSortMenu.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-sort-field]') : null;
    if (!target) return;
    state.searchSortField = target.getAttribute('data-sort-field') || 'created';
    updateSearchSortControls();
    closeSearchSortMenu();
    renderSearchRows();
  });
  document.addEventListener('click', (event) => {
    if (!refs.searchSortMenu || refs.searchSortMenu.hidden) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('.sort-split')) return;
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
  refs.themeToggleBtn.addEventListener('click', toggleTheme);

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
  refs.exitAppBtn.addEventListener('click', handleExitApp);
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
  refs.searchSortTypeBtn = document.getElementById('searchSortTypeBtn');
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
