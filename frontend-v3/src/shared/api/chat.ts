import { fetchJson } from "./http";

export interface ChatAskPayload {
  question: string;
  provider: string;
  model: string | null;
  workspace_id: string;
}

export type ChatMode = "wide" | "deep" | "agent";

export interface ChatSource {
  source_id?: string;
  doc_id: string;
  display_name: string;
  title?: string;
}

export interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
  sources?: ChatSource[];
}

export interface ChatContextStats {
  doc_count: number;
  model_context_window?: number;
  estimated_input_tokens?: number;
  compression_level?: "none" | "advisory" | "auto" | "fallback" | string;
  structured_fallback?: boolean;
  truncated?: boolean;
  wide_strategy?: "full_index" | "structured_summary" | string;
  total_indexed_count?: number;
  included_source_count?: number;
  omitted_source_count?: number;
  total_index_tokens?: number;
  wide_ranked_fallback?: boolean;
  ranked_candidate_count?: number;
  [key: string]: unknown;
}

const CITED_SOURCE_ID_PATTERN = /\b[IP]-?\d{2,}\b/gi;
const CITATION_FOOTER_PATTERN = /^引用(?:来源|索引|原文)：(.*)$/i;

export interface ChatAskV1Payload extends ChatAskPayload {
  mode: ChatMode;
  doc_ids?: string[];
  messages?: ChatHistoryMessage[];
  source_map?: Record<string, string>;
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
  | { type: "done"; finish_reason?: string | null }
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
    if (done) {
      buffer += decoder.decode();
      break;
    }
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

export function stripAssistantCitationFooter(content: string): string {
  return parseAssistantCitationInfo(content).content;
}

export function resolveAssistantCitedSources(content: string, sources?: ChatSource[]): ChatSource[] {
  const available = sources ?? [];
  if (available.length === 0) return [];
  if (!String(content || "").trim()) return [];

  const parsed = parseAssistantCitationInfo(content);
  const preferredIds = parsed.hasFooter ? parsed.sourceIds : extractUniqueSourceIds(parsed.content);
  if (parsed.hasFooter && preferredIds.length === 0) {
    return [];
  }
  if (preferredIds.length === 0) {
    return [];
  }

  const sourceMap = new Map(
    available
      .map((source) => [normalizeSourceId(source.source_id), source] as const)
      .filter(([sourceId]) => Boolean(sourceId)),
  );
  return preferredIds
    .map((sourceId) => sourceMap.get(sourceId))
    .filter((source): source is ChatSource => Boolean(source));
}

function parseAssistantCitationInfo(content: string): { content: string; sourceIds: string[]; hasFooter: boolean } {
  const raw = String(content || "");
  const lines = raw.split(/\r?\n/);
  let lastIndex = lines.length - 1;
  while (lastIndex >= 0 && !lines[lastIndex].trim()) {
    lastIndex -= 1;
  }
  if (lastIndex < 0) {
    return { content: "", sourceIds: [], hasFooter: false };
  }

  const matched = lines[lastIndex].trim().match(CITATION_FOOTER_PATTERN);
  if (!matched) {
    return { content: raw, sourceIds: [], hasFooter: false };
  }

  const stripped = lines.slice(0, lastIndex).join("\n").replace(/[\s\n]+$/g, "");
  return {
    content: stripped,
    sourceIds: extractUniqueSourceIds(matched[1] || ""),
    hasFooter: true,
  };
}

function extractUniqueSourceIds(content: string): string[] {
  const matched = String(content || "").match(CITED_SOURCE_ID_PATTERN) ?? [];
  const ordered: string[] = [];
  for (const item of matched) {
    const normalized = normalizeSourceId(item);
    if (normalized && !ordered.includes(normalized)) {
      ordered.push(normalized);
    }
  }
  return ordered;
}

export function normalizeSourceId(value: string | undefined | null): string {
  const raw = String(value || "").trim().toUpperCase();
  const match = raw.match(/^([IP])-?(\d{2,})$/);
  if (!match) return "";
  return `${match[1]}-${match[2]}`;
}
