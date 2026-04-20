import { fetchJson } from "./http";

export interface FileItem {
  id: string;
  workspace_id: string;
  filename: string;
  display_name: string;
  file_type: string;
  status: string;
  stage: string;
  stage_message: string;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
}

export interface UploadResult {
  doc_id: string;
  workspace_id: string;
  duplicate: boolean;
  status: string;
}

export function listFiles(workspaceId: string): Promise<FileItem[]> {
  const query = new URLSearchParams({ workspace_id: workspaceId }).toString();
  return fetchJson<FileItem[]>(`/api/files?${query}`);
}

export async function uploadFile(file: File, workspaceId: string): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);

  const params = new URLSearchParams({ workspace_id: workspaceId }).toString();
  const response = await fetch(`/api/files/upload?${params}`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { detail?: string; message?: string };
    throw new Error(payload.detail || payload.message || "上传失败");
  }
  return (await response.json()) as UploadResult;
}

export async function deleteFile(docId: string, workspaceId: string): Promise<{ ok: boolean }> {
  const params = new URLSearchParams({ workspace_id: workspaceId }).toString();
  const response = await fetch(`/api/files/${encodeURIComponent(docId)}?${params}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { detail?: string; message?: string };
    throw new Error(payload.detail || payload.message || "删除失败");
  }
  return (await response.json()) as { ok: boolean };
}

export function buildOriginalFileUrl(docId: string, workspaceId: string): string {
  const params = new URLSearchParams({ workspace_id: workspaceId });
  return `/api/files/${encodeURIComponent(docId)}/original?${params.toString()}`;
}
