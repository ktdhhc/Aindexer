import { 
  fetchDocuments, 
  uploadDocument,
  fetchTranslatorProviders,
  fetchTranslatorProviderConfig,
  updateTranslatorProviderConfig,
  testTranslatorProviderConfig
} from './api.js';
import { loadDocument, refreshDocumentList } from './viewer.js';
import { initSearch } from './search.js';
import { initSelection } from './selection.js';

const els = {
  docSelect: document.getElementById('documentSelect'),
  loadBtn: document.getElementById('loadDocBtn'),
  refreshBtn: document.getElementById('refreshDocsBtn'),
  uploadInput: document.getElementById('uploadFileInput'),
  uploadBtn: document.getElementById('uploadBtn'),
  uploadStatus: document.getElementById('uploadStatus'),
  configProviderSelect: document.getElementById('configProviderSelect'),
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

async function loadDocumentList() {
  try {
    const docs = await fetchDocuments();
    const currentValue = els.docSelect.value;
    els.docSelect.innerHTML = '<option value="">Select Document...</option>' + 
      docs.map(d => `<option value="${d.id}">${d.display_name || d.filename}</option>`).join('');
    // Restore selection if still exists
    if (currentValue && docs.find(d => d.id === currentValue)) {
      els.docSelect.value = currentValue;
    }
    return docs;
  } catch (err) {
    console.error('Failed to load documents:', err);
    return [];
  }
}

async function loadProviderConfigs() {
  try {
    const providers = await fetchTranslatorProviders();
    providerConfigs = {};
    providers.forEach(p => {
      providerConfigs[p.provider] = p;
    });
    updateConfigUI();
  } catch (err) {
    console.error('Failed to load provider configs:', err);
    showConfigMessage('Failed to load provider configs', 'error');
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
  }
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
    
    // Refresh document list and select the uploaded doc
    await refreshDocumentList(result.document_id);
    
    // Clear input
    els.uploadInput.value = '';
    
    // Auto-load the document
    if (result.document_id) {
      await loadDocument(result.document_id);
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
    await updateTranslatorProviderConfig(provider, config);
    showConfigMessage('Configuration saved successfully', 'success');
    els.configApiKey.value = ''; // Clear the input for security
    await loadProviderConfigs(); // Refresh to show masked key
  } catch (err) {
    showConfigMessage(err.message || 'Failed to save configuration', 'error');
  }
}

async function handleTestConfig() {
  const provider = els.configProviderSelect.value;
  
  try {
    els.testConfigBtn.disabled = true;
    els.testConfigBtn.innerHTML = '<span class="material-symbols-outlined text-xs animate-spin">sync</span> Testing...';
    
    const result = await testTranslatorProviderConfig(provider);
    
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
  els.loadBtn.addEventListener('click', () => loadDocument(els.docSelect.value));
  els.refreshBtn.addEventListener('click', loadDocumentList);
  
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
