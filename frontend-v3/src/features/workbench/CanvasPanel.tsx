import type { PreviewMode } from "./types";
import { isDesktopShell } from "../../shared/lib/runtime";

interface CanvasPanelProps {
  selectedDocId: string;
  selectedTitle: string;
  selectedMeta: string;
  previewMarkdown: string;
  previewHtml: string;
  previewMode: PreviewMode;
  onPreviewModeChange: (mode: PreviewMode) => void;
  isEditing: boolean;
  previewDraft: string;
  onPreviewDraftChange: (value: string) => void;
  previewDisplayNameDraft: string;
  onPreviewDisplayNameDraftChange: (value: string) => void;
  previewTitleDraft: string;
  onPreviewTitleDraftChange: (value: string) => void;
  previewYearDraft: string;
  onPreviewYearDraftChange: (value: string) => void;
  onEditStart: () => void;
  onEditCancel: () => void;
  onEditSave: () => void;
  onRefresh: () => void;
  onCopy: () => void;
  onOpenOriginal: () => void;
  onExport: () => void;
  isLoading: boolean;
  isError: boolean;
  canEdit: boolean;
  savePending: boolean;
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M16 10a6 6 0 1 1-1.6-4.1" />
      <path d="M16 4.5v3.8h-3.8" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M7 6.5V5.8A1.8 1.8 0 0 1 8.8 4h5.4A1.8 1.8 0 0 1 16 5.8v5.4A1.8 1.8 0 0 1 14.2 13H13" />
      <path d="M5.8 7H11a1.8 1.8 0 0 1 1.8 1.8V14A1.8 1.8 0 0 1 11 15.8H5.8A1.8 1.8 0 0 1 4 14V8.8A1.8 1.8 0 0 1 5.8 7Z" />
    </svg>
  );
}

function OriginalIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M6 4.8h5.4L15 8.4V15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5.8a1 1 0 0 1 1-1Z" />
      <path d="M11.4 4.8V8.4H15" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 4.5v8" />
      <path d="m6.5 9 3.5 3.5L13.5 9" />
      <path d="M5 15.5h10" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m5 14.8 2.7-.5L15 7l-2-2-7.3 7.3-.7 2.5Z" />
      <path d="m11.8 5.3 2 2" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4.8 4h8.4L16 6.8V15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 .8-1Z" />
      <path d="M7 4v4h5V4" />
      <path d="M7 16v-4h6v4" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M6 6l8 8" />
      <path d="m14 6-8 8" />
    </svg>
  );
}

