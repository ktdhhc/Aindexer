import { create } from "zustand";

import { queuePersistClientState } from "../shared/lib/clientState";
import type { UsageBreakdownBy, UsagePeriod } from "../shared/api/usage";

export type ConfigPageSection = "providers" | "defaults" | "fields" | "workspaces" | "usage" | "backup";
export type WorkbenchSortField = "display_name" | "authors" | "year" | "modified_at";
export type WorkbenchSortDirection = "asc" | "desc";
export type WorkbenchPreviewMode = "rendered" | "raw";

export interface ConfigPageSession {
  section: ConfigPageSection;
  selectedProvider: string;
  selectedTemplateId: string;
  activeFieldIndex: number;
  selectedBackupTool: "export" | "restore" | "logs" | "updates";
  usagePeriod: UsagePeriod;
  usageBreakdownBy: UsageBreakdownBy;
  selectedUsageMonth: string;
  selectedUsageYear: string;
  selectedUsageLegend: string;
}

export interface WorkbenchPageSession {
  provider: string;
  model: string;
  templateId: string;
  searchInput: string;
  searchSortField: WorkbenchSortField;
  searchSortDirection: WorkbenchSortDirection;
  selectedDocId: string;
  previewMode: WorkbenchPreviewMode;
  isEditingPreview: boolean;
}

export interface ChatPageSession {
  selectedModelKey: string;
  question: string;
  sourceSearch: string;
  editingSessionId: string;
  editingSessionTitle: string;
  expandedTraceByMessage: Record<string, boolean>;
  expandedThinkingByBlock: Record<string, boolean>;
  threadScrollTopBySessionId: Record<string, number>;
}

interface PageSessionState {
  configByWorkspace: Record<string, ConfigPageSession>;
  workbenchByWorkspace: Record<string, WorkbenchPageSession>;
  chatByWorkspace: Record<string, ChatPageSession>;
  ensureConfigSession: (workspaceId: string) => void;
  updateConfigSession: (
    workspaceId: string,
    next: Partial<ConfigPageSession> | ((current: ConfigPageSession) => Partial<ConfigPageSession>),
  ) => void;
  ensureWorkbenchSession: (workspaceId: string) => void;
  updateWorkbenchSession: (
    workspaceId: string,
    next: Partial<WorkbenchPageSession> | ((current: WorkbenchPageSession) => Partial<WorkbenchPageSession>),
  ) => void;
  ensureChatSession: (workspaceId: string) => void;
  updateChatSession: (
    workspaceId: string,
    next: Partial<ChatPageSession> | ((current: ChatPageSession) => Partial<ChatPageSession>),
  ) => void;
}

const STORAGE_KEY = "aindexer_v35_page_sessions";

const DEFAULT_CONFIG_SESSION: ConfigPageSession = {
  section: "providers",
  selectedProvider: "",
  selectedTemplateId: "tpl_default",
  activeFieldIndex: 0,
  selectedBackupTool: "export",
  usagePeriod: "day",
  usageBreakdownBy: "feature",
  selectedUsageMonth: "",
  selectedUsageYear: "",
  selectedUsageLegend: "",
};

const DEFAULT_WORKBENCH_SESSION: WorkbenchPageSession = {
  provider: "",
  model: "",
  templateId: "tpl_default",
  searchInput: "",
  searchSortField: "modified_at",
  searchSortDirection: "desc",
  selectedDocId: "",
  previewMode: "rendered",
  isEditingPreview: false,
};

const DEFAULT_CHAT_SESSION: ChatPageSession = {
  selectedModelKey: "",
  question: "",
  sourceSearch: "",
  editingSessionId: "",
  editingSessionTitle: "",
  expandedTraceByMessage: {},
  expandedThinkingByBlock: {},
  threadScrollTopBySessionId: {},
};

function normalizeConfigSection(value: unknown): ConfigPageSection {
  if (value === "providers" || value === "defaults" || value === "fields" || value === "workspaces" || value === "usage" || value === "backup") {
    return value;
  }
  if (value === "updates") {
    return "backup";
  }
  return DEFAULT_CONFIG_SESSION.section;
}

function normalizeUsagePeriod(value: unknown): UsagePeriod {
  return value === "month" ? "month" : "day";
}

function normalizeUsageBreakdownBy(value: unknown): UsageBreakdownBy {
  if (value === "provider" || value === "model" || value === "api_key_fingerprint") {
    return value;
  }
  return "feature";
}

function normalizeWorkbenchSortField(value: unknown): WorkbenchSortField {
  if (value === "display_name" || value === "authors" || value === "year" || value === "modified_at") {
    return value;
  }
  return DEFAULT_WORKBENCH_SESSION.searchSortField;
}

function normalizeWorkbenchSortDirection(value: unknown): WorkbenchSortDirection {
  return value === "asc" ? "asc" : "desc";
}

function normalizeWorkbenchPreviewMode(value: unknown): WorkbenchPreviewMode {
  return value === "raw" ? "raw" : "rendered";
}

