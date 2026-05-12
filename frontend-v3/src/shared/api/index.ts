import { fetchJson } from "./http";

export interface IndexMarkdownPayload {
  doc_id: string;
  markdown: string;
}

export interface IndexDetailPayload {
  doc_id: string;
  title: string;
  authors: string[];
  year: number | null;
  apa_citation: string;
  updated_at: string | null;
}

export interface IndexEditorPayload {
  markdown: string;
  title: string;
  display_name: string;
  authors: string[];
  year: number | null;
  generated_at: string | null;
}

export interface ActiveIndexRunsPayload {
  active_total: number;
  active_by_workspace: Record<string, number>;
  running_count: number;
  queued_count: number;
  max_concurrency: number;
  configured_max_concurrency: number;
}

export interface IndexSettingsPayload {
  max_concurrency: number;
  effective_max_concurrency: number;
  pending_next_batch: boolean;
  min_concurrency: number;
  max_allowed_concurrency: number;
}

export interface IndexProgressEvent {
  doc_id: string;
  status: string;
  stage: string;
  stage_message?: string;
  error_message?: string | null;
  progress: number;
  output_seen_tokens?: number;
  output_budget_tokens?: number;
  failure_code?: string | null;
  failure_label?: string | null;
  done?: boolean;
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

export async function streamIndex(
  docId: string,
  workspaceId: string,
  provider: string,
  model: string | null,
  fieldTemplateId: string,
  onEvent: (event: IndexProgressEvent) => void,
): Promise<void> {
  const params = new URLSearchParams({
    workspace_id: workspaceId,
    provider,
    field_template_id: fieldTemplateId,
  });
  if (model && model.trim()) {
    params.set("model", model.trim());
  }

  const response = await fetch(`/api/index/${encodeURIComponent(docId)}/run_stream?${params.toString()}`);
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { detail?: string; message?: string };
    throw new Error(payload.detail || payload.message || `HTTP ${response.status}`);
  }
  if (!response.body) {
    throw new Error("索引进度流不可用");
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
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const raw of events) {
      const line = raw.split(/\r?\n/).find((item) => item.startsWith("data:"));
      if (!line) continue;
      onEvent(JSON.parse(line.slice(5).trim()) as IndexProgressEvent);
    }
  }
  const tail = buffer.trim();
  if (tail) {
    const line = tail.split(/\r?\n/).find((item) => item.startsWith("data:"));
    if (line) {
      onEvent(JSON.parse(line.slice(5).trim()) as IndexProgressEvent);
    }
  }
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

export function getActiveIndexRuns(): Promise<ActiveIndexRunsPayload> {
  return fetchJson<ActiveIndexRunsPayload>("/api/index/runs/active");
}

export function getIndexSettings(): Promise<IndexSettingsPayload> {
  return fetchJson<IndexSettingsPayload>("/api/index/settings");
}

export function updateIndexSettings(maxConcurrency: number): Promise<IndexSettingsPayload> {
  return fetchJson<IndexSettingsPayload>("/api/index/settings", {
    method: "PUT",
    body: JSON.stringify({ max_concurrency: maxConcurrency }),
  });
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