export function CanvasPanel({
  selectedDocId,
  selectedTitle,
  selectedMeta,
  previewMarkdown,
  previewHtml,
  previewMode,
  onPreviewModeChange,
  isEditing,
  previewDraft,
  onPreviewDraftChange,
  previewDisplayNameDraft,
  onPreviewDisplayNameDraftChange,
  previewTitleDraft,
  onPreviewTitleDraftChange,
  previewYearDraft,
  onPreviewYearDraftChange,
  onEditStart,
  onEditCancel,
  onEditSave,
  onRefresh,
  onCopy,
  onOpenOriginal,
  onExport,
  isLoading,
  isError,
  canEdit,
  savePending,
}: CanvasPanelProps) {
  const desktopShell = isDesktopShell();
  const hasPreview = Boolean(previewMarkdown);

  return (
    <section className="v35-paper-panel v35-column v35-canvas-panel" aria-label="文档画布">
      <header className="v35-column-header">
        <div>
          <h2 className="v35-section-title">Document Canvas</h2>
          <p className="v35-muted">{desktopShell ? "索引" : "索引预览 · 可进入修订"}</p>
        </div>
        <div className="v35-canvas-toolbar">
          <div className="v35-mode-group" role="tablist" aria-label="预览模式">
            <button
              className={`v35-mode-btn ${previewMode === "rendered" ? "is-active" : ""}`}
              type="button"
              disabled={!hasPreview || isEditing}
              onClick={() => {
                onPreviewModeChange("rendered");
              }}
            >
              预览
            </button>
            <button
              className={`v35-mode-btn ${previewMode === "raw" ? "is-active" : ""}`}
              type="button"
              disabled={!hasPreview || isEditing}
              onClick={() => {
                onPreviewModeChange("raw");
              }}
            >
              Markdown
            </button>
          </div>
          <button className="v35-button v35-button-compact v35-workbench-icon-button" type="button" title="刷新预览" aria-label="刷新预览" disabled={!selectedDocId} onClick={onRefresh}><RefreshIcon /></button>
          <button className="v35-button v35-button-compact v35-workbench-icon-button" type="button" title="复制索引内容" aria-label="复制索引内容" disabled={!hasPreview || isEditing} onClick={onCopy}><CopyIcon /></button>
          <button className="v35-button v35-button-compact v35-workbench-icon-button" type="button" title="打开原文" aria-label="打开原文" disabled={!selectedDocId} onClick={onOpenOriginal}><OriginalIcon /></button>
          <button className="v35-button v35-button-compact v35-workbench-icon-button" type="button" title="导出 Markdown" aria-label="导出 Markdown" disabled={!selectedDocId} onClick={onExport}><ExportIcon /></button>
          {!isEditing ? (
            <button className="v35-button v35-button-compact v35-workbench-icon-button v35-button-primary" type="button" title="编辑索引内容" aria-label="编辑索引内容" disabled={!canEdit} onClick={onEditStart}><EditIcon /></button>
          ) : (
            <>
              <button className="v35-button v35-button-compact v35-workbench-icon-button v35-button-primary" type="button" title="保存编辑" aria-label="保存编辑" disabled={savePending} onClick={onEditSave}><SaveIcon /></button>
              <button className="v35-button v35-button-compact v35-workbench-icon-button" type="button" title="取消编辑" aria-label="取消编辑" disabled={savePending} onClick={onEditCancel}><CloseIcon /></button>
            </>
          )}
        </div>
      </header>

      <article className="v35-document-canvas">
        {!selectedDocId ? <p className="v35-muted">请选择文献</p> : null}
        {selectedDocId ? <h1>{selectedTitle}</h1> : null}
        {selectedDocId && selectedMeta ? <p className="v35-document-meta">{selectedMeta}</p> : null}
        {selectedDocId && isLoading ? <p className="v35-muted">正在加载预览...</p> : null}
        {selectedDocId && isError ? <p className="v35-error">预览不可用，可能尚未生成索引。</p> : null}

        {hasPreview && !isLoading ? (
          isEditing ? (
            <div className="v35-canvas-editor">
              <header className="v35-canvas-editor-head">
                <span className="v35-editor-state">编辑中</span>
                <span className="v35-editor-count">{previewDraft.length}</span>
              </header>

              <div className="v35-canvas-editor-sheet">
                <div className="v35-canvas-editor-title-row">
                  <label className="v35-editor-field v35-editor-field-title">
                    <span className="v35-editor-label">标题</span>
                    <input
                      className="v35-editor-input v35-editor-input-title"
                      value={previewTitleDraft}
                      onChange={(event) => {
                        onPreviewTitleDraftChange(event.target.value);
                      }}
                      placeholder="索引标题"
                    />
                  </label>
                </div>

                <div className="v35-canvas-editor-meta-row">
                  <label className="v35-editor-field v35-editor-field-display">
                    <span className="v35-editor-label">显示名</span>
                    <input
                      className="v35-editor-input"
                      value={previewDisplayNameDraft}
                      onChange={(event) => {
                        onPreviewDisplayNameDraftChange(event.target.value);
                      }}
                      placeholder="文献显示名"
                    />
                  </label>
                  <label className="v35-editor-field v35-editor-field-year">
                    <span className="v35-editor-label">年份</span>
                    <input
                      className="v35-editor-input v35-editor-input-year"
                      inputMode="numeric"
                      value={previewYearDraft}
                      onChange={(event) => {
                        onPreviewYearDraftChange(event.target.value);
                      }}
                      placeholder="年份"
                    />
                  </label>
                </div>

                <div className="v35-editor-markdown-wrap">
                  <textarea
                    className="v35-textarea v35-canvas-textarea"
                    value={previewDraft}
                    onChange={(event) => {
                      onPreviewDraftChange(event.target.value);
                    }}
                    spellCheck={false}
                  />
                </div>
              </div>
            </div>
          ) : previewMode === "raw" ? (
            <pre className="v35-preview-raw">{previewMarkdown}</pre>
          ) : (
            <article className="v35-preview-rendered" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          )
        ) : null}
      </article>
    </section>
  );
}
