import {
  DEFAULT_PROVIDER_ORDER,
  MODEL_PRESETS,
  getProviderCustomModels,
  getProviderRetry,
} from '../shared/storage.js';

const TITLE_OVERRIDES = {
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  glm: 'GLM',
  openrouter: 'OpenRouter',
};

export function sortProviderRecords(items) {
  const order = new Map(DEFAULT_PROVIDER_ORDER.map((provider, index) => [provider, index]));
  return [...items].sort((a, b) => {
    const left = String(a.provider || '').trim().toLowerCase();
    const right = String(b.provider || '').trim().toLowerCase();
    const li = order.has(left) ? order.get(left) : 999;
    const ri = order.has(right) ? order.get(right) : 999;
    if (li !== ri) return li - ri;
    return left.localeCompare(right, 'en');
  });
}

export function formatProviderTitle(provider) {
  const key = String(provider || '').trim().toLowerCase();
  if (!key) return 'New Provider';
  if (TITLE_OVERRIDES[key]) return TITLE_OVERRIDES[key];
  return key
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}

export function isDefaultProvider(provider) {
  return DEFAULT_PROVIDER_ORDER.includes(String(provider || '').trim().toLowerCase());
}

export function toProviderDraft(item, uid) {
  const provider = String(item.provider || '').trim();
  return {
    uid,
    provider,
    title: formatProviderTitle(provider),
    baseUrl: String(item.base_url || '').trim(),
    model: String(item.model || '').trim(),
    apiKeyMasked: String(item.api_key_masked || '').trim(),
    apiKeyInput: '',
    apiKeyVisible: false,
    apiKeyDirty: false,
    clearApiKey: false,
    temperature: Number(item.temperature ?? 0.1),
    timeout: Number(item.timeout || 120),
    retries: Number(getProviderRetry(provider, 3)),
    enabled: !!item.enabled,
    isDefault: isDefaultProvider(provider),
    isNew: false,
  };
}

export function createEmptyProviderDraft(uid, provider = '') {
  const cleanProvider = String(provider || '').trim();
  const providerKey = cleanProvider.toLowerCase();
  const preset = (MODEL_PRESETS[providerKey] || [])[0] || '';
  return {
    uid,
    provider: cleanProvider,
    title: formatProviderTitle(cleanProvider),
    baseUrl: '',
    model: preset,
    apiKeyMasked: '',
    apiKeyInput: '',
    apiKeyVisible: true,
    apiKeyDirty: false,
    clearApiKey: false,
    temperature: 0.1,
    timeout: 120,
    retries: 3,
    enabled: true,
    isDefault: false,
    isNew: true,
  };
}

export function getProviderStatus(draft) {
  if (!draft.enabled) {
    return { tone: 'warn', label: 'Disabled' };
  }
  if (String(draft.apiKeyMasked || '').trim() || String(draft.apiKeyInput || '').trim()) {
    return { tone: 'ok', label: 'Connected' };
  }
  return { tone: 'muted', label: 'No Key' };
}

export function getProviderModelOptions(draft) {
  const providerKey = String(draft.provider || '').trim().toLowerCase();
  const presets = MODEL_PRESETS[providerKey] || [];
  const custom = getProviderCustomModels(providerKey);
  const current = String(draft.model || '').trim();
  const options = [...new Set([...presets, ...custom].filter(Boolean))];
  if (current && !options.includes(current)) options.unshift(current);
  return options;
}

export function snapshotProviderDrafts(rows) {
  return rows.map((row) => ({
    provider: String(row.provider || '').trim(),
    baseUrl: String(row.baseUrl || '').trim(),
    model: String(row.model || '').trim(),
    apiKeyInput: row.apiKeyDirty ? String(row.apiKeyInput || '') : '',
    clearApiKey: !!row.clearApiKey,
    temperature: Number(row.temperature ?? 0.1),
    timeout: Number(row.timeout || 120),
    retries: Number(row.retries || 3),
    enabled: !!row.enabled,
    isDefault: !!row.isDefault,
    isNew: !!row.isNew,
  }));
}

export function validateProviderDraft(row) {
  const provider = String(row.provider || '').trim();
  if (!provider) return '接口名不能为空';
  if (!String(row.baseUrl || '').trim()) return `接口 ${provider} 的 Base URL 不能为空`;
  if (!String(row.model || '').trim()) return `接口 ${provider} 的模型不能为空`;
  const temperature = Number(row.temperature ?? 0.1);
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    return `接口 ${provider} 的温度必须在 0-2 之间`;
  }
  const timeout = Number(row.timeout || 120);
  if (!Number.isFinite(timeout) || timeout < 10 || timeout > 300) {
    return `接口 ${provider} 的超时必须在 10-300 秒之间`;
  }
  const retries = Number(row.retries || 3);
  if (!Number.isFinite(retries) || retries < 1 || retries > 8) {
    return `接口 ${provider} 的重试次数必须在 1-8 之间`;
  }
  return '';
}

export function toProviderPayload(row) {
  return {
    base_url: String(row.baseUrl || '').trim(),
    model: String(row.model || '').trim(),
    api_key: row.apiKeyDirty ? String(row.apiKeyInput || '').trim() || null : null,
    clear_api_key: !!row.clearApiKey || (row.apiKeyDirty && !String(row.apiKeyInput || '').trim() && !!row.apiKeyMasked),
    temperature: Number(row.temperature ?? 0.1),
    timeout: Number(row.timeout || 120),
    enabled: !!row.enabled,
  };
}
