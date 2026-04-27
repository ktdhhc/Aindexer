import { apiPath, readErrorMessage, readJsonSafe } from '../shared/http.js';

export async function listProviders() {
  const response = await fetch(apiPath('/providers'));
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, '读取 Provider 配置失败'));
  }
  const data = await readJsonSafe(response);
  return Array.isArray(data) ? data : [];
}

export async function getProviderApiKey(provider) {
  const response = await fetch(apiPath(`/providers/${encodeURIComponent(provider)}/api_key`));
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, '读取 API Key 失败'));
  }
  const data = await readJsonSafe(response);
  return String(data.api_key || '');
}

export async function updateProvider(provider, payload) {
  const response = await fetch(apiPath(`/providers/${encodeURIComponent(provider)}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `保存失败：${provider}`));
  }
  return readJsonSafe(response);
}

export async function testProvider(provider) {
  const response = await fetch(apiPath(`/providers/${encodeURIComponent(provider)}/test`), {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, '连接测试失败'));
  }
  return readJsonSafe(response);
}

export async function removeProvider(provider) {
  const response = await fetch(apiPath(`/providers/${encodeURIComponent(provider)}`), {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, '删除 Provider 失败'));
  }
  return readJsonSafe(response);
}

export async function resetProviders() {
  const response = await fetch(apiPath('/providers/reset_defaults'), { method: 'POST' });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, '恢复默认 Provider 配置失败'));
  }
  return readJsonSafe(response);
}
