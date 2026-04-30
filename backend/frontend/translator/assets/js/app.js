import { 
  fetchDocuments, 
  uploadDocument,
  fetchProviders,
  updateProviderConfig,
  testProviderConfig
} from './api.js';
import { loadDocument } from './viewer.js';
import { initSearch } from './search.js';
import { initSelection } from './selection.js';

const els = {
  documentList: document.getElementById('documentList'),
  documentSearchInput: document.getElementById('documentSearchInput'),
  documentSearchMeta: document.getElementById('documentSearchMeta'),
  refreshBtn: document.getElementById('refreshDocsBtn'),
  uploadInput: document.getElementById('uploadFileInput'),
  uploadBtn: document.getElementById('uploadBtn'),
  uploadStatus: document.getElementById('uploadStatus'),
  configProviderSelect: document.getElementById('configProviderSelect'),
  providerSelect: document.getElementById('providerSelect'),
  configBaseUrl: document.getElementById('configBaseUrl'),
  configModel: document.getElementById('configModel'),
  configApiKey: document.getElementById('configApiKey'),
  configApiKeyStatus: document.getElementById('configApiKeyStatus'),
  saveConfigBtn: document.getElementById('saveConfigBtn'),
  testConfigBtn: document.getElementById('testConfigBtn'),
  configMessage: document.getElementById('configMessage'),
};

// Provider config state
let providerConfigs = {};

const appState = {
  documents: [],
  selectedDocId: '',
  searchToken: 0,
  searchDebounceTimer: null,
};

async function loadDocumentList(query = '', options = {}) {
  const searchToken = ++appState.searchToken;
  showDocumentSearchMeta(query ? 'Searching...' : 'Loading documents...');
  try {
    const docs = await fetchDocuments(query);
    if (searchToken !== appState.searchToken) {
      return appState.documents;
    }
    appState.documents = Array.isArray(docs) ? docs : [];
    if (options.selectDocId) {
      appState.selectedDocId = options.selectDocId;
    }
    renderDocumentList(query);
    return docs;
  } catch (err) {
    console.error('Failed to load documents:', err);
    if (searchToken === appState.searchToken) {
      appState.documents = [];
      renderDocumentList(query, err);
    }
    return [];
  }
}

async function loadProviderConfigs() {
  try {
    const providers = await fetchProviders();
    providerConfigs = {};
    providers.forEach(p => {
      providerConfigs[p.provider] = p;
    });
    renderProviderSelects(providers);
    updateConfigUI();
  } catch (err) {
    console.error('Failed to load provider configs:', err);
    showConfigMessage('Failed to load provider configs', 'error');
  }
}

function renderProviderSelects(providers) {
  const items = Array.isArray(providers) ? providers.filter((item) => item?.provider) : [];
  const translatableItems = items.filter((item) => item.enabled && item.model);
  const currentConfigProvider = els.configProviderSelect.value;
  const currentTranslateProvider = els.providerSelect.value;

  els.configProviderSelect.innerHTML = items.length
    ? items.map((item) => `<option value="${item.provider}">${item.provider}</option>`).join('')
    : '<option value="">No providers</option>';
  els.configProviderSelect.disabled = items.length === 0;

  els.providerSelect.innerHTML = translatableItems.length
    ? translatableItems.map((item) => `<option value="${item.provider}">${item.provider}</option>`).join('')
    : '<option value="">No enabled providers</option>';
  els.providerSelect.disabled = translatableItems.length === 0;

  if (items.some((item) => item.provider === currentConfigProvider)) {
    els.configProviderSelect.value = currentConfigProvider;
  } else if (items[0]) {
    els.configProviderSelect.value = items[0].provider;
  }

  if (translatableItems.some((item) => item.provider === currentTranslateProvider)) {
    els.providerSelect.value = currentTranslateProvider;
  } else if (translatableItems[0]) {
    els.providerSelect.value = translatableItems[0].provider;
  }
}

