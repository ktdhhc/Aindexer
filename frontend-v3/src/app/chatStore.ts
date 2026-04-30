import { create } from "zustand";

import {
  askChatWithSignal,
  normalizeSourceId,
  resolveAssistantCitedSources,
  streamChatWithSignal,
  stripAssistantCitationFooter,
  type ChatContextStats,
  type ChatHistoryMessage,
  type ChatMode,
  type ChatSource,
} from "../shared/api/chat";
import type { FileItem } from "../shared/api/files";
import type { ProviderModelEntry } from "../shared/lib/providerModels";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  sources?: ChatSource[];
  contextStats?: ChatContextStats;
}

export interface ChatSession {
  id: string;
  title: string;
  mode: ChatMode;
  locked: boolean;
  injectedDocIds: string[];
  selectedDocIds: string[];
  sourceMap: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  lastQuestion: string;
  messages: ChatMessage[];
}

type ChatSessionStore = Record<string, ChatSession[]>;

interface SubmitChatQuestionArgs {
  workspaceId: string;
  question: string;
  selectedModelEntry: ProviderModelEntry | null;
  indexedFiles: FileItem[];
}

interface ChatState {
  sessionsByWorkspace: Record<string, ChatSession[]>;
  activeSessionIds: Record<string, string>;
  sendingByWorkspace: Record<string, boolean>;
  statusByWorkspace: Record<string, string>;
  loadedWorkspaces: Record<string, boolean>;
  ensureWorkspace: (workspaceId: string) => void;
  setActiveSessionId: (workspaceId: string, sessionId: string) => void;
  createSession: (workspaceId: string, mode: ChatMode) => void;
  deleteSession: (workspaceId: string, sessionId: string) => void;
  renameSession: (workspaceId: string, sessionId: string, title: string) => void;
  changeMode: (workspaceId: string, mode: ChatMode) => void;
  toggleSource: (workspaceId: string, docId: string) => void;
  addSource: (workspaceId: string, docId: string) => void;
  submitQuestion: (args: SubmitChatQuestionArgs) => Promise<void>;
  stopGeneration: (workspaceId: string) => void;
}

const STORAGE_KEY = "aindexer_v35_chat_sessions";
const controllers = new Map<string, AbortController>();

function createMessageId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createSessionId(): string {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createMessage(role: ChatMessage["role"], content: string, sources?: ChatSource[], contextStats?: ChatContextStats): ChatMessage {
  return {
    id: createMessageId(),
    role,
    content,
    sources,
    contextStats,
    createdAt: new Date().toISOString(),
  };
}

function createEmptySession(mode: ChatMode = "deep"): ChatSession {
  const now = new Date().toISOString();
  return {
    id: createSessionId(),
    title: "新会话",
    mode,
    locked: false,
    injectedDocIds: [],
    selectedDocIds: [],
    sourceMap: {},
    createdAt: now,
    updatedAt: now,
    lastQuestion: "",
    messages: [],
  };
}

function readSessionStore(): ChatSessionStore {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ChatSessionStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeSessionStore(store: ChatSessionStore): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore storage failures
  }
}

function persistWorkspaceSessions(workspaceId: string, sessions: ChatSession[]): void {
  const store = readSessionStore();
  store[workspaceId] = sessions;
  writeSessionStore(store);
}

function isValidSourceId(value: string): boolean {
  return Boolean(normalizeSourceId(value));
}

function nextSourceIndex(sourceMap: Record<string, string>, prefix: "I" | "P"): number {
  return Object.values(sourceMap).reduce((highest, value) => {
    const normalized = normalizeSourceId(value);
    if (!isValidSourceId(normalized) || !normalized.startsWith(prefix)) return highest;
    return Math.max(highest, Number.parseInt(normalized.split("-")[1], 10) || 0);
  }, 0) + 1;
}

