import { initAppShell } from '../shared/app-shell.js';
import { listFields, removeField, updateFields, resetFields } from '../api/fields.js';

const state = {
  rows: [],
  baseline: '[]',
  message: { text: '正在加载字段配置...', tone: 'muted' },
};

let expandedFieldIndex = -1;

const refs = {
  grid: null,
  status: null,
  dock: null,
  saveBtn: null,
  resetBtn: null,
  discardBtn: null,
};

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
  return JSON.stringify(state.rows) !== state.baseline;
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

function handleAddField() {
  state.rows.push({
    label: '',
    description: '',
    field_type: 'text',
    required: false,
    enabled: true,
    is_default: false,
    _new: true
  });
  expandedFieldIndex = state.rows.length - 1;
  renderGrid();
}

async function handleDeleteField(index) {
  const row = state.rows[index];
  
  if (row._new) {
    state.rows.splice(index, 1);
    if (expandedFieldIndex === index) expandedFieldIndex = -1;
    else if (expandedFieldIndex > index) expandedFieldIndex--;
    renderGrid();
    return;
  }

  if (!confirm(`确定要删除字段 "${row.label}" 吗？`)) {
    return;
  }

  try {
    setMessage('正在删除...', 'muted');
    await removeField(row.field_key || row.label);
    state.rows.splice(index, 1);
    
    if (expandedFieldIndex === index) expandedFieldIndex = -1;
    else if (expandedFieldIndex > index) expandedFieldIndex--;
    
    // Update baseline so we don't show unsaved changes for the deleted row
    state.baseline = JSON.stringify(state.rows);
    
    renderGrid();
    setMessage('字段已删除', 'muted');
  } catch (error) {
    setMessage(error.message || '删除字段失败', 'err');
  }
}

function renderGrid() {
  if (!refs.grid) return;
  
  if (state.rows.length === 0) {
    refs.grid.innerHTML = `
      <div class="empty-state">暂无字段配置</div>
      <div class="fields-table-footer">
        <p class="footer-text">Showing 0 defined index fields</p>
        <button class="add-btn" data-action="add">
          <span class="material-symbols-outlined" data-icon="add">add</span>
          <span>Add New Field</span>
        </button>
      </div>
    `;
  } else {
    refs.grid.innerHTML = `
      <div class="fields-table-container">
        <table class="fields-table">
          <thead>
            <tr>
              <th></th>
              <th>Label</th>
              <th>Type</th>
              <th style="text-align: center">Required</th>
              <th style="text-align: center">Enabled</th>
              <th>Origin</th>
              <th style="text-align: right">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${state.rows.map((row, index) => {
              const isExpanded = index === expandedFieldIndex;
              return `
                <tr>
                  <td>
                    <button class="action-btn" data-action="toggle-expand" data-index="${index}">
                      <span class="material-symbols-outlined" data-icon="${isExpanded ? 'expand_more' : 'chevron_right'}">${isExpanded ? 'expand_more' : 'chevron_right'}</span>
                    </button>
                  </td>
                  <td>
                    <input type="text" class="input-clean" value="${escapeHtml(row.label)}" data-field="label" data-index="${index}" placeholder="Field Label">
                  </td>
                  <td>
                    <select class="select-clean" data-field="field_type" data-index="${index}">
                      <option value="text" ${row.field_type === 'text' ? 'selected' : ''}>Text</option>
                      <option value="number" ${row.field_type === 'number' ? 'selected' : ''}>Number</option>
                      <option value="list" ${row.field_type === 'list' ? 'selected' : ''}>List</option>
                    </select>
                  </td>
                  <td style="text-align: center">
                    <input type="checkbox" class="custom-checkbox" ${row.required ? 'checked' : ''} data-field="required" data-index="${index}">
                  </td>
                  <td style="text-align: center">
                    <label class="switch-toggle">
                      <input type="checkbox" ${row.enabled ? 'checked' : ''} data-field="enabled" data-index="${index}">
                      <div class="switch-track"><div class="switch-thumb"></div></div>
                    </label>
                  </td>
                  <td>
                    ${row.is_default ? '<span class="field-origin-badge">Default</span>' : '<span class="field-origin-custom">Custom</span>'}
                  </td>
                  <td style="text-align: right">
                    <button class="action-btn delete" data-action="delete" data-index="${index}">
                      <span class="material-symbols-outlined text-sm" data-icon="delete">delete</span>
                    </button>
                  </td>
                </tr>
                ${isExpanded ? `
                <tr class="expanded-content">
                  <td colspan="7">
                    <label>LLM Prompt Instruction</label>
                    <textarea class="textarea-clean" data-field="description" data-index="${index}" placeholder="Explain how the LLM should find this field...">${escapeHtml(row.description)}</textarea>
                  </td>
                </tr>
                ` : ''}
              `;
            }).join('')}
          </tbody>
        </table>
        <div class="fields-table-footer">
          <p class="footer-text">Showing ${state.rows.length} defined index fields</p>
          <button class="add-btn" data-action="add">
            <span class="material-symbols-outlined" data-icon="add">add</span>
            <span>Add New Field</span>
          </button>
        </div>
      </div>
    `;
  }
  updateActionButtons();
}

