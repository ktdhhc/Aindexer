import { fetchJson } from "./http";

export interface SearchItem {
  doc_id: string;
  workspace_id: string;
  filename: string;
  display_name: string;
  status: string;
  stage?: string | null;
  progress?: number | null;
  failure_code?: string | null;
  failure_label?: string | null;
  created_at: string;
  title?: string | null;
  year?: number | null;
  authors?: string[];
  keywords?: string[];
}

export function searchDocuments(workspaceId: string, query: string): Promise<SearchItem[]> {
  const params = new URLSearchParams({
    workspace_id: workspaceId,
    q: query,
  });
  return fetchJson<SearchItem[]>(`/api/search?${params.toString()}`);
}