function normalizeBooleanRecord(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, raw]) => [String(key), Boolean(raw)] as const),
  );
}

function normalizeNumberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, raw]) => [String(key), Math.max(0, Math.round(Number(raw)))] as const)
      .filter(([, numberValue]) => Number.isFinite(numberValue)),
  );
}

function normalizeConfigSession(value: Partial<ConfigPageSession> | null | undefined): ConfigPageSession {
  return {
    section: normalizeConfigSection(value?.section),
    selectedProvider: String(value?.selectedProvider || ""),
    selectedTemplateId: String(value?.selectedTemplateId || DEFAULT_CONFIG_SESSION.selectedTemplateId),
    activeFieldIndex: Math.max(0, Number.isFinite(Number(value?.activeFieldIndex)) ? Number(value?.activeFieldIndex) : 0),
    selectedBackupTool:
      value?.selectedBackupTool === "restore" || value?.selectedBackupTool === "logs" || value?.selectedBackupTool === "updates"
        ? value.selectedBackupTool
        : "export",
    usagePeriod: normalizeUsagePeriod(value?.usagePeriod),
    usageBreakdownBy: normalizeUsageBreakdownBy(value?.usageBreakdownBy),
    selectedUsageMonth: String(value?.selectedUsageMonth || ""),
    selectedUsageYear: String(value?.selectedUsageYear || ""),
    selectedUsageLegend: String(value?.selectedUsageLegend || ""),
  };
}

function normalizeWorkbenchSession(value: Partial<WorkbenchPageSession> | null | undefined): WorkbenchPageSession {
  return {
    provider: String(value?.provider || ""),
    model: String(value?.model || ""),
    templateId: String(value?.templateId || DEFAULT_WORKBENCH_SESSION.templateId),
    searchInput: String(value?.searchInput || ""),
    searchSortField: normalizeWorkbenchSortField(value?.searchSortField),
    searchSortDirection: normalizeWorkbenchSortDirection(value?.searchSortDirection),
    selectedDocId: String(value?.selectedDocId || ""),
    previewMode: normalizeWorkbenchPreviewMode(value?.previewMode),
    isEditingPreview: Boolean(value?.isEditingPreview),
  };
}

function normalizeChatSession(value: Partial<ChatPageSession> | null | undefined): ChatPageSession {
  return {
    selectedModelKey: String(value?.selectedModelKey || ""),
    question: String(value?.question || ""),
    sourceSearch: String(value?.sourceSearch || ""),
    editingSessionId: String(value?.editingSessionId || ""),
    editingSessionTitle: String(value?.editingSessionTitle || ""),
    expandedTraceByMessage: normalizeBooleanRecord(value?.expandedTraceByMessage),
    expandedThinkingByBlock: normalizeBooleanRecord(value?.expandedThinkingByBlock),
    threadScrollTopBySessionId: normalizeNumberRecord(value?.threadScrollTopBySessionId),
  };
}

function readStoredPageSessions(): Pick<PageSessionState, "configByWorkspace" | "workbenchByWorkspace" | "chatByWorkspace"> {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { configByWorkspace: {}, workbenchByWorkspace: {}, chatByWorkspace: {} };
    const parsed = JSON.parse(raw) as {
      configByWorkspace?: Record<string, Partial<ConfigPageSession>>;
      workbenchByWorkspace?: Record<string, Partial<WorkbenchPageSession>>;
      chatByWorkspace?: Record<string, Partial<ChatPageSession>>;
    };
    const configByWorkspace = Object.fromEntries(
      Object.entries(parsed.configByWorkspace || {}).map(([workspaceId, session]) => [workspaceId, normalizeConfigSession(session)]),
    );
    const workbenchByWorkspace = Object.fromEntries(
      Object.entries(parsed.workbenchByWorkspace || {}).map(([workspaceId, session]) => [workspaceId, normalizeWorkbenchSession(session)]),
    );
    const chatByWorkspace = Object.fromEntries(
      Object.entries(parsed.chatByWorkspace || {}).map(([workspaceId, session]) => [workspaceId, normalizeChatSession(session)]),
    );
    return { configByWorkspace, workbenchByWorkspace, chatByWorkspace };
  } catch {
    return { configByWorkspace: {}, workbenchByWorkspace: {}, chatByWorkspace: {} };
  }
}

function persistPageSessions(
  configByWorkspace: Record<string, ConfigPageSession>,
  workbenchByWorkspace: Record<string, WorkbenchPageSession>,
  chatByWorkspace: Record<string, ChatPageSession>,
) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ configByWorkspace, workbenchByWorkspace, chatByWorkspace }));
    queuePersistClientState();
  } catch {
    // ignore storage failures
  }
}

function configSessionFor(state: PageSessionState, workspaceId: string): ConfigPageSession {
  return state.configByWorkspace[workspaceId] ?? DEFAULT_CONFIG_SESSION;
}