function mergeSourceMap(sourceMap: Record<string, string>, sources?: ChatSource[]): Record<string, string> {
  const next = { ...sourceMap };
  for (const source of sources ?? []) {
    const sourceId = normalizeSourceId(source.source_id);
    if (!source.doc_id || !isValidSourceId(sourceId)) continue;
    next[source.doc_id] = sourceId;
  }
  return next;
}

function extendSourceMap(sourceMap: Record<string, string>, docIds: string[], prefix: "I" | "P"): Record<string, string> {
  const next = { ...sourceMap };
  let cursor = nextSourceIndex(next, prefix);
  for (const docId of docIds) {
    const existing = normalizeSourceId(next[docId]);
    if (isValidSourceId(existing) && existing.startsWith(prefix)) continue;
    next[docId] = `${prefix}-${String(cursor).padStart(2, "0")}`;
    cursor += 1;
  }
  return next;
}

function normalizeSourceMap(rawSourceMap: unknown, messages: ChatMessage[]): Record<string, string> {
  let next: Record<string, string> = {};
  if (rawSourceMap && typeof rawSourceMap === "object" && !Array.isArray(rawSourceMap)) {
    for (const [docId, sourceId] of Object.entries(rawSourceMap as Record<string, unknown>)) {
      const normalized = normalizeSourceId(String(sourceId || ""));
      if (docId && isValidSourceId(normalized)) {
        next[docId] = normalized;
      }
    }
  }
  for (const message of messages) {
    next = mergeSourceMap(next, message.sources);
  }
  return next;
}

function normalizeSession(raw: ChatSession): ChatSession {
  const mode = raw.mode && ["wide", "deep", "agent"].includes(raw.mode) ? raw.mode : "deep";
  const messages = Array.isArray(raw.messages)
    ? raw.messages.map((message) => ({
        ...message,
        sources: (message.sources ?? []).map((source) => ({
          ...source,
          source_id: normalizeSourceId(source.source_id) || source.source_id,
        })),
      }))
    : [];
  const injectedDocIds = Array.isArray((raw as ChatSession & { injectedDocIds?: string[] }).injectedDocIds)
    ? (raw as ChatSession & { injectedDocIds?: string[] }).injectedDocIds ?? []
    : Array.isArray(raw.selectedDocIds)
      ? raw.selectedDocIds
      : [];
  return {
    ...raw,
    mode,
    locked: Boolean(raw.locked || messages.some((message) => message.role === "user" || message.role === "assistant")),
    injectedDocIds,
    selectedDocIds: Array.isArray((raw as ChatSession & { injectedDocIds?: string[] }).injectedDocIds)
      ? (Array.isArray(raw.selectedDocIds) ? raw.selectedDocIds : [])
      : [],
    sourceMap: normalizeSourceMap((raw as ChatSession & { sourceMap?: Record<string, string> }).sourceMap, messages),
    messages,
  };
}

function modeLabel(mode: ChatMode): string {
  return mode === "wide" ? "全景" : mode === "agent" ? "探索" : "精读";
}

function shouldPersistSourceMap(mode: ChatMode): boolean {
  return mode === "deep" || mode === "wide";
}

function buildSessionTitle(question: string): string {
  const normalized = question.replace(/\s+/g, " ").trim();
  if (!normalized) return "新会话";
  return normalized.length > 24 ? `${normalized.slice(0, 24)}...` : normalized;
}

function buildSourceSnapshot(docIds: string[], files: FileItem[], sourceMap: Record<string, string>): ChatSource[] {
  const map = new Map(files.map((item) => [item.id, item]));
  return docIds.map((docId) => {
    const item = map.get(docId);
    return {
      source_id: normalizeSourceId(sourceMap[docId]) || sourceMap[docId],
      doc_id: docId,
      display_name: item?.display_name || item?.filename || docId,
    };
  });
}

