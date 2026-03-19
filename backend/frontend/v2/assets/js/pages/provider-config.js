import { initAppShell } from '../shared/app-shell.js?v=20260319-providerfix2';
import {
  deleteProviderCustomModels,
  deleteProviderRetry,
  getProviderCustomModels,
  getProviderRetriesMap,
  resetProviderCustomModels,
  resetProviderRetries,
  setProviderCustomModels,
  setProviderRetriesMap,
} from '../shared/storage.js?v=20260319-providerfix2';
import {
  createEmptyProviderDraft,
  formatProviderTitle,
  isDefaultProvider,
  getProviderModelOptions,
  getProviderStatus,
  snapshotProviderDrafts,
  sortProviderRecords,
  toProviderDraft,
  toProviderPayload,
  validateProviderDraft,
} from '../adapters/providers-adapter.js?v=20260319-providerfix2';
import {
  getProviderApiKey,
  listProviders,
  removeProvider,
  resetProviders,
  testProvider,
  updateProvider,
} from '../api/providers.js?v=20260319-providerfix2';
import { exportBackupAll, importBackupAll } from '../api/export.js?v=20260319-providerfix2';
import { exitApp } from '../api/system.js?v=20260319-providerfix2';

const state = {
  rows: [],
  baseline: '[]',
  message: { text: '正在加载 Provider 配置...', tone: 'muted' },
  testResults: {},
};

let providerDraftSeq = 0;

const refs = {
  grid: null,
  status: null,
  dock: null,
  saveBtn: null,
  resetBtn: null,
  discardBtn: null,
  exportAllBtnSide: null,
  importAllBtnSide: null,
  backupImportInput: null,
  exitAppBtn: null,
};

