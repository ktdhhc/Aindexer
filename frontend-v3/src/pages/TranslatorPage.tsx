import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useWorkspaceStore } from "../app/workspaceStore";
import { buildOriginalFileUrl, listFiles } from "../shared/api/files";
import {
  cancelTranslationRequest,
  listTranslationHistory,
  translateSelection,
  type TranslationResult,
} from "../shared/api/translation";
import { listProviders } from "../shared/api/providers";
import {
  buildAvailableProviderModelEntries,
  type ProviderModelEntry,
} from "../shared/lib/providerModels";
import { getModelDefault, parseModelDefaultKey } from "../shared/lib/modelDefaults";
import { PdfViewer } from "../features/translator/PdfViewer";

type InspectorTab = "result" | "history";
type TranslateMode = "full" | "compact";

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
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceStore((state) => state.workspaceId);

  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [selectedModelKey, setSelectedModelKey] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("result");
  const [translateMode, setTranslateMode] = useState<TranslateMode>("full");
  const [latestResult, setLatestResult] = useState<TranslationResult | null>(null);
  const [statusMessage, setStatusMessage] = useState("准备就绪");

  const activeControllerRef = useRef<AbortController | null>(null);
  const activeClientRequestIdRef = useRef<string | null>(null);
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
    const docs = pdfDocuments;
    if (!docs || docs.length === 0) {
      setSelectedDocumentId("");
      return;
    }
    if (!selectedDocumentId || !docs.some((item) => item.id === selectedDocumentId)) {
      setSelectedDocumentId(docs[0].id);
    }
  }, [pdfDocuments, selectedDocumentId]);

  useEffect(() => {
    const options = modelOptions;
    if (options.length === 0) {
      setSelectedModelKey("");
      return;
    }
    if (!selectedModelKey || !options.some((e) => `${e.provider}::${e.model}` === selectedModelKey)) {
      const defaultKey =
        translationDefault && options.some((e) => e.provider === translationDefault.provider && e.model === translationDefault.model)
          ? `${translationDefault.provider}::${translationDefault.model}`
          : `${options[0].provider}::${options[0].model}`;
      setSelectedModelKey(defaultKey);
    }
  }, [modelOptions, selectedModelKey, translationDefault]);

  const doTranslate = useCallback(
    async (text: string) => {
      const documentId = selectedDocumentId.trim();
      const entry = selectedModelEntry;
      const source = normalizeText(text);
      if (!documentId) return;
      if (!entry?.provider) return;
      if (source.length < 40) return;

      activeControllerRef.current?.abort();
      const controller = new AbortController();
      const clientRequestId = crypto.randomUUID?.() || `treq_${Date.now()}`;
      activeControllerRef.current = controller;
      activeClientRequestIdRef.current = clientRequestId;
      setStatusMessage("正在翻译");

      try {
        const result = await translateSelection(
          {
            document_id: documentId,
            workspace_id: workspaceId,
            provider: entry.provider,
            model: entry.model || null,
            source_text: source,
            target_lang: "zh-CN",
            source_lang: null,
            anchor: { page: 1, quote: source, version: "v1" },
            metadata: { client_request_id: clientRequestId },
          },
          controller.signal,
        );
        setLatestResult(result);
        setInspectorTab("result");
        setStatusMessage(result.cached ? "命中缓存" : "翻译完成");
        await queryClient.invalidateQueries({ queryKey: ["translation-history", workspaceId, selectedDocumentId] });
      } catch (error) {
        if (controller.signal.aborted) return;
        setStatusMessage(error instanceof Error ? error.message : "翻译失败");
      } finally {
        if (activeControllerRef.current === controller) {
          activeControllerRef.current = null;
          activeClientRequestIdRef.current = null;
        }
      }
    },
    [selectedDocumentId, selectedModelEntry, workspaceId, queryClient],
  );

  const translateMutation = useMutation({
    mutationFn: () => doTranslate(sourceText),
    onError: (error) => {
      setStatusMessage(error instanceof Error ? error.message : "翻译失败");
    },
  });

  async function cancelActiveTranslation() {
    const clientRequestId = activeClientRequestIdRef.current;
    activeControllerRef.current?.abort();
    if (clientRequestId) {
      await cancelTranslationRequest(clientRequestId).catch(() => undefined);
    }
    translateMutation.reset();
    setStatusMessage("已取消");
  }

  const handlePdfSelection = useCallback(
    (text: string) => {
      if (autoDebounceRef.current) {
        clearTimeout(autoDebounceRef.current);
      }
      const normalized = normalizeText(text);
      if (normalized === lastAutoSourceRef.current) return;
      if (normalized.length < 40) return;

      lastAutoSourceRef.current = normalized;
      setSourceText(normalized);

      autoDebounceRef.current = setTimeout(() => {
        void doTranslate(normalized);
      }, 800);
    },
    [doTranslate],
  );

  const handleTextareaMouseUp = useCallback(() => {
    if (autoDebounceRef.current) clearTimeout(autoDebounceRef.current);
    autoDebounceRef.current = setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;
      const text = normalizeText(selection.toString());
      if (!text || text.length < 40) return;
      if (text === lastAutoSourceRef.current) return;
      if (!selectedDocumentId || !selectedModelEntry?.provider) return;
      lastAutoSourceRef.current = text;
      setSourceText(text);
      autoDebounceRef.current = setTimeout(() => {
        void doTranslate(text);
      }, 600);
    }, 200);
  }, [selectedDocumentId, selectedModelEntry, doTranslate]);

  const canStartTranslate = Boolean(
    selectedDocumentId && selectedModelEntry && sourceStats.chars >= 40 && !translateMutation.isPending,
  );

  const pdfFileUrl = selectedDocumentId ? buildOriginalFileUrl(selectedDocumentId, workspaceId) : "";

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
                    setSelectedDocumentId(doc.id);
                    setSourceText("");
                    setLatestResult(null);
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
            />
          ) : (
            <div className="v35-translation-pages">
              <p className="v35-muted">选择左侧一篇 PDF 文档即可预览。</p>
            </div>
          )}
        </main>

        <aside className="v35-translation-inspector v35-paper-panel">
          <div className="v35-inspector-tabs" role="tablist" aria-label="翻译面板">
            <button className={inspectorTab === "result" ? "is-active" : ""} type="button" onClick={() => setInspectorTab("result")}>
              译文
            </button>
            <button className={inspectorTab === "history" ? "is-active" : ""} type="button" onClick={() => setInspectorTab("history")}>
              历史
            </button>
          </div>

          {inspectorTab === "result" ? (
            <div className="v35-inspector-section">
              <label className="v35-field">
                <span>Model</span>
                <select className="v35-input" value={selectedModelKey} onChange={(event) => setSelectedModelKey(event.target.value)}>
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
                    onClick={() => setTranslateMode("full")}
                  >
                    完整
                  </button>
                  <button
                    className={`v35-mode-btn ${translateMode === "compact" ? "is-active" : ""}`}
                    type="button"
                    onClick={() => setTranslateMode("compact")}
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
                        setSourceText(event.target.value);
                        lastAutoSourceRef.current = "";
                      }}
                      onMouseUp={handleTextareaMouseUp}
                      placeholder="粘贴或输入原文；也可选中文本后松手自动翻译..."
                    />
                  </label>

                  <div className="v35-config-actions">
                    <button className="v35-button v35-button-primary" type="button" disabled={!canStartTranslate} onClick={() => void translateMutation.mutateAsync()}>
                      翻译选区
                    </button>
                    <button className="v35-button" type="button" disabled={!translateMutation.isPending} onClick={() => void cancelActiveTranslation()}>
                      取消
                    </button>
                    <button className="v35-button" type="button" disabled={!sourceText} onClick={() => { setSourceText(""); lastAutoSourceRef.current = ""; }}>
                      清空
                    </button>
                  </div>
                </>
              ) : null}

              {sourceStats.chars > 0 && sourceStats.chars < 40 ? <p className="v35-error">选区至少 40 字</p> : null}
              {translateMutation.isError ? (
                <p className="v35-error">{translateMutation.error instanceof Error ? translateMutation.error.message : "翻译失败"}</p>
              ) : null}

              <article className="v35-translation-result">
                <header>
                  <span>{latestResult?.cached ? "Cached" : "Result"}</span>
                  {translateMutation.isPending ? (
                    <button className="v35-button" type="button" onClick={() => void cancelActiveTranslation()}>
                      取消
                    </button>
                  ) : latestResult ? (
                    <button className="v35-button" type="button" onClick={() => void navigator.clipboard?.writeText(latestResult.translated_text)}>
                      复制
                    </button>
                  ) : null}
                </header>
                {translateMutation.isPending ? (
                  <p className="v35-muted"><span className="v35-spinner" aria-label="正在翻译" /> 正在生成译文...</p>
                ) : null}
                {latestResult ? (
                  <p>{latestResult.translated_text}</p>
                ) : !translateMutation.isPending ? (
                  <p className="v35-muted">输入原文后翻译</p>
                ) : null}
                {latestResult && !translateMutation.isPending ? (
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
                          setSourceText(item.source_text);
                          setLatestResult({
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
                          setInspectorTab("result");
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
