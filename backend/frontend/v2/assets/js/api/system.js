import { apiPath, readErrorMessage } from '../shared/http.js';

export async function exitApp() {
  const response = await fetch(apiPath('/system/exit'), {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, '退出失败'));
  }

  return response.json().catch(() => ({}));
}
