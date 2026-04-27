import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useWorkspaceStore } from "../app/workspaceStore";
import {
  listTranslationDocuments,
  uploadTranslationPdf,
} from "../shared/api/translation";

export function TranslatorPage() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceStore((state) => state.workspaceId);

  const docsQuery = useQuery({
    queryKey: ["translation-documents", workspaceId],
    queryFn: () => listTranslationDocuments(workspaceId),
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => uploadTranslationPdf(file, workspaceId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["translation-documents", workspaceId],
      });
    },
  });

  return (
    <section className="v3-page">
      <header className="v3-page-header">
        <h1 className="v3-page-title">翻译工作区</h1>
        <p className="v3-page-subtitle">
          翻译文档已按 Workspace 隔离。当前工作区：{workspaceId}
        </p>
      </header>

      <div className="v3-workspace-preview">
        <article className="v3-card">
          <h2 className="v3-card-title">文档预览区（阶段一）</h2>
          <div className="v3-actions-row">
            <label
              className="v3-button v3-button-primary v3-upload-label"
              htmlFor="translatorUploadInput"
            >
              上传 PDF
            </label>
            <input
              id="translatorUploadInput"
              className="v3-upload-input"
              type="file"
              accept=".pdf"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) {
                  return;
                }
                void uploadMutation.mutateAsync(file);
                event.currentTarget.value = "";
              }}
            />
          </div>
          {uploadMutation.isPending ? (
            <p className="v3-muted">正在上传并解析文本层...</p>
          ) : null}
          {uploadMutation.isError ? (
            <p className="v3-error">
              {uploadMutation.error instanceof Error
                ? uploadMutation.error.message
                : "上传失败"}
            </p>
          ) : null}
          <div className="v3-card-stack">
            {(docsQuery.data ?? []).map((item) => (
              <article className="v3-subcard" key={item.id}>
                <div className="v3-subcard-head">
                  <strong>{item.display_name || item.filename}</strong>
                  <span className="v3-status-pill">{item.text_layer_status}</span>
                </div>
                <p className="v3-muted v3-mono">{item.id}</p>
              </article>
            ))}
            {docsQuery.isLoading ? (
              <p className="v3-muted">正在加载翻译文档...</p>
            ) : null}
            {!docsQuery.isLoading && (docsQuery.data ?? []).length === 0 ? (
              <p className="v3-muted">当前工作区暂无翻译文档</p>
            ) : null}
          </div>
        </article>

        <article className="v3-card">
          <h2 className="v3-card-title">翻译侧栏（下一阶段）</h2>
          <p className="v3-muted">
            下一步会在这里接入页内选区翻译、历史追溯和缓存命中提示。
          </p>
        </article>
      </div>
    </section>
  );
}
