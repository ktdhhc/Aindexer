export function buildExportMarkdownUrl(docId: string, workspaceId: string): string {
  const params = new URLSearchParams({ workspace_id: workspaceId });
  return `/api/export/${encodeURIComponent(docId)}?${params.toString()}`;
}
