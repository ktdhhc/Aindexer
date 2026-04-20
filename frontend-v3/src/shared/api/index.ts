import { fetchJson } from "./http";

export interface IndexMarkdownPayload {
  doc_id: string;
  markdown: string;
}

export function runIndex(
  docId: string,
  workspaceId: string,
  provider: string,
  model: string | null,
  fieldTemplateId: string,
): Promise<{ doc_id: string; status: string; message: string }> {
  const params = new URLSearchParams({
    workspace_id: workspaceId,
    provider,
    field_template_id: fieldTemplateId,
  });
  if (model && model.trim()) {
    params.set("model", model.trim());
  }

  return fetchJson<{ doc_id: string; status: string; message: string }>(
    `/api/index/${encodeURIComponent(docId)}/run?${params.toString()}`,
    {
      method: "POST",
    },
  );
}

export function getIndexMarkdown(
  docId: string,
  workspaceId: string,
): Promise<IndexMarkdownPayload> {
  const params = new URLSearchParams({ workspace_id: workspaceId });
  return fetchJson<IndexMarkdownPayload>(
    `/api/index/${encodeURIComponent(docId)}/markdown?${params.toString()}`,
  );
}
