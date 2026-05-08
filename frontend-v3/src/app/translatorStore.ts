import { create } from "zustand";

import { cancelTranslationRequest, streamTranslateSelection, translateSelection, type TranslationResult } from "../shared/api/translation";
import type { PdfSelectionMode } from "../features/translator/PdfViewer";

export type InspectorTab = "result" | "history";
export type TranslateMode = "full" | "compact";

export const PREVIEW_SCALE_MIN = 0.9;
export const PREVIEW_SCALE_MAX = 2.1;
export const PREVIEW_SCALE_STEP = 0.15;
export const DEFAULT_PREVIEW_SCALE = 1.35;
export const DEFAULT_INSPECTOR_PANE_WIDTH = 420;
const STORAGE_KEY = "aindexer_v35_translator_state";

interface TranslatorWorkspaceState {
  documentQuery: string;
  selectedDocumentId: string;
  selectedModelKey: string;
  targetLanguage: string;
  isLibraryCollapsed: boolean;
  inspectorPaneWidth: number;
  sourceText: string;
  streamedTranslationText: string;
  inspectorTab: InspectorTab;
  translateMode: TranslateMode;
  latestResult: TranslationResult | null;
  statusMessage: string;
  viewerMode: PdfSelectionMode;
  isTranslating: boolean;
  previewScale: number;
  readerScrollTop: number;
}

interface PersistedTranslatorWorkspaceState {
  documentQuery?: string;
  selectedDocumentId?: string;
  selectedModelKey?: string;
  targetLanguage?: string;
  isLibraryCollapsed?: boolean;
  inspectorPaneWidth?: number;
  sourceText?: string;
  inspectorTab?: InspectorTab;
  translateMode?: TranslateMode;
  viewerMode?: PdfSelectionMode;
  previewScale?: number;
  readerScrollTop?: number;
}

interface StartTranslationArgs {
  workspaceId: string;
  provider: string;
  model: string | null;
  targetLanguage: string;
  preferStreaming?: boolean;
  sourceText?: string;
}

interface TranslatorState {
  byWorkspace: Record<string, TranslatorWorkspaceState>;
  ensureWorkspace: (workspaceId: string) => void;
  setDocumentQuery: (workspaceId: string, value: string) => void;
  setSelectedDocumentId: (workspaceId: string, documentId: string) => void;
  setSelectedModelKey: (workspaceId: string, value: string) => void;
  setTargetLanguage: (workspaceId: string, value: string) => void;
  setLibraryCollapsed: (workspaceId: string, value: boolean) => void;
  setInspectorPaneWidth: (workspaceId: string, value: number) => void;
  setSourceText: (workspaceId: string, value: string) => void;
  setInspectorTab: (workspaceId: string, tab: InspectorTab) => void;
  setTranslateMode: (workspaceId: string, mode: TranslateMode) => void;
  setViewerMode: (workspaceId: string, mode: PdfSelectionMode) => void;
  setPreviewScale: (workspaceId: string, next: number | ((current: number) => number)) => void;
  setReaderScrollTop: (workspaceId: string, scrollTop: number) => void;
  setLatestResult: (workspaceId: string, result: TranslationResult | null) => void;
  setStatusMessage: (workspaceId: string, message: string) => void;
  startTranslation: (args: StartTranslationArgs) => Promise<void>;
  cancelActiveTranslation: (workspaceId: string) => Promise<void>;
}

const controllers = new Map<string, AbortController>();
const clientRequestIds = new Map<string, string>();

