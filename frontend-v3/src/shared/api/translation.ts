import { fetchJson } from "./http";

export interface TranslationDocument {
  id: string;
  workspace_id: string;
  filename: string;
  display_name: string;
  file_type?: string;
  file_path?: string;
  page_count?: number | null;
  text_layer_status: string;
  created_at: string | null;
  updated_at?: string | null;
}

export interface TranslationPageText {
  document_id: string;
  page_number: number;
  text_content: string;
  text_map_json?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface TranslationHistoryItem {
  request_id: string;
  provider: string;
  model: string;
  source_text: string;
  translated_text: string;
  target_lang: string;
  created_at: string;
}

export interface TranslationSelectionPayload {
  document_id: string;
  workspace_id: string;
  provider: string;
  model?: string | null;
  source_text: string;
  target_lang: string;
  source_lang?: string | null;
  anchor?: {
    page: number;
    quote: string;
    version?: string;
  };
  enable_thinking?: boolean;
  metadata?: Record<string, unknown>;
}

export interface TranslationResult {
  request_id: string;
  document_id: string;
  provider: string;
  model: string;
  target_lang: string;
  source_lang?: string | null;
  source_text: string;
  translated_text: string;
  prompt_version: string;
  cached: boolean;
  input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
  first_token_ms?: number | null;
  total_duration_ms?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface TranslationStreamMetaEvent {
  type: "meta";
  cached: boolean;
  request_id: string;
}

interface TranslationStreamDeltaEvent {
  type: "delta";
  text: string;
}

interface TranslationStreamDoneEvent extends TranslationResult {
  type: "done";
  finish_reason?: string | null;
}

interface TranslationStreamErrorEvent {
  type: "error";
  message: string;
  code?: string;
}

type TranslationStreamEvent =
  | TranslationStreamMetaEvent
  | TranslationStreamDeltaEvent
  | TranslationStreamDoneEvent
  | TranslationStreamErrorEvent;

export function listTranslationDocuments(
  workspaceId: string,
): Promise<TranslationDocument[]> {
  const params = new URLSearchParams({ workspace_id: workspaceId });
  return fetchJson<TranslationDocument[]>(
    `/api/translation/documents?${params.toString()}`,
  );
}

export async function uploadTranslationPdf(
  file: File,
  workspaceId: string,
): Promise<{ document_id: string; duplicate: boolean; workspace_id?: string }> {
  const form = new FormData();
  form.append("file", file);
  const params = new URLSearchParams({ workspace_id: workspaceId });
  const response = await fetch(
    `/api/translation/documents/upload?${params.toString()}`,
    {
      method: "POST",
      body: form,
    },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      detail?: string;
      message?: string;
    };
    throw new Error(payload.detail || payload.message || "上传翻译文档失败");
  }
  return (await response.json()) as {
    document_id: string;
    duplicate: boolean;
    workspace_id?: string;
  };
}

export function getTranslationOriginalUrl(documentId: string, workspaceId: string): string {
  const params = new URLSearchParams({ workspace_id: workspaceId });
  return `/api/translation/documents/${encodeURIComponent(documentId)}/original?${params.toString()}`;
}

export function listTranslationPages(
  documentId: string,
  workspaceId: string,
): Promise<TranslationPageText[]> {
  const params = new URLSearchParams({ workspace_id: workspaceId });
  return fetchJson<TranslationPageText[]>(
    `/api/translation/documents/${encodeURIComponent(documentId)}/pages?${params.toString()}`,
  );
}

export function listTranslationHistory(
  documentId: string,
  workspaceId: string,
): Promise<TranslationHistoryItem[]> {
  const params = new URLSearchParams({ workspace_id: workspaceId });
  return fetchJson<TranslationHistoryItem[]>(
    `/api/translation/documents/${encodeURIComponent(documentId)}/history?${params.toString()}`,
  );
}

export function translateSelection(
  payload: TranslationSelectionPayload,
  signal?: AbortSignal,
): Promise<TranslationResult> {
  return fetchJson<TranslationResult>("/api/translation/translate-selection", {
    method: "POST",
    body: JSON.stringify(payload),
    signal,
  });
}

export async function streamTranslateSelection(
  payload: TranslationSelectionPayload,
  handlers: {
    onMeta?: (event: TranslationStreamMetaEvent) => void;
    onDelta?: (event: TranslationStreamDeltaEvent) => void;
  },
  signal?: AbortSignal,
): Promise<TranslationResult> {
  const response = await fetch("/api/translation/translate-selection-stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  if (!response.body) {
    throw new Error("流式翻译响应为空");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let doneEvent: TranslationResult | null = null;

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const event = JSON.parse(trimmed) as TranslationStreamEvent;
      if (event.type === "meta") {
        handlers.onMeta?.(event);
        continue;
      }
      if (event.type === "delta") {
        handlers.onDelta?.(event);
        continue;
      }
      if (event.type === "error") {
        throw new Error(event.message || event.code || "流式翻译失败");
      }
      if (event.type === "done") {
        doneEvent = event;
      }
    }
    if (done) break;
  }

  if (!doneEvent) {
    throw new Error("流式翻译未返回完成结果");
  }
  return doneEvent;
}

export function cancelTranslationRequest(clientRequestId: string): Promise<{ ok: boolean; cancelled: boolean }> {
  return fetchJson<{ ok: boolean; cancelled: boolean }>(
    `/api/translation/requests/${encodeURIComponent(clientRequestId)}/cancel`,
    { method: "POST" },
  );
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: string | { message?: string; code?: string }; message?: string };
    if (typeof payload.detail === "string" && payload.detail.trim()) {
      return payload.detail;
    }
    if (payload.detail && typeof payload.detail === "object") {
      if (typeof payload.detail.message === "string" && payload.detail.message.trim()) {
        return payload.detail.message;
      }
      if (typeof payload.detail.code === "string" && payload.detail.code.trim()) {
        return payload.detail.code;
      }
    }
    if (typeof payload.message === "string" && payload.message.trim()) {
      return payload.message;
    }
  } catch {
    // ignore parse failures
  }
  return response.statusText || "请求失败";
}
