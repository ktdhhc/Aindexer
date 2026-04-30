export const apiPath = (path) => `/api${path}`;

export async function readJsonSafe(response) {
  try {
    return await response.json();
  } catch (_) {
    return {};
  }
}

export async function readErrorMessage(response, fallback = '请求失败') {
  const data = await readJsonSafe(response);
  if (typeof data?.detail === 'string' && data.detail.trim()) return data.detail;
  if (typeof data?.message === 'string' && data.message.trim()) return data.message;
  return fallback;
}

export async function fetchDocuments() {
  const res = await fetch(apiPath('/translation/documents'));
  if (!res.ok) throw new Error(await readErrorMessage(res));
  return res.json();
}

export async function fetchDocument(id) {
  const res = await fetch(apiPath(`/translation/documents/${id}`));
  if (!res.ok) throw new Error(await readErrorMessage(res));
  return res.json();
}

export async function fetchDocumentPages(id) {
  const res = await fetch(apiPath(`/translation/documents/${id}/pages`));
  if (!res.ok) throw new Error(await readErrorMessage(res));
  return res.json();
}

export async function fetchDocumentHistory(id) {
  const res = await fetch(apiPath(`/translation/documents/${id}/history`));
  if (!res.ok) throw new Error(await readErrorMessage(res));
  return res.json();
}

export async function translateSelection(payload, options = {}) {
  const res = await fetch(apiPath('/translation/translate-selection'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: options.signal,
  });
  if (!res.ok) throw new Error(await readErrorMessage(res));
  return res.json();
}

export async function cancelTranslationRequest(clientRequestId) {
  const res = await fetch(apiPath(`/translation/requests/${clientRequestId}/cancel`), {
    method: 'POST'
  });
  if (!res.ok) throw new Error(await readErrorMessage(res));
  return res.json();
}

// Upload API
export async function uploadDocument(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(apiPath('/translation/documents/upload'), {
    method: 'POST',
    body: formData
  });
  if (!res.ok) throw new Error(await readErrorMessage(res));
  return res.json();
}

// Shared Provider Config APIs
export async function fetchProviders() {
  const res = await fetch(apiPath('/providers'));
  if (!res.ok) throw new Error(await readErrorMessage(res));
  return res.json();
}

export async function updateProviderConfig(provider, config) {
  const res = await fetch(apiPath(`/providers/${provider}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config)
  });
  if (!res.ok) throw new Error(await readErrorMessage(res));
  return res.json();
}

export async function testProviderConfig(provider) {
  const res = await fetch(apiPath(`/providers/${provider}/test`), {
    method: 'POST'
  });
  if (!res.ok) throw new Error(await readErrorMessage(res));
  return res.json();
}