function normalizeText(text: string): string {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.replace(/[^\S\n]+/g, " ").replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

function createDefaultWorkspaceState(): TranslatorWorkspaceState {
  return {
    documentQuery: "",
    selectedDocumentId: "",
    selectedModelKey: "",
    targetLanguage: "zh-CN",
    isLibraryCollapsed: false,
    inspectorPaneWidth: DEFAULT_INSPECTOR_PANE_WIDTH,
    sourceText: "",
    streamedTranslationText: "",
    inspectorTab: "result",
    translateMode: "full",
    latestResult: null,
    statusMessage: "准备就绪",
    viewerMode: "layout",
    isTranslating: false,
    previewScale: DEFAULT_PREVIEW_SCALE,
    readerScrollTop: 0,
  };
}

export function getDefaultTranslatorWorkspaceState(): TranslatorWorkspaceState {
  return createDefaultWorkspaceState();
}

function buildWorkspaceStateFromPersisted(value: PersistedTranslatorWorkspaceState | null | undefined): TranslatorWorkspaceState {
  const defaults = createDefaultWorkspaceState();
  if (!value) return defaults;
  return {
    ...defaults,
    documentQuery: String(value.documentQuery || ""),
    selectedDocumentId: String(value.selectedDocumentId || ""),
    selectedModelKey: String(value.selectedModelKey || ""),
    targetLanguage: String(value.targetLanguage || defaults.targetLanguage),
    isLibraryCollapsed: Boolean(value.isLibraryCollapsed),
    inspectorPaneWidth: clampInspectorPaneWidth(Number(value.inspectorPaneWidth)),
    sourceText: String(value.sourceText || ""),
    inspectorTab: value.inspectorTab === "history" ? "history" : "result",
    translateMode: value.translateMode === "compact" ? "compact" : "full",
    viewerMode: value.viewerMode === "text" ? "text" : "layout",
    previewScale: Number.isFinite(Number(value.previewScale)) ? Number(value.previewScale) : defaults.previewScale,
    readerScrollTop: Math.max(0, Number.isFinite(Number(value.readerScrollTop)) ? Number(value.readerScrollTop) : 0),
  };
}

function getStoredTranslatorState(): Record<string, TranslatorWorkspaceState> {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, PersistedTranslatorWorkspaceState>;
    return Object.fromEntries(
      Object.entries(parsed || {}).map(([workspaceId, workspace]) => [workspaceId, buildWorkspaceStateFromPersisted(workspace)]),
    );
  } catch {
    return {};
  }
}

function persistTranslatorState(byWorkspace: Record<string, TranslatorWorkspaceState>) {
  try {
    const serialized = Object.fromEntries(
      Object.entries(byWorkspace).map(([workspaceId, workspace]) => [workspaceId, {
        documentQuery: workspace.documentQuery,
        selectedDocumentId: workspace.selectedDocumentId,
        selectedModelKey: workspace.selectedModelKey,
        targetLanguage: workspace.targetLanguage,
        isLibraryCollapsed: workspace.isLibraryCollapsed,
        inspectorPaneWidth: workspace.inspectorPaneWidth,
        sourceText: workspace.sourceText,
        inspectorTab: workspace.inspectorTab,
        translateMode: workspace.translateMode,
        viewerMode: workspace.viewerMode,
        previewScale: workspace.previewScale,
        readerScrollTop: workspace.readerScrollTop,
      } satisfies PersistedTranslatorWorkspaceState]),
    );
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(serialized));
  } catch {
    // ignore storage failures
  }
}

function workspaceStateFor(state: TranslatorState, workspaceId: string): TranslatorWorkspaceState {
  return state.byWorkspace[workspaceId] ?? createDefaultWorkspaceState();
}

function clampInspectorPaneWidth(value: number): number {
  return Math.min(760, Math.max(380, Number.isFinite(value) ? value : DEFAULT_INSPECTOR_PANE_WIDTH));
}

function isStreamingUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.includes("未标记为支持流式输出") || message.includes("不支持流式翻译");
}

function updateWorkspace(
  state: TranslatorState,
  workspaceId: string,
  updater: (workspace: TranslatorWorkspaceState) => TranslatorWorkspaceState,
): Pick<TranslatorState, "byWorkspace"> {
  return {
    byWorkspace: {
      ...state.byWorkspace,
      [workspaceId]: updater(workspaceStateFor(state, workspaceId)),
    },
  };
}

