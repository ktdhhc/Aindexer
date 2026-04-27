import type { PreviewMode } from "./types";

interface CanvasPanelProps {
  selectedDocId: string;
  selectedTitle: string;
  selectedMeta: string;
  previewMarkdown: string;
  previewHtml: string;
  previewMode: PreviewMode;
  onPreviewModeChange: (mode: PreviewMode) => void;
  onRefresh: () => void;
  onCopy: () => void;
  onOpenOriginal: () => void;
  onExport: () => void;
  isLoading: boolean;
  isError: boolean;
}

export function CanvasPanel({
  selectedDocId,
  selectedTitle,
  selectedMeta,
  previewMarkdown,
  previewHtml,
  previewMode,
  onPreviewModeChange,
  onRefresh,
  onCopy,
  onOpenOriginal,
  onExport,
  isLoading,
  isError,
}: CanvasPanelProps) {
  const hasPreview = Boolean(previewMarkdown);

  return (
    <section className="v35-paper-panel v35-column v35-canvas-panel" aria-label="文档画布">
      <header className="v35-column-header">
        <div>
          <h2 className="v35-section-title">Document Canvas</h2>
          <p className="v35-muted">索引预览 · 可进入修订</p>
        </div>
        <div className="v35-canvas-toolbar">
          <button
            className={`v35-button ${previewMode === "rendered" ? "is-active" : ""}`}
            type="button"
            disabled={!hasPreview}
            onClick={() => {
              onPreviewModeChange("rendered");
            }}
          >
            渲染
          </button>
          <button
            className={`v35-button ${previewMode === "raw" ? "is-active" : ""}`}
            type="button"
            disabled={!hasPreview}
            onClick={() => {
              onPreviewModeChange("raw");
            }}
          >
            Markdown
          </button>
          <button className="v35-button" type="button" disabled={!selectedDocId} onClick={onRefresh}>刷新</button>
          <button className="v35-button" type="button" disabled={!hasPreview} onClick={onCopy}>复制</button>
          <button className="v35-button" type="button" disabled={!selectedDocId} onClick={onOpenOriginal}>原文</button>
          <button className="v35-button" type="button" disabled={!selectedDocId} onClick={onExport}>导出</button>
        </div>
      </header>

      <article className="v35-document-canvas">
        {!selectedDocId ? <p className="v35-muted">请选择文献</p> : null}
        {selectedDocId ? <h1>{selectedTitle}</h1> : null}
        {selectedDocId && selectedMeta ? <p className="v35-document-meta">{selectedMeta}</p> : null}
        {selectedDocId && isLoading ? <p className="v35-muted">正在加载预览...</p> : null}
        {selectedDocId && isError ? <p className="v35-error">预览不可用，可能尚未生成索引。</p> : null}

        {hasPreview && !isLoading ? (
          previewMode === "raw" ? (
            <pre className="v35-preview-raw">{previewMarkdown}</pre>
          ) : (
            <article className="v35-preview-rendered" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          )
        ) : null}
      </article>
    </section>
  );
}
