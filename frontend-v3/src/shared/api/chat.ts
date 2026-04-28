import { fetchJson } from "./http";

export interface ChatAskPayload {
  question: string;
  provider: string;
  model: string | null;
  workspace_id: string;
}

export type ChatMode = "wide" | "deep" | "agent";

export interface ChatSource {
  doc_id: string;
  display_name: string;
  title?: string;
}

export interface ChatContextStats {
  doc_count: number;
  model_context_window?: number;
  estimated_input_tokens?: number;
  compression_level?: "none" | "advisory" | "auto" | "fallback" | string;
  structured_fallback?: boolean;
  truncated?: boolean;
  [key: string]: unknown;
}

export interface ChatAskV1Payload extends ChatAskPayload {
  mode: ChatMode;
  doc_ids?: string[];
  session_id?: string;
}

export interface ChatAnswer {
  doc_id: string;
  display_name: string;
  answer: string;
}

export interface ChatAnswerV1 {
  answer: string;
  mode: ChatMode;
  sources: ChatSource[];
  context_stats: ChatContextStats;
}

export type ChatStreamEvent =
  | { type: "meta"; mode: ChatMode; sources: ChatSource[]; context_stats: ChatContextStats }
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

export function askChatV0(payload: ChatAskPayload): Promise<ChatAnswer> {
  return askChatV0WithSignal(payload);
}

export function askChatV0WithSignal(payload: ChatAskPayload, signal?: AbortSignal): Promise<ChatAnswer> {
  return fetchJson<ChatAnswer>("/api/chat/ask_v0", {
    method: "POST",
    body: JSON.stringify(payload),
    signal,
  });
}

export function askChatWithSignal(payload: ChatAskV1Payload, signal?: AbortSignal): Promise<ChatAnswerV1> {
  return fetchJson<ChatAnswerV1>("/api/chat/ask", {
    method: "POST",
    body: JSON.stringify(payload),
    signal,
  });
}

export async function streamChatWithSignal(
  payload: ChatAskV1Payload,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch("/api/chat/ask_stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => ({}))) as { detail?: string; message?: string };
    throw new Error(errorPayload.detail || errorPayload.message || `HTTP ${response.status}`);
  }
  if (!response.body) {
    throw new Error("流式响应不可用");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const event = JSON.parse(trimmed) as ChatStreamEvent;
      onEvent(event);
      if (event.type === "error") {
        throw new Error(event.message);
      }
    }
  }
  const tail = buffer.trim();
  if (tail) {
    const event = JSON.parse(tail) as ChatStreamEvent;
    onEvent(event);
    if (event.type === "error") {
      throw new Error(event.message);
    }
  }
}
