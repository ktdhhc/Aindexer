import { apiPath, readErrorMessage, readJsonSafe } from '../shared/http.js';

export async function listFiles() {
  const response = await fetch(apiPath('/files'));
  if (!response.ok) throw new Error(await readErrorMessage(response, '读取文献列表失败'));
  const data = await readJsonSafe(response);
  return Array.isArray(data) ? data : [];
}

export async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch(apiPath('/files/upload'), {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) throw new Error(await readErrorMessage(response, `上传失败: ${file?.name || 'unknown'}`));
  return readJsonSafe(response);
}

export async function deleteFile(docId) {
  const response = await fetch(apiPath(`/files/${encodeURIComponent(docId)}`), {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error(await readErrorMessage(response, '删除文献失败'));
  return readJsonSafe(response);
}

export async function getFileDetail(docId) {
  const response = await fetch(apiPath(`/files/${encodeURIComponent(docId)}`));
  if (!response.ok) throw new Error(await readErrorMessage(response, '读取文献详情失败'));
  return readJsonSafe(response);
}

export async function updateDisplayName(docId, displayName) {
  const response = await fetch(apiPath(`/files/${encodeURIComponent(docId)}/display_name`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ display_name: displayName }),
  });
  if (!response.ok) throw new Error(await readErrorMessage(response, '更新显示名失败'));
  return readJsonSafe(response);
}
