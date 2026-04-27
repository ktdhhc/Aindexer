import { apiPath, readErrorMessage, readJsonSafe } from '../shared/http.js';

export async function askChatV0({ question, provider, model }) {
  const response = await fetch(apiPath('/chat/ask_v0'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: String(question || '').trim(),
      provider: String(provider || '').trim(),
      model: String(model || '').trim() || null,
    }),
  });
  if (!response.ok) throw new Error(await readErrorMessage(response, 'Chat V0 请求失败'));
  return readJsonSafe(response);
}