export const useTranslatorStore = create<TranslatorState>((set, get) => ({
  byWorkspace: getStoredTranslatorState(),
  ensureWorkspace: (workspaceId) => {
    set((state) => {
      if (state.byWorkspace[workspaceId]) {
        return state;
      }
      const nextByWorkspace = {
        ...state.byWorkspace,
        [workspaceId]: createDefaultWorkspaceState(),
      };
      persistTranslatorState(nextByWorkspace);
      return { byWorkspace: nextByWorkspace };
    });
  },
  setDocumentQuery: (workspaceId, value) => {
    set((state) => {
      const next = updateWorkspace(state, workspaceId, (workspace) => ({
        ...workspace,
        documentQuery: value,
      }));
      persistTranslatorState(next.byWorkspace);
      return next;
    });
  },
  setSelectedDocumentId: (workspaceId, documentId) => {
    set((state) => {
      const next = updateWorkspace(state, workspaceId, (workspace) => ({
        ...workspace,
        selectedDocumentId: documentId,
        sourceText: "",
        streamedTranslationText: "",
        latestResult: null,
        readerScrollTop: 0,
      }));
      persistTranslatorState(next.byWorkspace);
      return next;
    });
  },
  setSelectedModelKey: (workspaceId, value) => {
    set((state) => {
      const next = updateWorkspace(state, workspaceId, (workspace) => ({ ...workspace, selectedModelKey: value }));
      persistTranslatorState(next.byWorkspace);
      return next;
    });
  },
  setTargetLanguage: (workspaceId, value) => {
    set((state) => {
      const next = updateWorkspace(state, workspaceId, (workspace) => ({
        ...workspace,
        targetLanguage: value || "zh-CN",
      }));
      persistTranslatorState(next.byWorkspace);
      return next;
    });
  },
  setLibraryCollapsed: (workspaceId, value) => {
    set((state) => {
      const next = updateWorkspace(state, workspaceId, (workspace) => ({
        ...workspace,
        isLibraryCollapsed: value,
      }));
      persistTranslatorState(next.byWorkspace);
      return next;
    });
  },
  setInspectorPaneWidth: (workspaceId, value) => {
    set((state) => {
      const next = updateWorkspace(state, workspaceId, (workspace) => ({
        ...workspace,
        inspectorPaneWidth: clampInspectorPaneWidth(value),
      }));
      persistTranslatorState(next.byWorkspace);
      return next;
    });
  },
  setSourceText: (workspaceId, value) => {
    set((state) => {
      const next = updateWorkspace(state, workspaceId, (workspace) => ({ ...workspace, sourceText: value }));
      persistTranslatorState(next.byWorkspace);
      return next;
    });
  },
  setInspectorTab: (workspaceId, tab) => {
    set((state) => {
      const next = updateWorkspace(state, workspaceId, (workspace) => ({ ...workspace, inspectorTab: tab }));
      persistTranslatorState(next.byWorkspace);
      return next;
    });
  },
  setTranslateMode: (workspaceId, mode) => {
    set((state) => {
      const next = updateWorkspace(state, workspaceId, (workspace) => ({ ...workspace, translateMode: mode }));
      persistTranslatorState(next.byWorkspace);
      return next;
    });
  },
  setViewerMode: (workspaceId, mode) => {
    set((state) => {
      const next = updateWorkspace(state, workspaceId, (workspace) => ({ ...workspace, viewerMode: mode }));
      persistTranslatorState(next.byWorkspace);
      return next;
    });
  },
  setPreviewScale: (workspaceId, next) => {
    set((state) => {
      const updated = updateWorkspace(state, workspaceId, (workspace) => ({
        ...workspace,
        previewScale: typeof next === "function" ? next(workspace.previewScale) : next,
      }));
      persistTranslatorState(updated.byWorkspace);
      return updated;
    });
  },
  setReaderScrollTop: (workspaceId, scrollTop) => {
    set((state) => {
      const updated = updateWorkspace(state, workspaceId, (workspace) => ({
        ...workspace,
        readerScrollTop: Math.max(0, Math.round(scrollTop)),
      }));
      persistTranslatorState(updated.byWorkspace);
      return updated;
    });
  },
  setLatestResult: (workspaceId, result) => {
    set((state) => updateWorkspace(state, workspaceId, (workspace) => ({ ...workspace, latestResult: result })));
  },
  setStatusMessage: (workspaceId, message) => {
    set((state) => updateWorkspace(state, workspaceId, (workspace) => ({ ...workspace, statusMessage: message })));
  },
  startTranslation: async ({ workspaceId, provider, model, targetLanguage, preferStreaming = false, sourceText }) => {
    get().ensureWorkspace(workspaceId);
    const workspace = workspaceStateFor(get(), workspaceId);
    const documentId = workspace.selectedDocumentId.trim();
    const source = normalizeText(sourceText ?? workspace.sourceText);
    if (!documentId || !provider) {
      return;
    }

    controllers.get(workspaceId)?.abort();
    const controller = new AbortController();
    const clientRequestId = crypto.randomUUID?.() || `treq_${Date.now()}`;
    controllers.set(workspaceId, controller);
    clientRequestIds.set(workspaceId, clientRequestId);

    set((state) => updateWorkspace(state, workspaceId, (current) => ({
      ...current,
      sourceText: source,
      streamedTranslationText: "",
      latestResult: null,
      isTranslating: true,
      statusMessage: "正在翻译",
    })));

    try {
      const payload = {
        document_id: documentId,
        workspace_id: workspaceId,
        provider,
        model,
        source_text: source,
        target_lang: targetLanguage || workspace.targetLanguage || "zh-CN",
        source_lang: null,
        anchor: { page: 1, quote: source, version: "v1" },
        metadata: { client_request_id: clientRequestId },
      };
      let result: TranslationResult;
      try {
        if (preferStreaming) {
          result = await streamTranslateSelection(
            payload,
            {
              onDelta: ({ text }) => {
                if (!text) return;
                set((state) => updateWorkspace(state, workspaceId, (current) => ({
                  ...current,
                  streamedTranslationText: `${current.streamedTranslationText || ""}${text}`,
                })));
              },
            },
            controller.signal,
          );
        } else {
          result = await translateSelection(payload, controller.signal);
        }
      } catch (error) {
        if (!preferStreaming || !isStreamingUnsupportedError(error)) {
          throw error;
        }
        result = await translateSelection(payload, controller.signal);
      }
      set((state) => updateWorkspace(state, workspaceId, (current) => ({
        ...current,
        latestResult: result,
        streamedTranslationText: result.translated_text,
        inspectorTab: "result",
        statusMessage: result.cached ? "命中缓存" : "翻译完成",
      })));
    } catch (error) {
      if (controller.signal.aborted) return;
      set((state) => updateWorkspace(state, workspaceId, (current) => ({
        ...current,
        streamedTranslationText: current.streamedTranslationText || "",
        statusMessage: error instanceof Error ? error.message : "翻译失败",
      })));
    } finally {
      if (controllers.get(workspaceId) === controller) {
        controllers.delete(workspaceId);
        clientRequestIds.delete(workspaceId);
        set((state) => updateWorkspace(state, workspaceId, (current) => ({
          ...current,
          isTranslating: false,
        })));
      }
    }
  },
  cancelActiveTranslation: async (workspaceId) => {
    const clientRequestId = clientRequestIds.get(workspaceId) || null;
    controllers.get(workspaceId)?.abort();
    controllers.delete(workspaceId);
    clientRequestIds.delete(workspaceId);
    if (clientRequestId) {
      await cancelTranslationRequest(clientRequestId).catch(() => undefined);
    }
    set((state) => updateWorkspace(state, workspaceId, (workspace) => ({
      ...workspace,
      isTranslating: false,
      statusMessage: "已取消",
    })));
  },
}));
