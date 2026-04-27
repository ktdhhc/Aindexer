import { fetchJson } from "./http";

export interface IndexMarkdownPayload {
  doc_id: string;
  markdown: string;
}

export interface IndexDetailPayload {
  doc_id: string;
  title: string;
  year: number | null;
  updated_at: string | null;
}

export interface IndexEditorPayload {
  markdown: string;
  title: string;
  display_name: string;
  year: number | null;
  generated_at: string | null;
}

export function updateIndexMarkdown(
  docId: string,
  workspaceId: string,
  markdown: string,
): Promise<{ ok: boolean }> {
  const params = new URLSearchParams({ workspace_id: workspaceId });
  return fetchJson<{ ok: boolean }>(
    `/api/index/${encodeURIComponent(docId)}/markdown?${params.toString()}`,
    {
      method: "PUT",
      body: JSON.stringify({ markdown }),
    },
  );
}

export function updateIndexEditor(
  docId: string,
  workspaceId: string,
  payload: IndexEditorPayload,
): Promise<{ ok: boolean }> {
  const params = new URLSearchParams({ workspace_id: workspaceId });
  return fetchJson<{ ok: boolean }>(
    `/api/index/${encodeURIComponent(docId)}/editor?${params.toString()}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
  );
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

export function runAllIndexes(
  workspaceId: string,
  provider: string,
  model: string | null,
  fieldTemplateId: string,
): Promise<{ queued: number; skipped: number; max_concurrency: number }> {
  const params = new URLSearchParams({
    workspace_id: workspaceId,
    provider,
    field_template_id: fieldTemplateId,
  });
  if (model && model.trim()) {
    params.set("model", model.trim());
  }

  return fetchJson<{ queued: number; skipped: number; max_concurrency: number }>(
    `/api/index/run_all?${params.toString()}`,
    {
      method: "POST",
    },
  );
}

export function cancelIndex(docId: string, workspaceId: string): Promise<{ ok: boolean; status: string }> {
  const params = new URLSearchParams({ workspace_id: workspaceId });
  return fetchJson<{ ok: boolean; status: string }>(
    `/api/index/${encodeURIComponent(docId)}/cancel?${params.toString()}`,
    {
      method: "POST",
    },
  );
}

export function getIndexDetail(
  docId: string,
  workspaceId: string,
): Promise<IndexDetailPayload> {
  const params = new URLSearchParams({ workspace_id: workspaceId });
  return fetchJson<IndexDetailPayload>(
    `/api/index/${encodeURIComponent(docId)}?${params.toString()}`,
  );
}
