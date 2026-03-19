export const MODEL_PRESETS = {
  openai: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini', 'gpt-4o'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  glm: ['glm-4-flash'],
  openrouter: [
    'openai/gpt-4o-mini',
    'openai/gpt-5.2',
    'anthropic/claude-3.5-sonnet',
    'google/gemini-2.0-flash-001',
    'deepseek/deepseek-chat',
    'meta-llama/llama-3.1-70b-instruct',
    'moonshotai/kimi-k2-0905',
  ],
};

export const DEFAULT_PROVIDER_ORDER = ['openai', 'deepseek', 'glm', 'openrouter'];
export const PROVIDER_CUSTOM_MODELS_KEY = 'li_provider_custom_models';
export const PROVIDER_RETRIES_KEY = 'li_provider_retries';

function safeReadJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function safeWriteJson(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function getProviderCustomModelsMap() {
  const mapObj = safeReadJson(PROVIDER_CUSTOM_MODELS_KEY, {});
  if (!mapObj.openrouter) {
    try {
      const legacyRaw = window.localStorage.getItem('li_openrouter_custom_models');
      const legacyArr = legacyRaw ? JSON.parse(legacyRaw) : [];
      if (Array.isArray(legacyArr) && legacyArr.length) mapObj.openrouter = legacyArr;
    } catch (_) {
      // ignore legacy parse errors
    }
  }
  return mapObj;
}

export function setProviderCustomModelsMap(mapObj) {
  safeWriteJson(PROVIDER_CUSTOM_MODELS_KEY, mapObj || {});
}

export function getProviderCustomModels(provider) {
  const key = String(provider || '').trim().toLowerCase();
  if (!key) return [];
  const mapObj = getProviderCustomModelsMap();
  const value = mapObj[key];
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
}

export function setProviderCustomModels(provider, models) {
  const key = String(provider || '').trim().toLowerCase();
  if (!key) return;
  const mapObj = getProviderCustomModelsMap();
  const nextModels = [...new Set((models || []).map((item) => String(item || '').trim()).filter(Boolean))];
  mapObj[key] = nextModels;
  setProviderCustomModelsMap(mapObj);
}

export function deleteProviderCustomModels(provider) {
  const key = String(provider || '').trim().toLowerCase();
  if (!key) return;
  const mapObj = getProviderCustomModelsMap();
  delete mapObj[key];
  setProviderCustomModelsMap(mapObj);
}

export function resetProviderCustomModels() {
  setProviderCustomModelsMap({});
}

export function getProviderRetriesMap() {
  return safeReadJson(PROVIDER_RETRIES_KEY, {});
}

export function setProviderRetriesMap(mapObj) {
  safeWriteJson(PROVIDER_RETRIES_KEY, mapObj || {});
}

export function getProviderRetry(provider, fallback = 3) {
  const key = String(provider || '').trim();
  if (!key) return fallback;
  const mapObj = getProviderRetriesMap();
  const value = Number(mapObj[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function setProviderRetry(provider, retry) {
  const key = String(provider || '').trim();
  if (!key) return;
  const mapObj = getProviderRetriesMap();
  mapObj[key] = retry;
  setProviderRetriesMap(mapObj);
}

export function deleteProviderRetry(provider) {
  const key = String(provider || '').trim();
  if (!key) return;
  const mapObj = getProviderRetriesMap();
  delete mapObj[key];
  setProviderRetriesMap(mapObj);
}

export function resetProviderRetries() {
  setProviderRetriesMap({});
}