function buildHistoryPayload(messages: ChatMessage[]): ChatHistoryMessage[] {
  return messages
    .filter((message): message is ChatMessage & { role: "user" | "assistant" } => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role,
      content: message.role === "assistant" ? stripAssistantCitationFooter(message.content) : message.content,
      sources: message.role === "assistant" ? resolveAssistantCitedSources(message.content, message.sources) : message.sources,
    }));
}

function sessionSortTimestamp(session: ChatSession): string {
  const latestMessageAt = [...session.messages]
    .reverse()
    .find((message) => message.role === "user" || message.role === "assistant")
    ?.createdAt;
  return latestMessageAt || session.createdAt;
}

function sortSessions(sessions: ChatSession[]): ChatSession[] {
  return [...sessions].sort((a, b) => sessionSortTimestamp(b).localeCompare(sessionSortTimestamp(a)));
}

function updateSessionsForWorkspace(
  state: ChatState,
  workspaceId: string,
  updater: (sessions: ChatSession[]) => ChatSession[],
): Pick<ChatState, "sessionsByWorkspace"> {
  const currentSessions = state.sessionsByWorkspace[workspaceId] ?? [];
  const nextSessions = sortSessions(updater(currentSessions));
  persistWorkspaceSessions(workspaceId, nextSessions);
  return {
    sessionsByWorkspace: {
      ...state.sessionsByWorkspace,
      [workspaceId]: nextSessions,
    },
  };
}