async function loadRows() {
  try {
    const items = await listFields();
    // Sort by sort_order
    state.rows = items.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    state.baseline = JSON.stringify(state.rows);
    renderGrid();
    setMessage('字段配置已加载', 'muted');
  } catch (error) {
    setMessage(error.message || '加载字段配置失败', 'err');
  }
}

async function handleSaveAll() {
  const cleanedRows = [];
  const seen = new Set();

  for (let i = 0; i < state.rows.length; i++) {
    const f = state.rows[i];
    const label = String(f.label || '').trim();
    
    if (!label) {
      setMessage(`第 ${i + 1} 行的字段名称不能为空`, 'err');
      return;
    }
    
    if (seen.has(label)) {
      setMessage(`字段名称 "${label}" 重复`, 'err');
      return;
    }
    
    seen.add(label);
    
    cleanedRows.push({
      ...f,
      label,
      field_key: label,
      sort_order: i + 1
    });
  }

  try {
    setMessage('正在保存...', 'muted');
    if (refs.saveBtn) refs.saveBtn.disabled = true;
    
    await updateFields(cleanedRows);
    
    state.baseline = JSON.stringify(cleanedRows);
    await loadRows();
    setMessage('字段配置已保存', 'muted');
  } catch (error) {
    setMessage(error.message || '保存失败', 'err');
    if (refs.saveBtn) refs.saveBtn.disabled = false;
  }
}

async function handleReset() {
  if (!confirm('确定要恢复默认配置吗？这将覆盖当前所有自定义字段。')) {
    return;
  }

  try {
    setMessage('正在恢复默认配置...', 'muted');
    await resetFields();
    await loadRows();
    setMessage('已恢复默认配置', 'muted');
  } catch (error) {
    setMessage(error.message || '恢复默认配置失败', 'err');
  }
}

async function handleDiscard() {
  if (!hasUnsavedChanges()) return;
  if (!confirm('确认放弃当前页面未保存的修改，并重新加载后端配置？')) {
    return;
  }
  try {
    setMessage('正在放弃修改...', 'muted');
    await loadRows();
    setMessage('已放弃修改', 'muted');
  } catch (error) {
    setMessage(error.message || '放弃修改失败', 'err');
  }
}

function bindEvents() {
  if (refs.saveBtn) refs.saveBtn.addEventListener('click', handleSaveAll);
  if (refs.resetBtn) refs.resetBtn.addEventListener('click', handleReset);
  if (refs.discardBtn) refs.discardBtn.addEventListener('click', handleDiscard);

  window.handleAppRefresh = () => loadRows();

  window.addEventListener('beforeunload', (event) => {
    if (!hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = '';
  });

  refs.grid.addEventListener('input', (e) => {
    const target = e.target;
    const index = target.dataset.index;
    const field = target.dataset.field;
    
    if (index !== undefined && field) {
      const row = state.rows[index];
      if (target.type === 'checkbox') {
        row[field] = target.checked;
      } else {
        row[field] = target.value;
      }
      updateActionButtons();
    }
  });

  refs.grid.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;

    const action = btn.dataset.action;
    const index = parseInt(btn.dataset.index, 10);

    if (action === 'add') {
      handleAddField();
    } else if (action === 'delete') {
      handleDeleteField(index);
    } else if (action === 'toggle-expand') {
      expandedFieldIndex = expandedFieldIndex === index ? -1 : index;
      renderGrid();
    }
  });
}

async function init() {
  refs.grid = document.getElementById('fieldsGrid');
  refs.status = document.getElementById('fieldsPageStatus');
  refs.dock = document.getElementById('fieldsActionDock');
  refs.saveBtn = document.getElementById('fieldsSaveBtn');
  refs.resetBtn = document.getElementById('fieldsResetBtn');
  refs.discardBtn = document.getElementById('fieldsDiscardBtn');

  initAppShell();
  bindEvents();

  await loadRows();
}

init();
