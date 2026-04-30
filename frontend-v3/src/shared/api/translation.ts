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

export function cancelTranslationRequest(clientRequestId: string): Promise<{ ok: boolean; cancelled: boolean }> {
  return fetchJson<{ ok: boolean; cancelled: boolean }>(
    `/api/translation/requests/${encodeURIComponent(clientRequestId)}/cancel`,
    { method: "POST" },
  );
}
