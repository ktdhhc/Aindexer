import { apiPath, readErrorMessage, readJsonSafe } from '../shared/http.js';

export async function listFields() {
  const response = await fetch(apiPath('/fields'));
  if (!response.ok) throw new Error(await readErrorMessage(response, '读取字段配置失败'));
  return readJsonSafe(response);
}

export async function updateFields(payload) {
  const response = await fetch(apiPath('/fields'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await readErrorMessage(response, '保存字段配置失败'));
  return readJsonSafe(response);
}

export async function resetFields() {
  const response = await fetch(apiPath('/fields/reset'), {
    method: 'POST',
  });
  if (!response.ok) throw new Error(await readErrorMessage(response, '恢复默认字段失败'));
  return readJsonSafe(response);
}

export async function removeField(fieldKey) {
  const response = await fetch(apiPath(`/fields/${encodeURIComponent(fieldKey)}`), {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error(await readErrorMessage(response, '删除字段失败'));
  return readJsonSafe(response);
}