function updateConfigUI() {
  const provider = els.configProviderSelect.value;
  const config = providerConfigs[provider];
  if (config) {
    els.configBaseUrl.value = config.base_url || '';
    els.configModel.value = config.model || '';
    if (config.has_api_key) {
      els.configApiKeyStatus.textContent = `Key: ${config.api_key_masked}`;
      els.configApiKeyStatus.classList.remove('hidden');
    } else {
      els.configApiKeyStatus.classList.add('hidden');
    }
    return;
  }
  els.configBaseUrl.value = '';
  els.configModel.value = '';
  els.configApiKeyStatus.classList.add('hidden');
}

async function handleUpload() {
  const file = els.uploadInput.files[0];
  if (!file) return;
  
  els.uploadStatus.textContent = 'Uploading...';
  els.uploadStatus.classList.remove('hidden', 'success', 'error');
  
  try {
    const result = await uploadDocument(file);
    els.uploadStatus.textContent = result.duplicate ? 'Document already exists' : 'Upload successful!';
    els.uploadStatus.classList.add('success');
    els.uploadStatus.classList.remove('hidden');
    
    els.documentSearchInput.value = '';
    await loadDocumentList('', { selectDocId: result.document_id });
    
    // Clear input
    els.uploadInput.value = '';
    
    // Auto-load the document
    if (result.document_id) {
      await selectDocument(result.document_id);
    }
  } catch (err) {
    els.uploadStatus.textContent = err.message || 'Upload failed';
    els.uploadStatus.classList.add('error');
    els.uploadStatus.classList.remove('hidden');
  }
}

function showConfigMessage(message, type) {
  els.configMessage.textContent = message;
  els.configMessage.className = `text-xs ${type}`;
  els.configMessage.classList.remove('hidden');
  setTimeout(() => {
    els.configMessage.classList.add('hidden');
  }, 5000);
}

async function handleSaveConfig() {
  const provider = els.configProviderSelect.value;
  if (!provider) {
    showConfigMessage('No provider selected', 'error');
    return;
  }
  const config = {
    base_url: els.configBaseUrl.value,
    model: els.configModel.value,
    api_key: els.configApiKey.value || undefined,
    enabled: true,
    temperature: 0.1,
    timeout: 120
  };
  
  // If API key is empty and we already have one, don't clear it
  if (!config.api_key && providerConfigs[provider]?.has_api_key) {
    delete config.api_key;
  }
  
  try {
    await updateProviderConfig(provider, config);
    showConfigMessage('Configuration saved successfully', 'success');
    els.configApiKey.value = ''; // Clear the input for security
    await loadProviderConfigs(); // Refresh to show masked key
  } catch (err) {
    showConfigMessage(err.message || 'Failed to save configuration', 'error');
  }
}

async function handleTestConfig() {
  const provider = els.configProviderSelect.value;
  if (!provider) {
    showConfigMessage('No provider selected', 'error');
    return;
  }
  
  try {
    els.testConfigBtn.disabled = true;
    els.testConfigBtn.innerHTML = '<span class="material-symbols-outlined text-xs animate-spin">sync</span> Testing...';
    
    const result = await testProviderConfig(provider);
    
    if (result.success) {
      showConfigMessage(`Connection successful (${result.elapsed_seconds.toFixed(2)}s)`, 'success');
    } else {
      showConfigMessage(`Connection failed: ${result.message}`, 'error');
    }
  } catch (err) {
    showConfigMessage(err.message || 'Connection test failed', 'error');
  } finally {
    els.testConfigBtn.disabled = false;
    els.testConfigBtn.innerHTML = '<span class="material-symbols-outlined text-xs">network_check</span> Test';
  }
}

async function init() {
  // Load initial data
  await loadDocumentList();
  await loadProviderConfigs();
  
  // Event listeners
  els.refreshBtn.addEventListener('click', () => loadDocumentList(els.documentSearchInput.value.trim()));
  els.documentSearchInput.addEventListener('input', scheduleDocumentSearch);
  els.documentList.addEventListener('click', handleDocumentListClick);
  
  els.uploadBtn.addEventListener('click', () => els.uploadInput.click());
  els.uploadInput.addEventListener('change', handleUpload);
  
  els.configProviderSelect.addEventListener('change', updateConfigUI);
  els.saveConfigBtn.addEventListener('click', handleSaveConfig);
  els.testConfigBtn.addEventListener('click', handleTestConfig);
  
  initSearch();
  initSelection();
}

