import { apiPath, readErrorMessage, readJsonSafe } from '../shared/http.js';

export async function searchDocs(query = '', options = {}) {
  const q = String(query || '').trim();
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (options.status) params.set('status', String(options.status));
  const endpoint = params.size ? apiPath(`/search?${params.toString()}`) : apiPath('/search');
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(await readErrorMessage(response, '搜索失败'));
  const data = await readJsonSafe(response);
  return Array.isArray(data) ? data : [];
}
