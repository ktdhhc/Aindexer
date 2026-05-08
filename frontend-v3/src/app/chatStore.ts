import { create } from "zustand";

import {
  askChatWithSignal,
  cancelChatRun,
  type AgentTraceStep,
  type ChatThinkingBlock,
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
  thinkingBlocks?: ChatThinkingBlock[];
  activeThinkingId?: string | null;
  createdAt: string;
  sources?: ChatSource[];
  contextStats?: ChatContextStats;
  agentTrace?: AgentTraceStep[];
}

export interface ChatSession {
  id: string;
  title: string;
  mode: ChatMode;
  locked: boolean;
  injectedDocIds: string[];
  selectedDocIds: string[];
  createdAt: string;
  updatedAt: string;
  lastQuestion: string;
  agentTrace: AgentTraceStep[];
  messages: ChatMessage[];
}

type ChatSessionStore = Record<string, ChatSession[]>;

interface SubmitChatQuestionArgs {
  workspaceId: string;
  question: string;
  selectedModelEntry: ProviderModelEntry | null;
  indexedFiles: FileItem[];
  retryFromMessageId?: string;
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
const runIds = new Map<string, string>();

function createMessageId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createSessionId(): string {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createRunId(): string {
  return `chat_run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createMessage(
  role: ChatMessage["role"],
  content: string,
  sources?: ChatSource[],
  contextStats?: ChatContextStats,
  agentTrace?: AgentTraceStep[],
): ChatMessage {
  return {
    id: createMessageId(),
    role,
    content,
    sources,
    contextStats,
    agentTrace,
    createdAt: new Date().toISOString(),
  };
}

function createAssistantPlaceholder(id: string): ChatMessage {
  return {
    id,
    role: "assistant",
    content: "",
    thinkingBlocks: [],
    activeThinkingId: null,
    sources: [],
    agentTrace: [],
    createdAt: new Date().toISOString(),
  };
}

function upsertThinkingBlock(
  blocks: ChatThinkingBlock[] | undefined,
  thinkingId: string,
  label: string,
): ChatThinkingBlock[] {
  const next = [...(blocks ?? [])];
  const index = next.findIndex((block) => block.id === thinkingId);
  if (index >= 0) {
    next[index] = { ...next[index], label };
    return next;
  }
  next.push({ id: thinkingId, label, content: "", completed: false })
  return next;
}

function appendThinkingBlockText(
  blocks: ChatThinkingBlock[] | undefined,
  thinkingId: string,
  text: string,
): ChatThinkingBlock[] {
  return [...(blocks ?? [])].map((block) => (
    block.id === thinkingId
      ? { ...block, content: `${block.content}${text}` }
      : block
  ));
}

function completeThinkingBlock(
  blocks: ChatThinkingBlock[] | undefined,
  thinkingId: string,
): ChatThinkingBlock[] {
  return [...(blocks ?? [])].map((block) => (
    block.id === thinkingId
      ? { ...block, completed: true }
      : block
  ));
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
    createdAt: now,
    updatedAt: now,
    lastQuestion: "",
    agentTrace: [],
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

function normalizeSession(raw: ChatSession): ChatSession {
  const mode = raw.mode && ["wide", "deep", "agent"].includes(raw.mode) ? raw.mode : "deep";
  const messages = Array.isArray(raw.messages)
    ? raw.messages.map((message) => ({
        ...message,
        sources: (message.sources ?? []).map((source) => ({
          ...source,
          source_id: normalizeSourceId(source.source_id) || source.source_id,
        })),
        agentTrace: Array.isArray(message.agentTrace) ? message.agentTrace : [],
        thinkingBlocks: Array.isArray(message.thinkingBlocks) ? message.thinkingBlocks : [],
        activeThinkingId: message.activeThinkingId ?? null,
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
    agentTrace: Array.isArray((raw as ChatSession & { agentTrace?: AgentTraceStep[] }).agentTrace)
      ? (raw as ChatSession & { agentTrace?: AgentTraceStep[] }).agentTrace ?? []
      : [],
    messages,
  };
}

function modeLabel(mode: ChatMode): string {
  return mode === "wide" ? "全景" : mode === "agent" ? "探索" : "精读";
}

function buildSessionTitle(question: string): string {
  const normalized = question.replace(/\s+/g, " ").trim();
  if (!normalized) return "新会话";
  return normalized.length > 24 ? `${normalized.slice(0, 24)}...` : normalized;
}

function buildSourceSnapshot(docIds: string[], files: FileItem[]): ChatSource[] {
  const map = new Map(files.map((item) => [item.id, item]));
  return docIds.map((docId) => {
    const item = map.get(docId);
    return {
      source_id: "",
      doc_id: docId,
      display_name: item?.display_name || item?.filename || docId,
      source_kind: "paper",
    };
  });
}

function upsertAgentTraceStep(steps: AgentTraceStep[], nextStep: AgentTraceStep): AgentTraceStep[] {
  const next = [...steps];
  const nextKey = `${nextStep.step}:${nextStep.iteration ?? ""}`;
  const index = next.findIndex((step) => `${step.step}:${step.iteration ?? ""}` === nextKey);
  if (index >= 0) {
    next[index] = { ...next[index], ...nextStep };
    return next;
  }
  next.push(nextStep);
  return next;
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
    const runId = runIds.get(workspaceId) || "";
    if (runId) {
      void cancelChatRun(runId);
      runIds.delete(workspaceId);
    }
    controllers.get(workspaceId)?.abort();
    controllers.delete(workspaceId);
    set((state) => ({
      ...updateSessionsForWorkspace(state, workspaceId, (sessions) => sessions.map((session) => {
        const isActive = session.id === (state.activeSessionIds[workspaceId] || "");
        if (!isActive) return session;
        const stoppedStep: AgentTraceStep = { step: "stopped", label: "停止", detail: "已停止", status: "done" };
        const nextMessages = session.messages.filter((message, index) => {
          const isLast = index === session.messages.length - 1;
          if (!isLast || message.role !== "assistant") return true;
          return Boolean(message.content.trim()) || (message.agentTrace?.length ?? 0) > 0 || (message.thinkingBlocks?.length ?? 0) > 0;
        });
        return {
          ...session,
          agentTrace: session.mode === "agent" ? upsertAgentTraceStep(session.agentTrace, stoppedStep) : session.agentTrace,
          messages: nextMessages.map((message, index) => (
            session.mode === "agent" && index === nextMessages.length - 1 && message.role === "assistant"
              ? { ...message, agentTrace: upsertAgentTraceStep(message.agentTrace ?? [], stoppedStep) }
              : message
          )),
        };
      })),
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
  submitQuestion: async ({ workspaceId, question, selectedModelEntry, indexedFiles, retryFromMessageId }) => {
    get().ensureWorkspace(workspaceId);
    const trimmedQuestion = question.trim();
    const state = get();
    const activeSession = findActiveSession(state, workspaceId);
    const currentSessionId = activeSession?.id || "";
    const currentMode = activeSession?.mode ?? "deep";
    const sessionMessages = activeSession?.messages ?? [];
    const retryIndex = retryFromMessageId
      ? sessionMessages.findIndex((message) => message.id === retryFromMessageId && message.role === "user")
      : -1;
    const retryMessage = retryIndex >= 0 ? sessionMessages[retryIndex] : null;
    const baseMessages = retryIndex >= 0 ? sessionMessages.slice(0, retryIndex) : sessionMessages;
    const injectedDocIds = activeSession?.injectedDocIds ?? [];
    const selectedDocIds = activeSession?.selectedDocIds ?? [];
    const retryInjectedDocIds = baseMessages
      .flatMap((message) => message.sources ?? [])
      .map((source) => source.doc_id)
      .filter((docId, index, list) => Boolean(docId) && list.indexOf(docId) === index);
    const retrySelectedDocIds = (retryMessage?.sources ?? [])
      .map((source) => source.doc_id)
      .filter((docId, index, list) => Boolean(docId) && list.indexOf(docId) === index);
    const requestInjectedDocIds = retryIndex >= 0 ? retryInjectedDocIds : injectedDocIds;
    const requestSelectedDocIds = retrySelectedDocIds.length > 0 ? retrySelectedDocIds : selectedDocIds;
    const currentDocIds = [...new Set([...requestInjectedDocIds, ...requestSelectedDocIds])];
    const currentSources = buildSourceSnapshot(requestSelectedDocIds, indexedFiles);
    const historyMessages = buildHistoryPayload(baseMessages);
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
    const runId = createRunId();
    const assistantMessageId = createMessageId();
    controllers.set(workspaceId, controller);
    runIds.set(workspaceId, runId);

    set((current) => ({
      ...updateSessionsForWorkspace(current, workspaceId, (sessions) => sessions.map((session) => (
        session.id === currentSessionId
          ? {
              ...session,
              title: baseMessages.length === 0 ? buildSessionTitle(trimmedQuestion) : session.title,
              locked: true,
              injectedDocIds: requestInjectedDocIds,
              updatedAt: new Date().toISOString(),
              lastQuestion: trimmedQuestion,
              agentTrace: currentMode === "agent" ? [] : session.agentTrace,
              messages: [
                ...baseMessages,
                createMessage("user", trimmedQuestion, currentSources),
                createAssistantPlaceholder(assistantMessageId),
              ],
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
        session_id: currentSessionId,
        run_id: runId,
      };
      let streamStarted = false;
      try {
        await streamChatWithSignal(
          payload,
          (event) => {
            if (event.type === "agent_run") {
              streamStarted = true;
              runIds.set(workspaceId, event.run_id);
              return;
            }
            if (event.type === "agent_step") {
              streamStarted = true;
              set((current) => ({
                ...updateSessionsForWorkspace(current, workspaceId, (sessions) => sessions.map((session) => (
                  session.id === currentSessionId
                    ? {
                        ...session,
                        updatedAt: new Date().toISOString(),
                        agentTrace: upsertAgentTraceStep(session.agentTrace, event.step),
                        messages: session.messages.some((message) => message.id === assistantMessageId)
                          ? session.messages.map((message) => (
                              message.id === assistantMessageId
                                ? {
                                    ...message,
                                    agentTrace: upsertAgentTraceStep(message.agentTrace ?? [], event.step),
                                  }
                                : message
                            ))
                          : [
                              ...session.messages,
                              {
                                id: assistantMessageId,
                                role: "assistant",
                                content: "",
                                sources: [],
                                agentTrace: [event.step],
                                createdAt: new Date().toISOString(),
                              },
                            ],
                      }
                    : session
                ))),
                statusByWorkspace: {
                  ...current.statusByWorkspace,
                  [workspaceId]: event.step.label,
                },
              }));
              return;
            }
            if (event.type === "meta") {
              streamStarted = true;
              const message: ChatMessage = {
                id: assistantMessageId,
                role: "assistant",
                content: "",
                thinkingBlocks: [],
                activeThinkingId: null,
                sources: event.sources,
                contextStats: event.context_stats,
                agentTrace: (event.context_stats.agent_trace as AgentTraceStep[] | undefined) ?? [],
                createdAt: new Date().toISOString(),
              };
              set((current) => updateSessionsForWorkspace(current, workspaceId, (sessions) => sessions.map((session) => {
                if (session.id !== currentSessionId) return session;
                const hasAssistantMessage = session.messages.some((item) => item.id === assistantMessageId);
                return {
                  ...session,
                  injectedDocIds: [...new Set([...session.injectedDocIds, ...requestSelectedDocIds])],
                  selectedDocIds: session.id === currentSessionId ? [] : session.selectedDocIds,
                  agentTrace: currentMode === "agent"
                    ? ((event.context_stats.agent_trace as AgentTraceStep[] | undefined) ?? session.agentTrace)
                    : session.agentTrace,
                  updatedAt: new Date().toISOString(),
                  messages: hasAssistantMessage
                    ? session.messages.map((item) => (
                        item.id === assistantMessageId
                          ? {
                              ...item,
                              sources: event.sources,
                              contextStats: event.context_stats,
                              agentTrace: (event.context_stats.agent_trace as AgentTraceStep[] | undefined) ?? item.agentTrace,
                            }
                          : item
                      ))
                    : [...session.messages, message],
                };
                })));
              set((current) => ({
                statusByWorkspace: {
                  ...current.statusByWorkspace,
                  [workspaceId]: "回答中",
                },
              }));
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
                      ? {
                          ...message,
                          activeThinkingId: message.activeThinkingId,
                          content: `${message.content}${event.text}`,
                        }
                      : message
                  )),
                };
              })));
              return;
            }
            if (event.type === "thinking_start") {
              streamStarted = true;
              set((current) => updateSessionsForWorkspace(current, workspaceId, (sessions) => sessions.map((session) => {
                if (session.id !== currentSessionId) return session;
                return {
                  ...session,
                  updatedAt: new Date().toISOString(),
                  messages: session.messages.map((message) => (
                    message.id === assistantMessageId
                      ? {
                          ...message,
                          activeThinkingId: event.thinking_id,
                          thinkingBlocks: upsertThinkingBlock(message.thinkingBlocks, event.thinking_id, event.label),
                        }
                      : message
                  )),
                };
              })));
              return;
            }
            if (event.type === "thinking_delta") {
              streamStarted = true;
              set((current) => updateSessionsForWorkspace(current, workspaceId, (sessions) => sessions.map((session) => {
                if (session.id !== currentSessionId) return session;
                return {
                  ...session,
                  updatedAt: new Date().toISOString(),
                  messages: session.messages.map((message) => (
                    message.id === assistantMessageId
                      ? {
                          ...message,
                          thinkingBlocks: appendThinkingBlockText(
                            message.thinkingBlocks,
                            event.thinking_id,
                            event.text,
                          ),
                        }
                      : message
                  )),
                };
              })));
              return;
            }
            if (event.type === "thinking_end") {
              streamStarted = true;
              set((current) => updateSessionsForWorkspace(current, workspaceId, (sessions) => sessions.map((session) => {
                if (session.id !== currentSessionId) return session;
                return {
                  ...session,
                  updatedAt: new Date().toISOString(),
                  messages: session.messages.map((message) => (
                    message.id === assistantMessageId
                      ? {
                          ...message,
                          activeThinkingId: message.activeThinkingId === event.thinking_id ? null : message.activeThinkingId,
                          thinkingBlocks: completeThinkingBlock(message.thinkingBlocks, event.thinking_id),
                        }
                      : message
                  )),
                };
              })));
              return;
            }
            if (event.type === "done") {
              set((current) => ({
                ...updateSessionsForWorkspace(current, workspaceId, (sessions) => sessions.map((session) => (
                  session.id === currentSessionId
                    ? {
                        ...session,
                        updatedAt: new Date().toISOString(),
                        messages: session.messages,
                      }
                    : session
                ))),
                statusByWorkspace: {
                  ...current.statusByWorkspace,
                  [workspaceId]: event.finish_reason === "length" ? "Output limit" : current.statusByWorkspace[workspaceId],
                },
              }));
              if (event.finish_reason === "length") {
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
                }));
              }
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
                injectedDocIds: [...new Set([...session.injectedDocIds, ...requestSelectedDocIds])],
                selectedDocIds: [],

                agentTrace: currentMode === "agent"
                  ? ((response.context_stats.agent_trace as AgentTraceStep[] | undefined) ?? session.agentTrace)
                  : session.agentTrace,
                updatedAt: new Date().toISOString(),
                messages: session.messages.map((message) => (
                  message.id === assistantMessageId
                    ? {
                        ...message,
                        content: response.answer,
                        sources: response.sources,
                        contextStats: response.context_stats,
                        agentTrace: (response.context_stats.agent_trace as AgentTraceStep[] | undefined) ?? message.agentTrace,
                      }
                    : message
                )),
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
                messages: [
                  ...session.messages.filter((message) => (
                    message.id !== assistantMessageId || Boolean(message.content.trim()) || (message.agentTrace?.length ?? 0) > 0 || (message.thinkingBlocks?.length ?? 0) > 0
                  )),
                  createMessage("system", error instanceof Error ? error.message : "Chat 请求失败"),
                ],
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
        if (runIds.get(workspaceId) === runId) {
          runIds.delete(workspaceId);
        }
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
