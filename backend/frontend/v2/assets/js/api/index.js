import { apiPath, readErrorMessage, readJsonSafe } from '../shared/http.js';

export async function runIndex(docId, provider, model, retries) {
  const query = new URLSearchParams({
    provider: String(provider || ''),
    model: String(model || ''),
    retries: String(retries || 3),
  });
  const response = await fetch(apiPath(`/index/${encodeURIComponent(docId)}/run?${query.toString()}`), {
    method: 'POST',
  });
  if (!response.ok) throw new Error(await readErrorMessage(response, '启动索引失败'));
  return readJsonSafe(response);
}

export async function runAll(provider, model, retries) {
  const query = new URLSearchParams({
    provider: String(provider || ''),
    model: String(model || ''),
    retries: String(retries || 3),
  });
  const response = await fetch(apiPath(`/index/run_all?${query.toString()}`), {
    method: 'POST',
  });
  if (!response.ok) throw new Error(await readErrorMessage(response, '批量索引启动失败'));
  return readJsonSafe(response);
}

export async function cancelIndex(docId) {
  const response = await fetch(apiPath(`/index/${encodeURIComponent(docId)}/cancel`), {
    method: 'POST',
  });
  if (!response.ok) throw new Error(await readErrorMessage(response, '取消索引失败'));
  return readJsonSafe(response);
}

export async function resetIndex(docId) {
  const response = await fetch(apiPath(`/index/${encodeURIComponent(docId)}/reset`), {
    method: 'POST',
  });
  if (!response.ok) throw new Error(await readErrorMessage(response, '重置索引失败'));
  return readJsonSafe(response);
}

export async function getMarkdown(docId) {
  const response = await fetch(apiPath(`/index/${encodeURIComponent(docId)}/markdown`));
  if (!response.ok) throw new Error(await readErrorMessage(response, '读取索引内容失败'));
  return readJsonSafe(response);
}

export async function getIndexDetail(docId) {
  const response = await fetch(apiPath(`/index/${encodeURIComponent(docId)}`));
  if (!response.ok) throw new Error(await readErrorMessage(response, '读取索引详情失败'));
  return readJsonSafe(response);
}

export async function saveMarkdown(docId, markdown) {
  const response = await fetch(apiPath(`/index/${encodeURIComponent(docId)}/markdown`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdown }),
  });
  if (!response.ok) throw new Error(await readErrorMessage(response, '保存索引内容失败'));
  return readJsonSafe(response);
}

export async function updateIndexEditor(docId, payload) {
  const response = await fetch(apiPath(`/index/${encodeURIComponent(docId)}/editor`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await readErrorMessage(response, '保存编辑内容失败'));
  return readJsonSafe(response);
}
