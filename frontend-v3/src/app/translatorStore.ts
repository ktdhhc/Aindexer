import { create } from "zustand";

import { cancelTranslationRequest, translateSelection, type TranslationResult } from "../shared/api/translation";
import type { PdfSelectionMode } from "../features/translator/PdfViewer";

export type InspectorTab = "result" | "history";
export type TranslateMode = "full" | "compact";

export const PREVIEW_SCALE_MIN = 0.9;
export const PREVIEW_SCALE_MAX = 2.1;
export const PREVIEW_SCALE_STEP = 0.15;
export const DEFAULT_PREVIEW_SCALE = 1.35;

interface TranslatorWorkspaceState {
  selectedDocumentId: string;
  selectedModelKey: string;
  sourceText: string;
  inspectorTab: InspectorTab;
  translateMode: TranslateMode;
  latestResult: TranslationResult | null;
  statusMessage: string;
  viewerMode: PdfSelectionMode;
  isTranslating: boolean;
  previewScale: number;
}

interface StartTranslationArgs {
  workspaceId: string;
  provider: string;
  model: string | null;
  sourceText?: string;
}

interface TranslatorState {
  byWorkspace: Record<string, TranslatorWorkspaceState>;
  ensureWorkspace: (workspaceId: string) => void;
  setSelectedDocumentId: (workspaceId: string, documentId: string) => void;
  setSelectedModelKey: (workspaceId: string, value: string) => void;
  setSourceText: (workspaceId: string, value: string) => void;
  setInspectorTab: (workspaceId: string, tab: InspectorTab) => void;
  setTranslateMode: (workspaceId: string, mode: TranslateMode) => void;
  setViewerMode: (workspaceId: string, mode: PdfSelectionMode) => void;
  setPreviewScale: (workspaceId: string, next: number | ((current: number) => number)) => void;
  setLatestResult: (workspaceId: string, result: TranslationResult | null) => void;
  setStatusMessage: (workspaceId: string, message: string) => void;
  startTranslation: (args: StartTranslationArgs) => Promise<void>;
  cancelActiveTranslation: (workspaceId: string) => Promise<void>;
}

const controllers = new Map<string, AbortController>();
const clientRequestIds = new Map<string, string>();

function normalizeText(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function createDefaultWorkspaceState(): TranslatorWorkspaceState {
  return {
    selectedDocumentId: "",
    selectedModelKey: "",
    sourceText: "",
    inspectorTab: "result",
    translateMode: "full",
    latestResult: null,
    statusMessage: "准备就绪",
    viewerMode: "layout",
    isTranslating: false,
    previewScale: DEFAULT_PREVIEW_SCALE,
  };
}

function workspaceStateFor(state: TranslatorState, workspaceId: string): TranslatorWorkspaceState {
  return state.byWorkspace[workspaceId] ?? createDefaultWorkspaceState();
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
  byWorkspace: {},
  ensureWorkspace: (workspaceId) => {
    set((state) => state.byWorkspace[workspaceId]
      ? state
      : {
          byWorkspace: {
            ...state.byWorkspace,
            [workspaceId]: createDefaultWorkspaceState(),
          },
        });
  },
  setSelectedDocumentId: (workspaceId, documentId) => {
    set((state) => updateWorkspace(state, workspaceId, (workspace) => ({
      ...workspace,
      selectedDocumentId: documentId,
      sourceText: "",
      latestResult: null,
    })));
  },
  setSelectedModelKey: (workspaceId, value) => {
    set((state) => updateWorkspace(state, workspaceId, (workspace) => ({ ...workspace, selectedModelKey: value })));
  },
  setSourceText: (workspaceId, value) => {
    set((state) => updateWorkspace(state, workspaceId, (workspace) => ({ ...workspace, sourceText: value })));
  },
  setInspectorTab: (workspaceId, tab) => {
    set((state) => updateWorkspace(state, workspaceId, (workspace) => ({ ...workspace, inspectorTab: tab })));
  },
  setTranslateMode: (workspaceId, mode) => {
    set((state) => updateWorkspace(state, workspaceId, (workspace) => ({ ...workspace, translateMode: mode })));
  },
  setViewerMode: (workspaceId, mode) => {
    set((state) => updateWorkspace(state, workspaceId, (workspace) => ({ ...workspace, viewerMode: mode })));
  },
  setPreviewScale: (workspaceId, next) => {
    set((state) => updateWorkspace(state, workspaceId, (workspace) => ({
      ...workspace,
      previewScale: typeof next === "function" ? next(workspace.previewScale) : next,
    })));
  },
  setLatestResult: (workspaceId, result) => {
    set((state) => updateWorkspace(state, workspaceId, (workspace) => ({ ...workspace, latestResult: result })));
  },
  setStatusMessage: (workspaceId, message) => {
    set((state) => updateWorkspace(state, workspaceId, (workspace) => ({ ...workspace, statusMessage: message })));
  },
  startTranslation: async ({ workspaceId, provider, model, sourceText }) => {
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
      isTranslating: true,
      statusMessage: "正在翻译",
    })));

    try {
      const result = await translateSelection(
        {
          document_id: documentId,
          workspace_id: workspaceId,
          provider,
          model,
          source_text: source,
          target_lang: "zh-CN",
          source_lang: null,
          anchor: { page: 1, quote: source, version: "v1" },
          metadata: { client_request_id: clientRequestId },
        },
        controller.signal,
      );
      set((state) => updateWorkspace(state, workspaceId, (current) => ({
        ...current,
        latestResult: result,
        inspectorTab: "result",
        statusMessage: result.cached ? "命中缓存" : "翻译完成",
      })));
    } catch (error) {
      if (controller.signal.aborted) return;
      set((state) => updateWorkspace(state, workspaceId, (current) => ({
        ...current,
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