document.addEventListener('DOMContentLoaded', init);

export { loadDocumentList };

function scheduleDocumentSearch() {
  if (appState.searchDebounceTimer) {
    window.clearTimeout(appState.searchDebounceTimer);
  }
  appState.searchDebounceTimer = window.setTimeout(() => {
    loadDocumentList(els.documentSearchInput.value.trim());
  }, 220);
}

function handleDocumentListClick(event) {
  const button = event.target.closest('[data-doc-id]');
  if (!button) return;
  selectDocument(button.dataset.docId);
}

async function selectDocument(docId) {
  if (!docId) return;
  appState.selectedDocId = docId;
  renderDocumentList(els.documentSearchInput.value.trim());
  await loadDocument(docId);
}

function renderDocumentList(query = '', error = null) {
  const docs = appState.documents;
  if (error) {
    showDocumentSearchMeta(error.message || 'Failed to load documents');
    els.documentList.innerHTML = '<div class="rounded-xl border border-error/20 bg-error/10 px-3 py-4 text-sm text-error">Failed to load documents.</div>';
    return;
  }

  showDocumentSearchMeta(buildDocumentSearchMeta(docs.length, query));
  if (!docs.length) {
    els.documentList.innerHTML = `<div class="rounded-xl border border-white/6 bg-white/[0.03] px-3 py-6 text-center text-sm text-slate-500">${query ? 'No matching documents' : 'No documents yet. Upload a PDF to start.'}</div>`;
    return;
  }

  els.documentList.innerHTML = docs.map((doc) => renderDocumentCard(doc)).join('');
}

function renderDocumentCard(doc) {
  const isActive = doc.id === appState.selectedDocId;
  const primary = escapeHtml(doc.title || doc.display_name || doc.filename || 'Untitled document');
  const displayName = doc.title && doc.display_name && doc.display_name !== doc.title
    ? `<div class="text-[11px] text-slate-500 truncate">${escapeHtml(doc.display_name)}</div>`
    : '';
  const authors = Array.isArray(doc.authors) ? doc.authors.filter(Boolean).slice(0, 3).join(', ') : '';
  const year = doc.year ? ` · ${escapeHtml(String(doc.year))}` : '';
  const meta = authors ? `${escapeHtml(authors)}${year}` : doc.year ? escapeHtml(String(doc.year)) : 'Translation document';
  const pageCount = Number.isFinite(doc.page_count) ? `${doc.page_count} pages` : 'PDF';
  const textLayer = doc.text_layer_status === 'ready' ? 'Text selectable' : doc.text_layer_status || 'Pending';

  return `<button type="button" data-doc-id="${escapeHtml(doc.id)}" class="w-full text-left rounded-xl border px-3 py-3 transition-colors ${isActive ? 'bg-primary/10 border-primary/30' : 'bg-white/[0.03] border-white/[0.06] hover:border-white/[0.14] hover:bg-white/[0.05]'}">
    <div class="text-sm font-medium text-slate-200 leading-5">${primary}</div>
    ${displayName}
    <div class="mt-1 text-[11px] text-slate-500 leading-4">${meta}</div>
    <div class="mt-2 flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-500">
      <span>${escapeHtml(pageCount)}</span>
      <span>${escapeHtml(textLayer)}</span>
    </div>
  </button>`;
}

function buildDocumentSearchMeta(count, query) {
  if (query) {
    return `${count} result${count === 1 ? '' : 's'} for \"${query}\"`;
  }
  return `${count} document${count === 1 ? '' : 's'}`;
}

function showDocumentSearchMeta(message) {
  els.documentSearchMeta.textContent = message || '';
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (match) => {
    switch (match) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#039;';
      default:
        return match;
    }
  });
}
