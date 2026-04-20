import { fetchJson } from "./http";

export interface ChatAskPayload {
  question: string;
  provider: string;
  model: string | null;
  workspace_id: string;
}

export interface ChatAnswer {
  doc_id: string;
  display_name: string;
  answer: string;
}

export function askChatV0(payload: ChatAskPayload): Promise<ChatAnswer> {
  return fetchJson<ChatAnswer>("/api/chat/ask_v0", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
