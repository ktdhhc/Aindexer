import { apiPath, readErrorMessage } from '../shared/http.js';

export function exportDocUrl(docId) {
  return apiPath(`/export/${encodeURIComponent(docId)}`);
}

export function exportAllUrl() {
  return apiPath('/export/all');
}

export async function exportBackupAll() {
  const response = await fetch(apiPath('/export/backup/all'));
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, '导出失败'));
  }

  const blob = await response.blob();
  const contentDisposition = response.headers.get('Content-Disposition') || '';
  const match = /filename="?([^";]+)"?/i.exec(contentDisposition);
  return {
    blob,
    filename: match ? match[1] : `backup_all_${Date.now()}.zip`,
  };
}

export async function importBackupAll(file) {
  const formData = new FormData();
  formData.append('archive', file);

  const response = await fetch(apiPath('/export/backup/restore'), {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, '导入失败'));
  }

  return response.json().catch(() => ({}));
}
