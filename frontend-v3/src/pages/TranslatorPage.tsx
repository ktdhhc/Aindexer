import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import {
  DEFAULT_PREVIEW_SCALE,
  DEFAULT_INSPECTOR_PANE_WIDTH,
  PREVIEW_SCALE_MAX,
  PREVIEW_SCALE_MIN,
  PREVIEW_SCALE_STEP,
  getDefaultTranslatorWorkspaceState,
  useTranslatorStore,
} from "../app/translatorStore";
import { useWorkspaceStore } from "../app/workspaceStore";
import { buildOriginalFileUrl, listFiles } from "../shared/api/files";
import {
  listTranslationHistory,
} from "../shared/api/translation";
import { listProviders } from "../shared/api/providers";
import { searchDocuments, type SearchItem } from "../shared/api/search";
import {
  useAvailableProviderModelEntries,
} from "../shared/lib/providerModels";
import { parseModelDefaultKey, useModelDefaults } from "../shared/lib/modelDefaults";
import { notifyToast } from "../shared/ui/toast";

const PdfViewer = lazy(() => import("../features/translator/PdfViewer").then((module) => ({ default: module.PdfViewer })));

function normalizeText(text: string): string {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.replace(/[^\S\n]+/g, " ").replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

function splitTranslationParagraphs(text: string): string[] {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
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

async function copyText(value: string, label: string): Promise<void> {
  const text = String(value || "");
  if (!text.trim()) return;
  try {
    await navigator.clipboard.writeText(text);
    notifyToast({ tone: "success", title: "已复制", message: label });
  } catch {
    notifyToast({ tone: "error", title: "复制失败", message: "请手动复制" });
  }
}

function PdfSkeleton() {
  return (
    <div className="v35-translation-pages v35-pdf-skeleton" aria-label="正在加载 PDF 预览">
      <div />
      <div />
      <div />
    </div>
  );
}

function normalizeSearchText(value: string | number | null | undefined): string {
  return String(value || "").trim().toLowerCase();
}

function matchesTranslatorMetadata(item: SearchItem, query: string): boolean {
  const q = normalizeSearchText(query);
  if (!q) return true;
  const metadata = [
    item.title,
    item.display_name,
    item.filename,
    item.year ? String(item.year) : "",
    ...(item.authors || []),
  ]
    .map((part) => normalizeSearchText(part))
    .filter(Boolean);
  return metadata.some((part) => part.includes(q));
}

const TARGET_LANGUAGE_OPTIONS = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
];

export function TranslatorPage() {
  const workspaceId = useWorkspaceStore((state) => state.workspaceId);
  const translatorState = useTranslatorStore((state) => state.byWorkspace[workspaceId] ?? getDefaultTranslatorWorkspaceState());
  const documentQuery = translatorState.documentQuery;
  const deferredDocumentQuery = useDeferredValue(documentQuery.trim());
  const ensureWorkspace = useTranslatorStore((state) => state.ensureWorkspace);
  const selectedDocumentId = translatorState.selectedDocumentId;
  const selectedModelKey = translatorState.selectedModelKey;
  const targetLanguage = translatorState.targetLanguage;
  const isLibraryCollapsed = translatorState.isLibraryCollapsed;
  const inspectorPaneWidth = translatorState.inspectorPaneWidth ?? DEFAULT_INSPECTOR_PANE_WIDTH;
  const inspectorTab = translatorState.inspectorTab;
  const translateMode = translatorState.translateMode;
  const statusMessage = translatorState.statusMessage;
  const viewerMode = translatorState.viewerMode;
  const previewScale = translatorState.previewScale ?? DEFAULT_PREVIEW_SCALE;
  const sourceText = translatorState.sourceText;
  const streamedTranslationText = translatorState.streamedTranslationText;
  const latestResult = translatorState.latestResult;
  const isTranslating = Boolean(translatorState.isTranslating);
  const setDocumentQuery = useTranslatorStore((state) => state.setDocumentQuery);
  const setSelectedDocumentId = useTranslatorStore((state) => state.setSelectedDocumentId);
  const setSelectedModelKey = useTranslatorStore((state) => state.setSelectedModelKey);
  const setTargetLanguage = useTranslatorStore((state) => state.setTargetLanguage);
  const setLibraryCollapsed = useTranslatorStore((state) => state.setLibraryCollapsed);
  const setInspectorPaneWidth = useTranslatorStore((state) => state.setInspectorPaneWidth);
  const setSourceText = useTranslatorStore((state) => state.setSourceText);
  const setInspectorTab = useTranslatorStore((state) => state.setInspectorTab);
  const setTranslateMode = useTranslatorStore((state) => state.setTranslateMode);
  const setLatestResult = useTranslatorStore((state) => state.setLatestResult);
  const setViewerMode = useTranslatorStore((state) => state.setViewerMode);
  const setPreviewScale = useTranslatorStore((state) => state.setPreviewScale);
  const setReaderScrollTop = useTranslatorStore((state) => state.setReaderScrollTop);
  const startTranslation = useTranslatorStore((state) => state.startTranslation);
  const cancelStoredTranslation = useTranslatorStore((state) => state.cancelActiveTranslation);

  const autoDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appliedTranslationDefaultRef = useRef("");
  const lastAutoSourceRef = useRef("");
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const readerPaneRef = useRef<HTMLElement | null>(null);
  const inspectorPaneRef = useRef<HTMLElement | null>(null);

  const filesQuery = useQuery({
    queryKey: ["workspace-files", workspaceId],
    queryFn: () => listFiles(workspaceId),
  });

  const librarySearchQuery = useQuery({
    queryKey: ["translator-library-search", workspaceId, deferredDocumentQuery],
    queryFn: () => searchDocuments(workspaceId, deferredDocumentQuery),
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

  const pdfDocumentMap = useMemo(() => {
    return new Map(pdfDocuments.map((item) => [item.id, item]));
  }, [pdfDocuments]);

  const visiblePdfDocuments = useMemo(() => {
    const rows = librarySearchQuery.data ?? [];
    const filteredRows = deferredDocumentQuery
      ? rows.filter((item) => matchesTranslatorMetadata(item, deferredDocumentQuery))
      : rows;
    const merged = filteredRows
      .map((item) => {
        const file = pdfDocumentMap.get(item.doc_id);
        if (!file) return null;
        return {
          ...file,
          title: item.title || null,
          year: item.year ?? null,
          authors: item.authors || [],
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    if (merged.length > 0 || deferredDocumentQuery) {
      return merged;
    }

    return pdfDocuments.map((item) => ({
      ...item,
      title: null,
      year: null,
      authors: [],
    }));
  }, [deferredDocumentQuery, librarySearchQuery.data, pdfDocumentMap, pdfDocuments]);

  const selectedDocument = useMemo(() => {
    return pdfDocuments.find((item) => item.id === selectedDocumentId) ?? null;
  }, [pdfDocuments, selectedDocumentId]);

  const modelDefaults = useModelDefaults();
  const translationDefaultKey = modelDefaults.translation;
  const translationDefault = useMemo(() => parseModelDefaultKey(translationDefaultKey), [translationDefaultKey]);

  const modelOptions = useAvailableProviderModelEntries(providersQuery.data ?? []);

  const selectedModelEntry = useMemo(() => {
    if (!selectedModelKey) return null;
    const [provider, ...modelParts] = selectedModelKey.split("::");
    const model = modelParts.join("::");
    return { provider, model };
  }, [selectedModelKey]);

  const selectedModelSupportsStreaming = useMemo(() => {
    if (!selectedModelEntry) return true;
    const provider = (providersQuery.data ?? []).find((item) => item.provider === selectedModelEntry.provider);
    const registryModel = provider?.registry?.provider.models?.find((item) => item.id === selectedModelEntry.model);
    if (!registryModel) return true;
    return registryModel.supports_streaming !== false;
  }, [providersQuery.data, selectedModelEntry]);

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
    if (!translationDefault || !translationDefaultKey) {
      return;
    }
    if (appliedTranslationDefaultRef.current === translationDefaultKey) {
      return;
    }
    const defaultKey = `${translationDefault.provider}::${translationDefault.model}`;
    if (!modelOptions.some((entry) => `${entry.provider}::${entry.model}` === defaultKey)) {
      return;
    }
    appliedTranslationDefaultRef.current = translationDefaultKey;
    if (selectedModelKey !== defaultKey) {
      setSelectedModelKey(workspaceId, defaultKey);
    }
  }, [modelOptions, selectedModelKey, setSelectedModelKey, translationDefault, translationDefaultKey, workspaceId]);

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
        targetLanguage,
        preferStreaming: selectedModelSupportsStreaming,
        sourceText: source,
      });
    },
    [selectedDocumentId, selectedModelEntry, selectedModelSupportsStreaming, startTranslation, targetLanguage, workspaceId],
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
    notifyToast({ tone: "info", title: "已停止翻译" });
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
    selectedDocumentId && selectedModelEntry && !isTranslating && normalizeText(sourceText),
  );
  const visibleTranslationText = latestResult?.translated_text || streamedTranslationText;
  const translationParagraphs = useMemo(
    () => splitTranslationParagraphs(visibleTranslationText),
    [visibleTranslationText],
  );
  const workspaceStyle = useMemo(
    () => ({
      "--v35-inspector-width": `${inspectorPaneWidth}px`,
    }) as CSSProperties,
    [inspectorPaneWidth],
  );

  const pdfFileUrl = selectedDocumentId ? buildOriginalFileUrl(selectedDocumentId, workspaceId) : "";
  const initialReaderScrollTop = useMemo(() => {
    if (!selectedDocumentId) return 0;
    return translatorState.readerScrollTop ?? 0;
  }, [selectedDocumentId, translatorState.readerScrollTop]);
  const canZoomOut = previewScale > PREVIEW_SCALE_MIN;
  const canZoomIn = previewScale < PREVIEW_SCALE_MAX;

  const handleReaderScrollPositionChange = useCallback((scrollTop: number) => {
    if (!selectedDocumentId) return;
    const currentDocumentId = useTranslatorStore.getState().byWorkspace[workspaceId]?.selectedDocumentId ?? "";
    if (currentDocumentId !== selectedDocumentId) return;
    setReaderScrollTop(workspaceId, scrollTop);
  }, [selectedDocumentId, setReaderScrollTop, workspaceId]);

  function changePreviewScale(direction: -1 | 1) {
    setPreviewScale(workspaceId, (current) => {
      const next = current + direction * PREVIEW_SCALE_STEP;
      return Math.min(PREVIEW_SCALE_MAX, Math.max(PREVIEW_SCALE_MIN, Math.round(next * 100) / 100));
    });
  }

  const handleInspectorResizeStart = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (window.innerWidth <= 1024) return;
    event.preventDefault();
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const minInspectorWidth = 380;
    const minReaderWidth = 480;

    const handleMove = (moveEvent: MouseEvent) => {
      const workspaceRect = workspaceRef.current?.getBoundingClientRect();
      if (!workspaceRect) return;
      const workspaceStyle = window.getComputedStyle(workspaceRef.current as Element);
      const layoutGap = Number.parseFloat(workspaceStyle.columnGap || workspaceStyle.gap || "14") || 14;
      const libraryPane = workspaceRef.current?.querySelector<HTMLElement>(".v35-translation-library");
      const libraryWidth = isLibraryCollapsed ? 0 : Math.round(libraryPane?.getBoundingClientRect().width || 0);
      const gapCount = isLibraryCollapsed ? 1 : 2;
      const maxInspectorWidth = Math.max(
        minInspectorWidth,
        workspaceRect.width - libraryWidth - layoutGap * gapCount - minReaderWidth,
      );
      const nextInspectorWidth = workspaceRect.right - moveEvent.clientX - layoutGap / 2;
      const clampedWidth = Math.min(maxInspectorWidth, Math.max(minInspectorWidth, nextInspectorWidth));
      setInspectorPaneWidth(workspaceId, clampedWidth);
    };

    const handleUp = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }, [isLibraryCollapsed, setInspectorPaneWidth, workspaceId]);

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

      <div ref={workspaceRef} className={`v35-translator-workspace ${isLibraryCollapsed ? "is-library-collapsed" : ""}`} style={workspaceStyle}>
        <aside className="v35-translation-library v35-paper-panel">
          <header className="v35-column-header">
            <div>
              <h2 className="v35-section-title">Documents</h2>
              <p className="v35-muted">{workspaceId}</p>
            </div>
            <button
              className="v35-icon-button"
              type="button"
              aria-label="收起文档栏"
              title="收起文档栏"
              onClick={() => setLibraryCollapsed(workspaceId, true)}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M10.5 3.5 6 8l4.5 4.5" />
              </svg>
            </button>
          </header>

          <div className="v35-search-box">
            <input
              className="v35-input"
              type="search"
              value={documentQuery}
              onChange={(event) => setDocumentQuery(workspaceId, event.target.value)}
              placeholder="搜索标题、文件名、作者或年份"
            />
          </div>

          <div className="v35-translation-doc-list">
            {filesQuery.isLoading || librarySearchQuery.isLoading ? (
              <p className="v35-muted">正在加载...</p>
            ) : (
              visiblePdfDocuments.map((doc) => (
                <button
                  className={`v35-translation-doc ${doc.id === selectedDocumentId ? "is-active" : ""}`}
                  key={doc.id}
                  type="button"
                  title={[
                    doc.title || "",
                    (doc.authors || []).join(", "),
                    doc.year ? String(doc.year) : "",
                  ].filter(Boolean).join(" · ")}
                  onClick={() => {
                    setSelectedDocumentId(workspaceId, doc.id);
                    lastAutoSourceRef.current = "";
                  }}
                >
                  <strong>{doc.display_name || doc.filename}</strong>
                  <span>{doc.file_type} · {doc.status}</span>
                  <em>{shortId(doc.id)}</em>
                </button>
              ))
            )}
            {!filesQuery.isLoading && !librarySearchQuery.isLoading && visiblePdfDocuments.length === 0 && deferredDocumentQuery ? (
              <p className="v35-muted">没有匹配的 PDF 文档。</p>
            ) : null}
            {!filesQuery.isLoading && !librarySearchQuery.isLoading && pdfDocuments.length === 0 && !deferredDocumentQuery ? (
              <p className="v35-muted">当前工作区没有 PDF 文档。请先在文库页上传。</p>
            ) : null}
          </div>
        </aside>

        <main ref={readerPaneRef} className="v35-translation-reader v35-paper-panel">
          <header className="v35-translation-reader-head">
            <div>
              <p className="v35-translation-reader-kicker">
                {isLibraryCollapsed ? (
                  <button
                    className="v35-icon-button"
                    type="button"
                    aria-label="展开文档栏"
                    title="展开文档栏"
                    onClick={() => setLibraryCollapsed(workspaceId, false)}
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M5.5 3.5 10 8l-4.5 4.5" />
                    </svg>
                  </button>
                ) : null}
                <span>{selectedDocument ? shortId(selectedDocument.id) : "No Document"}</span>
              </p>
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
            <Suspense fallback={<PdfSkeleton />}>
              <PdfViewer
                className="v35-pdf-viewer"
                url={pdfFileUrl}
                onSelection={handlePdfSelection}
                selectionMode={viewerMode}
                scale={previewScale}
                initialScrollTop={initialReaderScrollTop}
                onScrollPositionChange={handleReaderScrollPositionChange}
              />
            </Suspense>
          ) : (
            <div className="v35-translation-pages">
              <p className="v35-muted">选择左侧一篇 PDF 文档即可预览。</p>
            </div>
          )}
        </main>

        <div
          className="v35-translation-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整原文与译文面板宽度"
          onMouseDown={handleInspectorResizeStart}
        />

        <aside ref={inspectorPaneRef} className="v35-translation-inspector v35-paper-panel">
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

              <label className="v35-field">
                <span>Target Language</span>
                <select className="v35-input" value={targetLanguage} onChange={(event) => setTargetLanguage(workspaceId, event.target.value)}>
                  {TARGET_LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
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
                  ) : visibleTranslationText ? (
                    <button className="v35-button" type="button" onClick={() => void copyText(visibleTranslationText, "译文")}>
                      复制
                    </button>
                  ) : null}
                </header>
                  {isTranslating ? (
                    <p className="v35-muted"><span className="v35-spinner" aria-label="正在翻译" /> 正在生成译文...</p>
                  ) : null}
                  {translationParagraphs.length > 0 ? (
                    translationParagraphs.map((paragraph, index) => (
                      <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
                    ))
                  ) : !isTranslating ? (
                    <p className="v35-muted">输入原文后翻译</p>
                  ) : null}
                  {isTranslating && translationParagraphs.length > 0 ? <span className="v35-stream-caret" aria-hidden="true" /> : null}
                 {latestResult && !isTranslating ? (
                   <footer>
                      {latestResult.provider} · {latestResult.model} · {latestResult.target_lang} ·{" "}
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
                          setTargetLanguage(workspaceId, item.target_lang || "zh-CN");
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
                          notifyToast({ tone: "success", title: "已恢复历史译文" });
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
