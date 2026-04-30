import { useCallback, useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import {
  DEFAULT_PREVIEW_SCALE,
  PREVIEW_SCALE_MAX,
  PREVIEW_SCALE_MIN,
  PREVIEW_SCALE_STEP,
  useTranslatorStore,
} from "../app/translatorStore";
import { useWorkspaceStore } from "../app/workspaceStore";
import { buildOriginalFileUrl, listFiles } from "../shared/api/files";
import {
  listTranslationHistory,
} from "../shared/api/translation";
import { listProviders } from "../shared/api/providers";
import {
  buildAvailableProviderModelEntries,
  type ProviderModelEntry,
} from "../shared/lib/providerModels";
import { getModelDefault, parseModelDefaultKey } from "../shared/lib/modelDefaults";
import { PdfViewer } from "../features/translator/PdfViewer";

function normalizeText(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function shortId(value: string): string {
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function formatTime(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function TranslatorPage() {
  const workspaceId = useWorkspaceStore((state) => state.workspaceId);
  const ensureWorkspace = useTranslatorStore((state) => state.ensureWorkspace);
  const selectedDocumentId = useTranslatorStore((state) => state.byWorkspace[workspaceId]?.selectedDocumentId ?? "");
  const selectedModelKey = useTranslatorStore((state) => state.byWorkspace[workspaceId]?.selectedModelKey ?? "");
  const sourceText = useTranslatorStore((state) => state.byWorkspace[workspaceId]?.sourceText ?? "");
  const inspectorTab = useTranslatorStore((state) => state.byWorkspace[workspaceId]?.inspectorTab ?? "result");
  const translateMode = useTranslatorStore((state) => state.byWorkspace[workspaceId]?.translateMode ?? "full");
  const latestResult = useTranslatorStore((state) => state.byWorkspace[workspaceId]?.latestResult ?? null);
  const statusMessage = useTranslatorStore((state) => state.byWorkspace[workspaceId]?.statusMessage ?? "准备就绪");
  const viewerMode = useTranslatorStore((state) => state.byWorkspace[workspaceId]?.viewerMode ?? "layout");
  const isTranslating = useTranslatorStore((state) => Boolean(state.byWorkspace[workspaceId]?.isTranslating));
  const previewScale = useTranslatorStore((state) => state.byWorkspace[workspaceId]?.previewScale ?? DEFAULT_PREVIEW_SCALE);
  const setSelectedDocumentId = useTranslatorStore((state) => state.setSelectedDocumentId);
  const setSelectedModelKey = useTranslatorStore((state) => state.setSelectedModelKey);
  const setSourceText = useTranslatorStore((state) => state.setSourceText);
  const setInspectorTab = useTranslatorStore((state) => state.setInspectorTab);
  const setTranslateMode = useTranslatorStore((state) => state.setTranslateMode);
  const setLatestResult = useTranslatorStore((state) => state.setLatestResult);
  const setViewerMode = useTranslatorStore((state) => state.setViewerMode);
  const setPreviewScale = useTranslatorStore((state) => state.setPreviewScale);
  const startTranslation = useTranslatorStore((state) => state.startTranslation);
  const cancelStoredTranslation = useTranslatorStore((state) => state.cancelActiveTranslation);

  const autoDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAutoSourceRef = useRef("");

  const filesQuery = useQuery({
    queryKey: ["workspace-files", workspaceId],
    queryFn: () => listFiles(workspaceId),
  });

  const providersQuery = useQuery({
    queryKey: ["providers"],
    queryFn: listProviders,
  });

  const historyQuery = useQuery({
    queryKey: ["translation-history", workspaceId, selectedDocumentId],
    queryFn: () => listTranslationHistory(selectedDocumentId, workspaceId),
    enabled: Boolean(selectedDocumentId),
  });

  const pdfDocuments = useMemo(() => {
    return (filesQuery.data ?? []).filter((item) => item.file_type === "pdf");
  }, [filesQuery.data]);

  const selectedDocument = useMemo(() => {
    return pdfDocuments.find((item) => item.id === selectedDocumentId) ?? null;
  }, [pdfDocuments, selectedDocumentId]);

  const translationDefault = parseModelDefaultKey(getModelDefault("translation"));

  const modelOptions = useMemo<ProviderModelEntry[]>(() => {
    return buildAvailableProviderModelEntries(providersQuery.data ?? []);
  }, [providersQuery.data]);

  const selectedModelEntry = useMemo(() => {
    if (!selectedModelKey) return null;
    const [provider, ...modelParts] = selectedModelKey.split("::");
    const model = modelParts.join("::");
    return { provider, model };
  }, [selectedModelKey]);

  const sourceStats = useMemo(() => {
    const normalized = normalizeText(sourceText);
    return {
      chars: normalized.length,
      words: normalized ? normalized.split(/\s+/).length : 0,
    };
  }, [sourceText]);

  useEffect(() => {
    ensureWorkspace(workspaceId);
  }, [ensureWorkspace, workspaceId]);

  useEffect(() => {
    const docs = pdfDocuments;
    if (!docs || docs.length === 0) {
      setSelectedDocumentId(workspaceId, "");
      return;
    }
    if (!selectedDocumentId || !docs.some((item) => item.id === selectedDocumentId)) {
      setSelectedDocumentId(workspaceId, docs[0].id);
    }
  }, [pdfDocuments, selectedDocumentId, setSelectedDocumentId, workspaceId]);

  useEffect(() => {
    const options = modelOptions;
    if (options.length === 0) {
      setSelectedModelKey(workspaceId, "");
      return;
    }
    if (!selectedModelKey || !options.some((e) => `${e.provider}::${e.model}` === selectedModelKey)) {
      const defaultKey =
        translationDefault && options.some((e) => e.provider === translationDefault.provider && e.model === translationDefault.model)
          ? `${translationDefault.provider}::${translationDefault.model}`
          : `${options[0].provider}::${options[0].model}`;
      setSelectedModelKey(workspaceId, defaultKey);
    }
  }, [modelOptions, selectedModelKey, setSelectedModelKey, translationDefault, workspaceId]);

  const doTranslate = useCallback(
    async (text: string) => {
      const entry = selectedModelEntry;
      const source = normalizeText(text);
      if (!selectedDocumentId.trim()) return;
      if (!entry?.provider) return;
      await startTranslation({
        workspaceId,
        provider: entry.provider,
        model: entry.model || null,
        sourceText: source,
      });
    },
    [selectedDocumentId, selectedModelEntry, startTranslation, workspaceId],
  );

  const translateMutation = useMutation({
    mutationFn: () => doTranslate(sourceText),
  });

  async function cancelActiveTranslation() {
    if (autoDebounceRef.current) {
      clearTimeout(autoDebounceRef.current);
      autoDebounceRef.current = null;
    }
    translateMutation.reset();
    await cancelStoredTranslation(workspaceId);
  }

  const handlePdfSelection = useCallback(
    (text: string) => {
      if (autoDebounceRef.current) {
        clearTimeout(autoDebounceRef.current);
      }
      const normalized = normalizeText(text);
      if (normalized === lastAutoSourceRef.current) return;

      lastAutoSourceRef.current = normalized;
      setSourceText(workspaceId, normalized);

      if (translateMode !== "compact") {
        return;
      }

      autoDebounceRef.current = setTimeout(() => {
        void doTranslate(normalized);
      }, 800);
    },
    [doTranslate, setSourceText, translateMode, workspaceId],
  );

  const handleTextareaMouseUp = useCallback(() => {
    if (translateMode !== "compact") {
      return;
    }
    if (autoDebounceRef.current) clearTimeout(autoDebounceRef.current);
    autoDebounceRef.current = setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;
      const text = normalizeText(selection.toString());
      if (!text) return;
      if (text === lastAutoSourceRef.current) return;
      if (!selectedDocumentId || !selectedModelEntry?.provider) return;
      lastAutoSourceRef.current = text;
      setSourceText(workspaceId, text);
      autoDebounceRef.current = setTimeout(() => {
        void doTranslate(text);
      }, 600);
    }, 200);
  }, [selectedDocumentId, selectedModelEntry, doTranslate, setSourceText, translateMode, workspaceId]);

  useEffect(() => {
    return () => {
      if (autoDebounceRef.current) {
        clearTimeout(autoDebounceRef.current);
        autoDebounceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!latestResult || !selectedDocumentId) {
      return;
    }
    if (latestResult.document_id !== selectedDocumentId) {
      return;
    }
    void historyQuery.refetch();
  }, [historyQuery.refetch, latestResult, selectedDocumentId]);

  const canStartTranslate = Boolean(
    selectedDocumentId && selectedModelEntry && !isTranslating,
  );

  const pdfFileUrl = selectedDocumentId ? buildOriginalFileUrl(selectedDocumentId, workspaceId) : "";
  const canZoomOut = previewScale > PREVIEW_SCALE_MIN;
  const canZoomIn = previewScale < PREVIEW_SCALE_MAX;

  function changePreviewScale(direction: -1 | 1) {
    setPreviewScale(workspaceId, (current) => {
      const next = current + direction * PREVIEW_SCALE_STEP;
      return Math.min(PREVIEW_SCALE_MAX, Math.max(PREVIEW_SCALE_MIN, Math.round(next * 100) / 100));
    });
  }

  return (
    <section className="v35-translator-page">
      <header className="v35-translator-header">
        <div>
          <p className="v35-banner-kicker">Translation Desk</p>
          <h1>翻译</h1>
        </div>
        <div className="v35-translator-meta">
          <span>{pdfDocuments.length} docs</span>
          <span>{statusMessage}</span>
        </div>
      </header>

      <div className="v35-translator-workspace">
        <aside className="v35-translation-library v35-paper-panel">
          <header className="v35-column-header">
            <div>
              <h2 className="v35-section-title">Documents</h2>
              <p className="v35-muted">{workspaceId}</p>
            </div>
          </header>

          <div className="v35-translation-doc-list">
            {filesQuery.isLoading ? (
              <p className="v35-muted">正在加载...</p>
            ) : (
              pdfDocuments.map((doc) => (
                <button
                  className={`v35-translation-doc ${doc.id === selectedDocumentId ? "is-active" : ""}`}
                  key={doc.id}
                  type="button"
                  onClick={() => {
                    setSelectedDocumentId(workspaceId, doc.id);
                    setSourceText(workspaceId, "");
                    setLatestResult(workspaceId, null);
                    lastAutoSourceRef.current = "";
                  }}
                >
                  <strong>{doc.display_name || doc.filename}</strong>
                  <span>{doc.file_type} · {doc.status}</span>
                  <em>{shortId(doc.id)}</em>
                </button>
              ))
            )}
            {!filesQuery.isLoading && pdfDocuments.length === 0 ? (
              <p className="v35-muted">当前工作区没有 PDF 文档。请先在文库页上传。</p>
            ) : null}
          </div>
        </aside>

        <main className="v35-translation-reader v35-paper-panel">
          <header className="v35-translation-reader-head">
            <div>
              <p>{selectedDocument ? shortId(selectedDocument.id) : "No Document"}</p>
              <h2>{selectedDocument?.display_name || selectedDocument?.filename || "选择一篇 PDF"}</h2>
            </div>
            <div className="v35-translation-reader-actions">
              <div className="v35-preview-zoom" role="group" aria-label="预览缩放">
                <button
                  className="v35-icon-button"
                  type="button"
                  aria-label="缩小预览"
                  title="缩小预览"
                  disabled={!pdfFileUrl || !canZoomOut}
                  onClick={() => changePreviewScale(-1)}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M3 8h10" />
                  </svg>
                </button>
                <span>{Math.round((previewScale / DEFAULT_PREVIEW_SCALE) * 100)}%</span>
                <button
                  className="v35-icon-button"
                  type="button"
                  aria-label="放大预览"
                  title="放大预览"
                  disabled={!pdfFileUrl || !canZoomIn}
                  onClick={() => changePreviewScale(1)}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M8 3v10M3 8h10" />
                  </svg>
                </button>
              </div>
              <div className="v35-viewer-mode-toggle" role="group" aria-label="预览模式">
                <button
                  className={`v35-mode-btn ${viewerMode === "layout" ? "is-active" : ""}`}
                  type="button"
                  onClick={() => setViewerMode(workspaceId, "layout")}
                >
                  版面
                </button>
                <button
                  className={`v35-mode-btn ${viewerMode === "text" ? "is-active" : ""}`}
                  type="button"
                  onClick={() => setViewerMode(workspaceId, "text")}
                >
                  文本
                </button>
              </div>
              {pdfFileUrl ? (
                <a className="v35-button" href={pdfFileUrl} target="_blank" rel="noreferrer">
                  PDF
                </a>
              ) : null}
            </div>
          </header>

          {pdfFileUrl ? (
            <PdfViewer
              className="v35-pdf-viewer"
              url={pdfFileUrl}
              onSelection={handlePdfSelection}
              selectionMode={viewerMode}
              scale={previewScale}
            />
          ) : (
            <div className="v35-translation-pages">
              <p className="v35-muted">选择左侧一篇 PDF 文档即可预览。</p>
            </div>
          )}
        </main>

        <aside className="v35-translation-inspector v35-paper-panel">
          <div className="v35-inspector-tabs" role="tablist" aria-label="翻译面板">
            <button className={inspectorTab === "result" ? "is-active" : ""} type="button" onClick={() => setInspectorTab(workspaceId, "result")}>
              译文
            </button>
            <button className={inspectorTab === "history" ? "is-active" : ""} type="button" onClick={() => setInspectorTab(workspaceId, "history")}>
              历史
            </button>
          </div>

          {inspectorTab === "result" ? (
            <div className="v35-inspector-section">
              <label className="v35-field">
                <span>Model</span>
                <select className="v35-input" value={selectedModelKey} onChange={(event) => setSelectedModelKey(workspaceId, event.target.value)}>
                  {modelOptions.map((entry) => (
                    <option key={`${entry.provider}::${entry.model}`} value={`${entry.provider}::${entry.model}`}>
                      {entry.provider} · {entry.model}
                    </option>
                  ))}
                </select>
              </label>

              <div className="v35-mode-toggle">
                <span>Mode</span>
                <div className="v35-mode-group">
                  <button
                    className={`v35-mode-btn ${translateMode === "full" ? "is-active" : ""}`}
                    type="button"
                    onClick={() => setTranslateMode(workspaceId, "full")}
                  >
                    完整
                  </button>
                  <button
                    className={`v35-mode-btn ${translateMode === "compact" ? "is-active" : ""}`}
                    type="button"
                    onClick={() => setTranslateMode(workspaceId, "compact")}
                  >
                    精简
                  </button>
                </div>
              </div>

              {translateMode === "full" ? (
                <>
                  <label className="v35-field">
                    <span>
                      Source · {sourceStats.chars} chars · {selectedDocument?.display_name || selectedDocument?.filename || "未选择文档"}
                    </span>
                    <textarea
                      className="v35-textarea v35-source-textarea"
                      value={sourceText}
                      onChange={(event) => {
                        setSourceText(workspaceId, event.target.value);
                        lastAutoSourceRef.current = "";
                      }}
                      onMouseUp={handleTextareaMouseUp}
                      placeholder="粘贴或输入原文；也可选中文本后松手自动翻译..."
                    />
                  </label>

                  <div className="v35-config-actions">
                    <button className="v35-button v35-button-primary" type="button" disabled={!canStartTranslate} onClick={() => void translateMutation.mutateAsync()}>
                      翻译
                    </button>
                     <button className="v35-button" type="button" disabled={!isTranslating} onClick={() => void cancelActiveTranslation()}>
                       取消
                     </button>
                    <button className="v35-button" type="button" disabled={!sourceText} onClick={() => { setSourceText(workspaceId, ""); lastAutoSourceRef.current = ""; }}>
                      清空
                    </button>
                  </div>
                </>
              ) : null}

              {translateMutation.isError ? (
                <p className="v35-error">{translateMutation.error instanceof Error ? translateMutation.error.message : "翻译失败"}</p>
              ) : null}

              <article className="v35-translation-result">
                <header>
                  <span>{latestResult?.cached ? "Cached" : "Result"}</span>
                 {isTranslating ? (
                   <button className="v35-button" type="button" onClick={() => void cancelActiveTranslation()}>
                     取消
                   </button>
                  ) : latestResult ? (
                    <button className="v35-button" type="button" onClick={() => void navigator.clipboard?.writeText(latestResult.translated_text)}>
                      复制
                    </button>
                  ) : null}
                </header>
                 {isTranslating ? (
                   <p className="v35-muted"><span className="v35-spinner" aria-label="正在翻译" /> 正在生成译文...</p>
                 ) : null}
                 {latestResult ? (
                   <p>{latestResult.translated_text}</p>
                 ) : !isTranslating ? (
                   <p className="v35-muted">输入原文后翻译</p>
                 ) : null}
                 {latestResult && !isTranslating ? (
                   <footer>
                     {latestResult.provider} · {latestResult.model} ·{" "}
                     {latestResult.total_duration_ms ? `${Math.round(latestResult.total_duration_ms)}ms` : "-"}
                  </footer>
                ) : null}
              </article>
            </div>
          ) : null}

          {inspectorTab === "history" ? (
            <div className="v35-inspector-section">
              <div className="v35-history-list">
                {(historyQuery.data ?? []).map((item) => (
                  <article className="v35-history-item" key={item.request_id}>
                    <header>
                      <span>{formatTime(item.created_at)}</span>
                      <button
                        className="v35-button"
                        type="button"
                        onClick={() => {
                          setSourceText(workspaceId, item.source_text);
                          setLatestResult(workspaceId, {
                            request_id: item.request_id,
                            document_id: selectedDocumentId,
                            provider: item.provider,
                            model: item.model,
                            target_lang: item.target_lang,
                            source_text: item.source_text,
                            translated_text: item.translated_text,
                            prompt_version: "v1",
                            cached: true,
                          });
                          setInspectorTab(workspaceId, "result");
                        }}
                      >
                        恢复
                      </button>
                    </header>
                    <p>{item.translated_text}</p>
                    <em>
                      {item.provider} · {item.model}
                    </em>
                  </article>
                ))}
                {historyQuery.isLoading ? <p className="v35-muted">正在加载历史...</p> : null}
                {!historyQuery.isLoading && (historyQuery.data ?? []).length === 0 ? <p className="v35-muted">暂无历史</p> : null}
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