function findActiveSession(state: ChatState, workspaceId: string): ChatSession | null {
  const sessions = state.sessionsByWorkspace[workspaceId] ?? [];
  const activeSessionId = state.activeSessionIds[workspaceId] || "";
  return sessions.find((session) => session.id === activeSessionId) ?? null;
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessionsByWorkspace: {},
  activeSessionIds: {},
  sendingByWorkspace: {},
  statusByWorkspace: {},
  loadedWorkspaces: {},
  ensureWorkspace: (workspaceId) => {
    const state = get();
    if (state.loadedWorkspaces[workspaceId]) {
      return;
    }
    const store = readSessionStore();
    const nextSessions = sortSessions((store[workspaceId] ?? []).map(normalizeSession));
    const initialSessions = nextSessions.length > 0 ? nextSessions : [createEmptySession()];
    if (nextSessions.length === 0) {
      persistWorkspaceSessions(workspaceId, initialSessions);
    }
    set((current) => ({
      sessionsByWorkspace: {
        ...current.sessionsByWorkspace,
        [workspaceId]: initialSessions,
      },
      activeSessionIds: {
        ...current.activeSessionIds,
        [workspaceId]: current.activeSessionIds[workspaceId] && initialSessions.some((session) => session.id === current.activeSessionIds[workspaceId])
          ? current.activeSessionIds[workspaceId]
          : initialSessions[0].id,
      },
      sendingByWorkspace: {
        ...current.sendingByWorkspace,
        [workspaceId]: current.sendingByWorkspace[workspaceId] ?? false,
      },
      statusByWorkspace: {
        ...current.statusByWorkspace,
        [workspaceId]: current.statusByWorkspace[workspaceId] ?? "Ready",
      },
      loadedWorkspaces: {
        ...current.loadedWorkspaces,
        [workspaceId]: true,
      },
    }));
  },
  setActiveSessionId: (workspaceId, sessionId) => {
    set((state) => ({
      activeSessionIds: {
        ...state.activeSessionIds,
        [workspaceId]: sessionId,
      },
    }));
  },
  createSession: (workspaceId, mode) => {
    const next = createEmptySession(mode);
    set((state) => ({
      ...updateSessionsForWorkspace(state, workspaceId, (sessions) => [next, ...sessions]),
      activeSessionIds: {
        ...state.activeSessionIds,
        [workspaceId]: next.id,
      },
      statusByWorkspace: {
        ...state.statusByWorkspace,
        [workspaceId]: "Ready",
      },
    }));
  },
  deleteSession: (workspaceId, sessionId) => {
    const sending = Boolean(get().sendingByWorkspace[workspaceId]);
    const activeSessionId = get().activeSessionIds[workspaceId] || "";
    if (sending && activeSessionId === sessionId) {
      get().stopGeneration(workspaceId);
    }
    const currentSessions = get().sessionsByWorkspace[workspaceId] ?? [];
    const nextSessions = currentSessions.filter((session) => session.id !== sessionId);
    if (nextSessions.length === 0) {
      const fallback = createEmptySession();
      persistWorkspaceSessions(workspaceId, [fallback]);
      set((state) => ({
        sessionsByWorkspace: {
          ...state.sessionsByWorkspace,
          [workspaceId]: [fallback],
        },
        activeSessionIds: {
          ...state.activeSessionIds,
          [workspaceId]: fallback.id,
        },
      }));
      return;
    }
    persistWorkspaceSessions(workspaceId, sortSessions(nextSessions));
    set((state) => ({
      sessionsByWorkspace: {
        ...state.sessionsByWorkspace,
        [workspaceId]: sortSessions(nextSessions),
      },
      activeSessionIds: {
        ...state.activeSessionIds,
        [workspaceId]: activeSessionId === sessionId ? nextSessions[0].id : activeSessionId,
      },
    }));
  },
  renameSession: (workspaceId, sessionId, title) => {
    const nextTitle = title.trim();
    set((state) => updateSessionsForWorkspace(state, workspaceId, (sessions) => sessions.map((session) => (
      session.id === sessionId
        ? { ...session, title: nextTitle || session.title, updatedAt: new Date().toISOString() }
        : session
    ))));
  },
  changeMode: (workspaceId, mode) => {
    const activeSession = findActiveSession(get(), workspaceId);
    if (!activeSession || activeSession.locked || get().sendingByWorkspace[workspaceId]) {
      return;
    }
    set((state) => updateSessionsForWorkspace(state, workspaceId, (sessions) => sessions.map((session) => (
      session.id === activeSession.id
        ? { ...session, mode, updatedAt: new Date().toISOString() }
        : session
    ))));
  },
  toggleSource: (workspaceId, docId) => {
    if (get().sendingByWorkspace[workspaceId]) {
      return;
    }
    const activeSession = findActiveSession(get(), workspaceId);
    if (!activeSession) {
      return;
    }
    set((state) => updateSessionsForWorkspace(state, workspaceId, (sessions) => sessions.map((session) => {
      if (session.id !== activeSession.id) return session;
      if (session.injectedDocIds.includes(docId)) {
        return session;
      }
      const exists = session.selectedDocIds.includes(docId);
      return {
        ...session,
        selectedDocIds: exists
          ? session.selectedDocIds.filter((item) => item !== docId)
          : [...session.selectedDocIds, docId],
        updatedAt: new Date().toISOString(),
      };
    })));
  },
  addSource: (workspaceId, docId) => {
    if (get().sendingByWorkspace[workspaceId]) {
      return;
    }
    const activeSession = findActiveSession(get(), workspaceId);
    if (!activeSession) {
      return;
    }
    set((state) => updateSessionsForWorkspace(state, workspaceId, (sessions) => sessions.map((session) => (
      session.id === activeSession.id
        ? {
            ...session,
            selectedDocIds:
              session.injectedDocIds.includes(docId) || session.selectedDocIds.includes(docId)
                ? session.selectedDocIds
                : [...session.selectedDocIds, docId],
            updatedAt: new Date().toISOString(),
          }
        : session
    ))));
  },
  stopGeneration: (workspaceId) => {
    controllers.get(workspaceId)?.abort();
    controllers.delete(workspaceId);
    set((state) => ({
      sendingByWorkspace: {
        ...state.sendingByWorkspace,
        [workspaceId]: false,
      },
      statusByWorkspace: {
        ...state.statusByWorkspace,
        [workspaceId]: "Stopped",
      },
    }));
  },
  submitQuestion: async ({ workspaceId, question, selectedModelEntry, indexedFiles }) => {
    get().ensureWorkspace(workspaceId);
    const trimmedQuestion = question.trim();
    const state = get();
    const activeSession = findActiveSession(state, workspaceId);
    const currentSessionId = activeSession?.id || "";
    const currentMode = activeSession?.mode ?? "deep";
    const injectedDocIds = activeSession?.injectedDocIds ?? [];
    const selectedDocIds = activeSession?.selectedDocIds ?? [];
    const currentDocIds = [...new Set([...injectedDocIds, ...selectedDocIds])];
    const nextSourceMap = currentMode === "deep"
      ? extendSourceMap(activeSession?.sourceMap ?? {}, selectedDocIds, "P")
      : (activeSession?.sourceMap ?? {});
    const currentSources = buildSourceSnapshot(selectedDocIds, indexedFiles, nextSourceMap);
    const historyMessages = buildHistoryPayload(activeSession?.messages ?? []);
    if (!trimmedQuestion || state.sendingByWorkspace[workspaceId] || !currentSessionId) return;
    if (!selectedModelEntry?.provider) {
      set((current) => ({
        ...updateSessionsForWorkspace(current, workspaceId, (sessions) => sessions.map((session) => (
          session.id === currentSessionId
            ? {
                ...session,
                updatedAt: new Date().toISOString(),
                messages: [...session.messages, createMessage("system", "没有可用模型，请先在配置页完成 Provider 设置。")],
              }
            : session
        ))),
        statusByWorkspace: {
          ...current.statusByWorkspace,
          [workspaceId]: "No model",
        },
      }));
      return;
    }
    if (currentMode === "deep" && currentDocIds.length === 0) {
      set((current) => ({
        ...updateSessionsForWorkspace(current, workspaceId, (sessions) => sessions.map((session) => (
          session.id === currentSessionId
            ? {
                ...session,
                updatedAt: new Date().toISOString(),
                messages: [...session.messages, createMessage("system", "精读模式需要先选择至少一篇文献。")],
              }
            : session
        ))),
        statusByWorkspace: {
          ...current.statusByWorkspace,
          [workspaceId]: "Select source",
        },
      }));
      return;
    }

    controllers.get(workspaceId)?.abort();
    const controller = new AbortController();
    controllers.set(workspaceId, controller);

    set((current) => ({
      ...updateSessionsForWorkspace(current, workspaceId, (sessions) => sessions.map((session) => (
        session.id === currentSessionId
          ? {
              ...session,
              title: session.messages.length === 0 ? buildSessionTitle(trimmedQuestion) : session.title,
              locked: true,
              updatedAt: new Date().toISOString(),
              lastQuestion: trimmedQuestion,
              messages: [...session.messages, createMessage("user", trimmedQuestion, currentSources)],
            }
          : session
      ))),
      sendingByWorkspace: {
        ...current.sendingByWorkspace,
        [workspaceId]: true,
      },
      statusByWorkspace: {
        ...current.statusByWorkspace,
        [workspaceId]: modeLabel(currentMode),
      },
    }));

    try {
      const payload = {
        question: trimmedQuestion,
        provider: selectedModelEntry.provider,
        model: selectedModelEntry.model || null,
        workspace_id: workspaceId,
        mode: currentMode,
        doc_ids: currentDocIds,
        messages: historyMessages,
        source_map: nextSourceMap,
        session_id: currentSessionId,
      };
      const assistantMessageId = createMessageId();
      let streamStarted = false;
      try {
        await streamChatWithSignal(
          payload,
          (event) => {
            if (event.type === "meta") {
              streamStarted = true;
              const message: ChatMessage = {
                id: assistantMessageId,
                role: "assistant",
                content: "",
                sources: event.sources,
                contextStats: event.context_stats,
                createdAt: new Date().toISOString(),
              };
              set((current) => updateSessionsForWorkspace(current, workspaceId, (sessions) => sessions.map((session) => {
                if (session.id !== currentSessionId) return session;
                if (session.messages.some((item) => item.id === assistantMessageId)) return session;
                return {
                  ...session,
                  injectedDocIds: [...new Set([...session.injectedDocIds, ...selectedDocIds])],
                  selectedDocIds: session.id === currentSessionId ? [] : session.selectedDocIds,
                  sourceMap: shouldPersistSourceMap(currentMode) ? mergeSourceMap(nextSourceMap, event.sources) : session.sourceMap,
                  updatedAt: new Date().toISOString(),
                  messages: [...session.messages, message],
                };
              })));
              return;
            }
            if (event.type === "delta") {
              streamStarted = true;
              set((current) => updateSessionsForWorkspace(current, workspaceId, (sessions) => sessions.map((session) => {
                if (session.id !== currentSessionId) return session;
                return {
                  ...session,
                  updatedAt: new Date().toISOString(),
                  messages: session.messages.map((message) => (
                    message.id === assistantMessageId
                      ? { ...message, content: `${message.content}${event.text}` }
                      : message
                  )),
                };
              })));
              return;
            }
            if (event.type === "done" && event.finish_reason === "length") {
              set((current) => ({
                ...updateSessionsForWorkspace(current, workspaceId, (sessions) => sessions.map((session) => (
                  session.id === currentSessionId
                    ? {
                        ...session,
                        updatedAt: new Date().toISOString(),
                        messages: [...session.messages, createMessage("system", "本轮回答达到模型输出上限，内容可能被截断。")],
                      }
                    : session
                ))),
                statusByWorkspace: {
                  ...current.statusByWorkspace,
                  [workspaceId]: "Output limit",
                },
              }));
            }
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        set((current) => ({
          statusByWorkspace: {
            ...current.statusByWorkspace,
            [workspaceId]: "Ready",
          },
        }));
        return;
      } catch (streamError) {
        if (controller.signal.aborted) return;
        if (streamStarted) {
          throw streamError;
        }
      }

      const response = await askChatWithSignal(payload, controller.signal);
      if (controller.signal.aborted) return;
      set((current) => ({
        ...updateSessionsForWorkspace(current, workspaceId, (sessions) => sessions.map((session) => (
          session.id === currentSessionId
            ? {
                ...session,
                injectedDocIds: [...new Set([...session.injectedDocIds, ...selectedDocIds])],
                selectedDocIds: [],
                sourceMap: shouldPersistSourceMap(currentMode) ? mergeSourceMap(nextSourceMap, response.sources) : session.sourceMap,
                updatedAt: new Date().toISOString(),
                messages: [
                  ...session.messages,
                  createMessage("assistant", response.answer, response.sources, response.context_stats),
                ],
              }
            : session
        ))),
        statusByWorkspace: {
          ...current.statusByWorkspace,
          [workspaceId]: "Ready",
        },
      }));
    } catch (error) {
      if (controller.signal.aborted) return;
      set((current) => ({
        ...updateSessionsForWorkspace(current, workspaceId, (sessions) => sessions.map((session) => (
          session.id === currentSessionId
            ? {
                ...session,
                updatedAt: new Date().toISOString(),
                messages: [...session.messages, createMessage("system", error instanceof Error ? error.message : "Chat 请求失败")],
              }
            : session
        ))),
        statusByWorkspace: {
          ...current.statusByWorkspace,
          [workspaceId]: "Error",
        },
      }));
    } finally {
      if (controllers.get(workspaceId) === controller) {
        controllers.delete(workspaceId);
        set((current) => ({
          sendingByWorkspace: {
            ...current.sendingByWorkspace,
            [workspaceId]: false,
          },
        }));
      }
    }
  },
}));
