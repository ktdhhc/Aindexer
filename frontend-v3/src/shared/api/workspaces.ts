import { fetchJson } from "./http";

export interface WorkspaceItem {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  document_count: number;
}

export function listWorkspaces(): Promise<WorkspaceItem[]> {
  return fetchJson<WorkspaceItem[]>("/api/workspaces");
}

export function createWorkspace(payload: {
  name: string;
  description?: string;
}): Promise<WorkspaceItem> {
  return fetchJson<WorkspaceItem>("/api/workspaces", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateWorkspace(
  workspaceId: string,
  payload: {
    name: string;
    description?: string;
  },
): Promise<WorkspaceItem> {
  return fetchJson<WorkspaceItem>(`/api/workspaces/${encodeURIComponent(workspaceId)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteWorkspace(workspaceId: string): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>(`/api/workspaces/${encodeURIComponent(workspaceId)}`, {
    method: "DELETE",
  });
}