function nextUid() {
  providerDraftSeq += 1;
  return `pv2_${providerDraftSeq}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setMessage(text, tone = 'muted') {
  state.message = { text, tone };
  renderStatus();
}

function renderStatus() {
  if (!refs.status) return;
  refs.status.className = `action-status ${state.message.tone}`;
  refs.status.textContent = state.message.text;
}

function hasUnsavedChanges() {
  return JSON.stringify(snapshotProviderDrafts(state.rows)) !== state.baseline;
}

function markBaseline() {
  state.baseline = JSON.stringify(snapshotProviderDrafts(state.rows));
  updateActionButtons();
}

function updateActionDockVisibility() {
  if (!refs.dock) return;
  refs.dock.classList.toggle('is-visible', hasUnsavedChanges());
}

function updateActionButtons() {
  const dirty = hasUnsavedChanges();
  if (refs.saveBtn) refs.saveBtn.disabled = !dirty;
  if (refs.discardBtn) refs.discardBtn.disabled = !dirty;
  updateActionDockVisibility();
}

function getRow(uid) {
  return state.rows.find((row) => row.uid === uid) || null;
}

function renderProviderCard(row) {
  const status = getProviderStatus(row);
  const testState = state.testResults[row.provider] || { label: '未测试', tone: 'muted', title: '尚未执行连接测试' };
  const options = getProviderModelOptions(row);
  const modelOptionsHtml = options
    .map((model) => `<option value="${escapeHtml(model)}" ${model === row.model ? 'selected' : ''}>${escapeHtml(model)}</option>`)
    .join('');
  const chipsHtml = options.length
    ? options
        .map((model) => `<button class="chip ${model === row.model ? 'is-active' : ''}" type="button" data-action="select-model" data-uid="${escapeHtml(row.uid)}" data-model="${escapeHtml(model)}">${escapeHtml(model)}</button>`)
        .join('')
    : '<span class="provider-help">暂无模型，请先添加。</span>';
  const apiPlaceholder = row.apiKeyMasked && !row.apiKeyDirty && !row.apiKeyInput
    ? row.apiKeyMasked
    : '输入新的 API Key';

  return `
    <section class="provider-card glass-panel" data-provider-card="${escapeHtml(row.uid)}">
      <div class="provider-card__header">
        <div class="provider-card__title-wrap">
          <p class="provider-card__key">${escapeHtml(row.provider || 'new-provider')}</p>
          <h2 class="provider-card__title">${escapeHtml(row.title)}</h2>
          <div class="provider-card__pills">
            <span class="status-pill is-${escapeHtml(status.tone)}">${escapeHtml(status.label)}</span>
            <span class="status-pill is-test-${escapeHtml(testState.tone)}" title="${escapeHtml(testState.title)}">${escapeHtml(testState.label)}</span>
          </div>
        </div>
        <div class="provider-card__actions">
          <button class="btn btn-secondary btn-small" type="button" data-action="test" data-uid="${escapeHtml(row.uid)}">测试连接</button>
          <button class="btn ${row.isDefault ? 'btn-secondary' : 'btn-danger'} btn-small" type="button" data-action="delete" data-uid="${escapeHtml(row.uid)}" ${row.isDefault ? 'disabled title="内置接口不可删除"' : ''}>删除</button>
        </div>
      </div>

      <div class="provider-form-grid">
        <div class="field field-span-2">
          <label>接口名</label>
          <input class="input-clean" type="text" data-field="provider" data-uid="${escapeHtml(row.uid)}" value="${escapeHtml(row.provider)}" ${row.isNew ? '' : 'disabled'} placeholder="例如 openai / deepseek / my-provider" />
        </div>

        <div class="field field-span-2">
          <label>Base URL</label>
          <input class="input-clean" type="text" data-field="baseUrl" data-uid="${escapeHtml(row.uid)}" value="${escapeHtml(row.baseUrl)}" placeholder="https://api.example.com/v1" />
        </div>

        <div class="field field-span-2">
          <label>API Key</label>
          <div class="provider-key-row">
            <input class="input-clean" type="${row.apiKeyVisible ? 'text' : 'password'}" data-field="apiKeyInput" data-uid="${escapeHtml(row.uid)}" value="${escapeHtml(row.apiKeyInput)}" placeholder="${escapeHtml(apiPlaceholder)}" autocomplete="off" />
            <button class="btn btn-secondary btn-small" type="button" data-action="toggle-api-key" data-uid="${escapeHtml(row.uid)}">${row.apiKeyVisible ? '隐藏' : '显示'}</button>
            <button class="btn btn-ghost btn-small" type="button" data-action="clear-api-key" data-uid="${escapeHtml(row.uid)}">清空</button>
          </div>
        </div>

        <div class="field field-span-2">
          <label>当前模型</label>
          <div class="provider-model-row">
            <select class="select-clean" data-field="model" data-uid="${escapeHtml(row.uid)}">
              ${modelOptionsHtml}
            </select>
            <button class="btn btn-secondary btn-small" type="button" data-action="add-model" data-uid="${escapeHtml(row.uid)}">添加模型</button>
            <button class="btn btn-ghost btn-small" type="button" data-action="remove-model" data-uid="${escapeHtml(row.uid)}">移除当前</button>
          </div>
        </div>

        <div class="field">
          <label>超时（秒）</label>
          <input class="input-clean" type="number" min="10" max="300" step="1" data-field="timeout" data-uid="${escapeHtml(row.uid)}" value="${escapeHtml(row.timeout)}" />
        </div>

        <div class="field">
          <label>重试次数（本地）</label>
          <input class="input-clean" type="number" min="1" max="8" step="1" data-field="retries" data-uid="${escapeHtml(row.uid)}" value="${escapeHtml(row.retries)}" />
        </div>

        <div class="field field-span-2">
          <div class="provider-temp-head">
            <label>Temperature</label>
            <span class="provider-temp-value" data-temp-value="${escapeHtml(row.uid)}">${Number(row.temperature ?? 0.1).toFixed(1)}</span>
          </div>
          <input type="range" min="0" max="2" step="0.1" data-field="temperature" data-uid="${escapeHtml(row.uid)}" value="${escapeHtml(row.temperature)}" />
        </div>

        <div class="field field-span-2">
          <label>状态控制</label>
          <label class="provider-inline-flag">
            <input type="checkbox" data-field="enabled" data-uid="${escapeHtml(row.uid)}" ${row.enabled ? 'checked' : ''} />
            <span>启用此 Provider</span>
          </label>
        </div>
      </div>

      <div class="provider-section">
        <div class="provider-section-head">
          <label>Model Registry</label>
          <span class="provider-help">当前兼容旧版的本地扩展模型机制</span>
        </div>
        <div class="chip-row">
          ${chipsHtml}
        </div>
      </div>
    </section>
  `;
}

function renderAddProviderTile() {
  return `
    <button class="provider-empty" type="button" data-action="add-provider">
      <span class="provider-empty__plus">+</span>
      <div>
        <h2>新增接口</h2>
        <p>接入 OpenAI、DeepSeek、GLM、OpenRouter 或自定义网关。</p>
      </div>
    </button>
  `;
}

function renderGrid() {
  if (!refs.grid) return;
  refs.grid.innerHTML = state.rows.map(renderProviderCard).join('') + renderAddProviderTile();
  updateActionButtons();
}

async function loadRows() {
  const items = await listProviders();
  state.rows = sortProviderRecords(items).map((item) => toProviderDraft(item, nextUid()));
  renderGrid();
  markBaseline();
}

async function refreshRows(messageText = '已同步最新 Provider 配置') {
  await loadRows();
  setMessage(messageText, 'ok');
}

function updateTitleFromProvider(row) {
  row.title = formatProviderTitle(row.provider);
}

function setTestResult(provider, payload) {
  const key = String(provider || '').trim();
  if (!key) return;
  state.testResults[key] = payload;
}

function clearBackupImportInput() {
  if (refs.backupImportInput) refs.backupImportInput.value = '';
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

function handleFieldInput(target) {
  const uid = target.getAttribute('data-uid');
  const field = target.getAttribute('data-field');
  const row = getRow(uid);
  if (!row || !field) return;

  if (field === 'enabled') {
    row.enabled = !!target.checked;
    renderGrid();
    return;
  }

  if (field === 'temperature') {
    row.temperature = Number(target.value || 0);
    const badge = document.querySelector(`[data-temp-value="${uid}"]`);
    if (badge) badge.textContent = Number(row.temperature || 0).toFixed(1);
    updateActionButtons();
    return;
  }

  if (field === 'timeout' || field === 'retries') {
    row[field] = Number(target.value || 0);
    updateActionButtons();
    return;
  }

  if (field === 'apiKeyInput') {
    row.apiKeyInput = target.value;
    row.apiKeyDirty = true;
    row.clearApiKey = false;
    updateActionButtons();
    return;
  }

  row[field] = target.value;
  if (field === 'provider') {
    row.isDefault = isDefaultProvider(row.provider);
    updateTitleFromProvider(row);
    const card = target.closest('[data-provider-card]');
    const titleNode = card?.querySelector('.provider-card__title');
    const keyNode = card?.querySelector('.provider-card__key');
    if (titleNode) titleNode.textContent = row.title;
    if (keyNode) keyNode.textContent = row.provider || 'new-provider';
  }
  updateActionButtons();
}

function ensureUniqueProvider(provider) {
  const key = String(provider || '').trim().toLowerCase();
  return !state.rows.some((row) => String(row.provider || '').trim().toLowerCase() === key);
}

function getRowsSnapshotForSave() {
  return state.rows.map((row) => ({ ...row }));
}

async function saveRows(rowsToSave = state.rows) {
  const rows = rowsToSave.map((row) => ({ ...row, provider: String(row.provider || '').trim(), baseUrl: String(row.baseUrl || '').trim(), model: String(row.model || '').trim() }));
  const names = rows.map((row) => row.provider).filter(Boolean);
  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate) {
    throw new Error(`接口名重复：${duplicate}`);
  }
  for (const row of rows) {
    const errorText = validateProviderDraft(row);
    if (errorText) throw new Error(errorText);
  }

  const retryMap = getProviderRetriesMap();
  for (const row of rows) {
    await updateProvider(row.provider, toProviderPayload(row));
    retryMap[row.provider] = Number(row.retries || 3);
  }
  setProviderRetriesMap(retryMap);
}

async function handleSaveAll() {
  refs.saveBtn.disabled = true;
  setMessage('正在保存全部 Provider 配置...', 'muted');
  try {
    await saveRows(getRowsSnapshotForSave());
    await refreshRows('Provider 配置已保存，新版页面已与后端同步');
  } catch (error) {
    setMessage(error.message || '保存失败', 'err');
  } finally {
    updateActionButtons();
  }
}

async function handleReset() {
  const yes = window.confirm('将恢复全部默认接口配置，并删除所有自定义接口，同时清空默认接口的 API Key。是否继续？');
  if (!yes) return;
  refs.resetBtn.disabled = true;
  setMessage('正在恢复默认 Provider 配置...', 'muted');
  try {
    await resetProviders();
    resetProviderCustomModels();
    resetProviderRetries();
    await refreshRows('已恢复默认 Provider 配置，并清空本地扩展模型/重试设置');
  } catch (error) {
    setMessage(error.message || '恢复默认失败', 'err');
  } finally {
    refs.resetBtn.disabled = false;
    updateActionButtons();
  }
}

async function handleDiscard() {
  if (!hasUnsavedChanges()) return;
  const yes = window.confirm('确认放弃当前页面未保存的修改，并重新加载后端配置？');
  if (!yes) return;
  setMessage('正在还原当前页面修改...', 'muted');
  try {
    await refreshRows('已放弃本页修改，并重新同步后端配置');
  } catch (error) {
    setMessage(error.message || '重新加载失败', 'err');
  }
}

async function handleTest(uid) {
  const row = getRow(uid);
  if (!row) return;
  try {
    const errorText = validateProviderDraft(row);
    if (errorText) throw new Error(errorText);
    setTestResult(row.provider, {
      label: '测试中',
      tone: 'warn',
      title: '正在测试连接',
    });
    renderGrid();
    setMessage(`正在测试 ${row.provider} 的连接...`, 'muted');
    await saveRows([row]);
    const result = await testProvider(row.provider);
    const elapsed = Number(result.elapsed_seconds || 0);
    const detailText = `${result.success ? '连接成功' : '连接失败'}${result.message ? ` · ${result.message}` : ''}${elapsed ? ` · ${elapsed}s` : ''}`;
    setTestResult(row.provider, {
      label: result.success ? '测试成功' : '测试失败',
      tone: result.success ? 'ok' : 'err',
      title: detailText,
    });
    renderGrid();
    setMessage(
      `${row.provider}: ${detailText}`,
      result.success ? 'ok' : 'err'
    );
  } catch (error) {
    setTestResult(row.provider, {
      label: '测试失败',
      tone: 'err',
      title: error.message || '连接测试失败',
    });
    renderGrid();
    setMessage(error.message || '连接测试失败', 'err');
  }
}

async function handleDelete(uid) {
  const row = getRow(uid);
  if (!row) return;
  if (row.isDefault) {
    setMessage('内置接口不可删除', 'err');
    return;
  }
  if (row.isNew) {
    state.rows = state.rows.filter((item) => item.uid !== uid);
    renderGrid();
    setMessage('已移除未保存的自定义接口', 'ok');
    return;
  }
  const yes = window.confirm(`确认删除接口 ${row.provider}？`);
  if (!yes) return;
  try {
    await removeProvider(row.provider);
    deleteProviderCustomModels(row.provider);
    deleteProviderRetry(row.provider);
    state.rows = state.rows.filter((item) => item.uid !== uid);
    renderGrid();
    markBaseline();
    setMessage(`已删除接口 ${row.provider}`, 'ok');
  } catch (error) {
    setMessage(error.message || '删除接口失败', 'err');
  }
}

async function handleToggleApiKey(uid) {
  const row = getRow(uid);
  if (!row) return;
  try {
    if (!row.apiKeyVisible && row.apiKeyMasked && !row.apiKeyDirty && !row.apiKeyInput && row.provider) {
      row.apiKeyInput = await getProviderApiKey(row.provider);
      row.apiKeyDirty = false;
      row.clearApiKey = false;
    }
    row.apiKeyVisible = !row.apiKeyVisible;
    renderGrid();
  } catch (error) {
    setMessage(error.message || '读取 API Key 失败', 'err');
  }
}

function handleClearApiKey(uid) {
  const row = getRow(uid);
  if (!row) return;
  row.apiKeyInput = '';
  row.apiKeyDirty = true;
  row.clearApiKey = !!row.apiKeyMasked;
  row.apiKeyVisible = true;
  renderGrid();
  setMessage(`已标记清空 ${row.provider || '当前接口'} 的 API Key，保存后生效`, 'muted');
}

function handleAddProvider() {
  const name = window.prompt('请输入新的接口名（例如 openai-compatible）');
  const provider = String(name || '').trim().toLowerCase();
  if (!provider) return;
  if (!ensureUniqueProvider(provider)) {
    setMessage(`接口名已存在：${provider}`, 'err');
    return;
  }
  state.rows = [createEmptyProviderDraft(nextUid(), provider), ...state.rows];
  renderGrid();
  setMessage(`已新增接口 ${provider}，请填写参数后保存`, 'ok');
}

function handleAddModel(uid) {
  const row = getRow(uid);
  if (!row) return;
  const provider = String(row.provider || '').trim().toLowerCase();
  if (!provider) {
    setMessage('请先填写接口名，再新增模型', 'err');
    return;
  }
  const name = window.prompt(`请输入要新增的模型名（${provider}）`);
  const model = String(name || '').trim();
  if (!model) return;
  const customModels = getProviderCustomModels(provider);
  const options = new Set(getProviderModelOptions(row));
  if (options.has(model)) {
    setMessage('该模型已存在', 'muted');
    return;
  }
  setProviderCustomModels(provider, [...customModels, model]);
  row.model = model;
  renderGrid();
  setMessage(`已为 ${provider} 新增模型 ${model}`, 'ok');
}

function handleRemoveModel(uid) {
  const row = getRow(uid);
  if (!row) return;
  const provider = String(row.provider || '').trim().toLowerCase();
  const current = String(row.model || '').trim();
  if (!provider || !current) {
    setMessage('当前没有可删除的模型项', 'err');
    return;
  }
  const customModels = getProviderCustomModels(provider);
  if (!customModels.includes(current)) {
    setMessage('只能删除自定义模型项', 'err');
    return;
  }
  const yes = window.confirm(`确定删除自定义模型 ${current}？`);
  if (!yes) return;
  const remain = customModels.filter((item) => item !== current);
  setProviderCustomModels(provider, remain);
  row.model = remain[0] || getProviderModelOptions({ ...row, model: '' }).find(Boolean) || '';
  renderGrid();
  setMessage(`已移除模型 ${current}`, 'ok');
}

function handleSelectModel(uid, model) {
  const row = getRow(uid);
  if (!row) return;
  row.model = String(model || '').trim();
  renderGrid();
}

async function handleBackupExport() {
  setMessage('正在准备备份包...', 'muted');
  try {
    const result = await exportBackupAll();
    downloadBlob(result.blob, result.filename);
    setMessage('备份导出成功', 'ok');
  } catch (error) {
    setMessage(error.message || '导出失败', 'err');
  }
}

function triggerBackupImport() {
  clearBackupImportInput();
  refs.backupImportInput?.click();
}

async function handleBackupImport(event) {
  const file = event.target?.files?.[0];
  if (!file) return;
  const yes = window.confirm('导入将覆盖当前文件、索引和配置，是否继续？');
  if (!yes) {
    clearBackupImportInput();
    return;
  }

  setMessage('正在导入并恢复数据...', 'warn');
  try {
    const result = await importBackupAll(file);
    await loadRows();
    const message = result.pre_restore_backup
      ? `导入成功，已创建恢复前快照：${result.pre_restore_backup}`
      : '导入成功';
    setMessage(message, 'ok');
  } catch (error) {
    setMessage(error.message || '导入失败', 'err');
  } finally {
    clearBackupImportInput();
  }
}

function bindEvents() {
  refs.grid.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.matches('[data-field]')) handleFieldInput(target);
  });

  refs.grid.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.matches('[data-field]')) handleFieldInput(target);
  });

  refs.grid.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;
    if (!target) return;
    const action = target.getAttribute('data-action');
    const uid = target.getAttribute('data-uid') || '';
    if (action === 'add-provider') handleAddProvider();
    if (action === 'test') handleTest(uid);
    if (action === 'delete') handleDelete(uid);
    if (action === 'toggle-api-key') handleToggleApiKey(uid);
    if (action === 'clear-api-key') handleClearApiKey(uid);
    if (action === 'add-model') handleAddModel(uid);
    if (action === 'remove-model') handleRemoveModel(uid);
    if (action === 'select-model') handleSelectModel(uid, target.getAttribute('data-model') || '');
  });

  refs.saveBtn.addEventListener('click', handleSaveAll);
  refs.resetBtn.addEventListener('click', handleReset);
  refs.discardBtn.addEventListener('click', handleDiscard);
  refs.exportAllBtnSide?.addEventListener('click', handleBackupExport);
  refs.importAllBtnSide?.addEventListener('click', triggerBackupImport);
  refs.backupImportInput?.addEventListener('change', handleBackupImport);

  window.addEventListener('beforeunload', (event) => {
    if (!hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = '';
  });

  if (refs.exitAppBtn) {
    refs.exitAppBtn.addEventListener('click', async () => {
      const yes = window.confirm('确定退出 Aindexer 吗？');
      if (!yes) return;
      refs.exitAppBtn.disabled = true;
      setMessage('正在退出应用...', 'warn');
      try {
        await exitApp();
        setMessage('应用已退出，可关闭此页面', 'ok');
        exitFrontendWindow();
      } catch (error) {
        refs.exitAppBtn.disabled = false;
        setMessage(error.message || '退出失败', 'err');
      }
    });
  }
}

async function init() {
  refs.grid = document.getElementById('providerGrid');
  refs.status = document.getElementById('providerPageStatus');
  refs.dock = document.getElementById('providerActionDock');
  refs.saveBtn = document.getElementById('providerSaveBtn');
  refs.resetBtn = document.getElementById('providerResetBtn');
  refs.discardBtn = document.getElementById('providerDiscardBtn');
  refs.exportAllBtnSide = document.getElementById('exportAllBtnSide');
  refs.importAllBtnSide = document.getElementById('importAllBtnSide');
  refs.backupImportInput = document.getElementById('backupImportInput');
  refs.exitAppBtn = document.getElementById('exitAppBtn');

  initAppShell();
  bindEvents();

  try {
    await loadRows();
    setMessage('新版 Provider 配置页已接入现有后端；经典版入口仍可继续使用。', 'muted');
  } catch (error) {
    setMessage(error.message || '初始化 Provider 配置页失败', 'err');
  }
}

init();
