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
