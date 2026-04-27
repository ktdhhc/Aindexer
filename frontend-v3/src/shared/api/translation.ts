import { fetchJson } from "./http";

export interface TranslationDocument {
  id: string;
  workspace_id: string;
  filename: string;
  display_name: string;
  text_layer_status: string;
  created_at: string;
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