function workbenchSessionFor(state: PageSessionState, workspaceId: string): WorkbenchPageSession {
  return state.workbenchByWorkspace[workspaceId] ?? DEFAULT_WORKBENCH_SESSION;
}

function chatSessionFor(state: PageSessionState, workspaceId: string): ChatPageSession {
  return state.chatByWorkspace[workspaceId] ?? DEFAULT_CHAT_SESSION;
}

export function getDefaultConfigPageSession(): ConfigPageSession {
  return { ...DEFAULT_CONFIG_SESSION };
}

export function getDefaultWorkbenchPageSession(): WorkbenchPageSession {
  return { ...DEFAULT_WORKBENCH_SESSION };
}

export function getDefaultChatPageSession(): ChatPageSession {
  return {
    ...DEFAULT_CHAT_SESSION,
    expandedTraceByMessage: {},
    expandedThinkingByBlock: {},
    threadScrollTopBySessionId: {},
  };
}

const storedPageSessions = readStoredPageSessions();

export const usePageSessionStore = create<PageSessionState>((set) => ({
  configByWorkspace: storedPageSessions.configByWorkspace,
  workbenchByWorkspace: storedPageSessions.workbenchByWorkspace,
  chatByWorkspace: storedPageSessions.chatByWorkspace,
  ensureConfigSession: (workspaceId) => {
    const key = String(workspaceId || "").trim();
    if (!key) return;
    set((state) => {
      if (state.configByWorkspace[key]) {
        return state;
      }
      const nextConfigByWorkspace = {
        ...state.configByWorkspace,
        [key]: getDefaultConfigPageSession(),
      };
      persistPageSessions(nextConfigByWorkspace, state.workbenchByWorkspace, state.chatByWorkspace);
      return { configByWorkspace: nextConfigByWorkspace };
    });
  },
  updateConfigSession: (workspaceId, next) => {
    const key = String(workspaceId || "").trim();
    if (!key) return;
    set((state) => {
      const current = configSessionFor(state, key);
      const patch = typeof next === "function" ? next(current) : next;
      const updated = normalizeConfigSession({ ...current, ...patch });
      const nextConfigByWorkspace = {
        ...state.configByWorkspace,
        [key]: updated,
      };
      persistPageSessions(nextConfigByWorkspace, state.workbenchByWorkspace, state.chatByWorkspace);
      return { configByWorkspace: nextConfigByWorkspace };
    });
  },
  ensureWorkbenchSession: (workspaceId) => {
    const key = String(workspaceId || "").trim();
    if (!key) return;
    set((state) => {
      if (state.workbenchByWorkspace[key]) {
        return state;
      }
      const nextWorkbenchByWorkspace = {
        ...state.workbenchByWorkspace,
        [key]: getDefaultWorkbenchPageSession(),
      };
      persistPageSessions(state.configByWorkspace, nextWorkbenchByWorkspace, state.chatByWorkspace);
      return { workbenchByWorkspace: nextWorkbenchByWorkspace };
    });
  },
  updateWorkbenchSession: (workspaceId, next) => {
    const key = String(workspaceId || "").trim();
    if (!key) return;
    set((state) => {
      const current = workbenchSessionFor(state, key);
      const patch = typeof next === "function" ? next(current) : next;
      const updated = normalizeWorkbenchSession({ ...current, ...patch });
      const nextWorkbenchByWorkspace = {
        ...state.workbenchByWorkspace,
        [key]: updated,
      };
      persistPageSessions(state.configByWorkspace, nextWorkbenchByWorkspace, state.chatByWorkspace);
      return { workbenchByWorkspace: nextWorkbenchByWorkspace };
    });
  },
  ensureChatSession: (workspaceId) => {
    const key = String(workspaceId || "").trim();
    if (!key) return;
    set((state) => {
      if (state.chatByWorkspace[key]) {
        return state;
      }
      const nextChatByWorkspace = {
        ...state.chatByWorkspace,
        [key]: getDefaultChatPageSession(),
      };
      persistPageSessions(state.configByWorkspace, state.workbenchByWorkspace, nextChatByWorkspace);
      return { chatByWorkspace: nextChatByWorkspace };
    });
  },
  updateChatSession: (workspaceId, next) => {
    const key = String(workspaceId || "").trim();
    if (!key) return;
    set((state) => {
      const current = chatSessionFor(state, key);
      const patch = typeof next === "function" ? next(current) : next;
      const updated = normalizeChatSession({ ...current, ...patch });
      const nextChatByWorkspace = {
        ...state.chatByWorkspace,
        [key]: updated,
      };
      persistPageSessions(state.configByWorkspace, state.workbenchByWorkspace, nextChatByWorkspace);
      return { chatByWorkspace: nextChatByWorkspace };
    });
  },
}));

export function hydratePageSessionsFromStorage(): void {
  const next = readStoredPageSessions();
  usePageSessionStore.setState({
    configByWorkspace: next.configByWorkspace,
    workbenchByWorkspace: next.workbenchByWorkspace,
    chatByWorkspace: next.chatByWorkspace,
  });
}
