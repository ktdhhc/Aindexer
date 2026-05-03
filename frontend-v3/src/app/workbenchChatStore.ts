import { create } from "zustand";

import {
  askChatWithSignal,
  cancelChatRun,
  normalizeSourceId,
  resolveAssistantCitedSources,
  streamChatWithSignal,
  stripAssistantCitationFooter,
  type AgentTraceStep,
  type ChatContextStats,
  type ChatHistoryMessage,
  type ChatSource,
} from "../shared/api/chat";
import type { ProviderModelEntry } from "../shared/lib/providerModels";

export interface WorkbenchChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  sources?: ChatSource[];
  contextStats?: ChatContextStats;
  agentTrace?: AgentTraceStep[];
}

interface WorkbenchChatSession {
  key: string;
  workspaceId: string;
  docId: string;
  messages: WorkbenchChatMessage[];
  sourceMap: Record<string, string>;
  updatedAt: string;
}

interface SubmitWorkbenchQuestionArgs {
  workspaceId: string;
  docId: string;
  question: string;
  selectedModelEntry: ProviderModelEntry | null;
}

interface WorkbenchChatState {
  sessions: Record<string, WorkbenchChatSession>;
  sendingBySession: Record<string, boolean>;
  statusBySession: Record<string, string>;
  loadedSessions: Record<string, boolean>;
  ensureSession: (workspaceId: string, docId: string) => void;
  submitQuestion: (args: SubmitWorkbenchQuestionArgs) => Promise<void>;
  stopGeneration: (workspaceId: string, docId: string) => void;
  resetSession: (workspaceId: string, docId: string) => void;
}

const STORAGE_KEY = "aindexer_v35_workbench_chat";
const controllers = new Map<string, AbortController>();
const runIds = new Map<string, string>();

function createMessageId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createRunId(): string {
  return `wb_chat_run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function sessionKey(workspaceId: string, docId: string): string {
  return `${workspaceId}:${docId}`;
}

function createMessage(
  role: WorkbenchChatMessage["role"],
  content: string,
  sources?: ChatSource[],
  contextStats?: ChatContextStats,
  agentTrace?: AgentTraceStep[],
): WorkbenchChatMessage {
  return {
    id: createMessageId(),
    role,
    content,
    createdAt: new Date().toISOString(),
    sources,
    contextStats,
    agentTrace,
  };
}

function createAssistantPlaceholder(id: string): WorkbenchChatMessage {
  return {
    id,
    role: "assistant",
    content: "",
    createdAt: new Date().toISOString(),
    sources: [],
    agentTrace: [],
  };
}

function createEmptySession(workspaceId: string, docId: string): WorkbenchChatSession {
  return {
    key: sessionKey(workspaceId, docId),
    workspaceId,
    docId,
    messages: [],
    sourceMap: {},
    updatedAt: new Date().toISOString(),
  };
}

function sourceMapKey(docId: string, sourceKind: ChatSource["source_kind"]): string {
  const kind = sourceKind === "paper" ? "paper" : sourceKind === "index" ? "index" : "";
  return kind ? `${kind}:${docId}` : docId;
}

function mergeSourceMap(sourceMap: Record<string, string>, sources?: ChatSource[]): Record<string, string> {
  const next = { ...sourceMap };
  for (const source of sources ?? []) {
    const sourceId = normalizeSourceId(source.source_id);
    if (!source.doc_id || !sourceId) continue;
    next[sourceMapKey(source.doc_id, source.source_kind)] = sourceId;
  }
  return next;
}

function buildHistoryPayload(messages: WorkbenchChatMessage[]): ChatHistoryMessage[] {
  return messages
    .filter((message): message is WorkbenchChatMessage & { role: "user" | "assistant" } => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role,
      content: message.role === "assistant" ? stripAssistantCitationFooter(message.content) : message.content,
      sources: message.role === "assistant" ? resolveAssistantCitedSources(message.content, message.sources) : message.sources,
    }));
}

function readStore(): Record<string, WorkbenchChatSession> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, WorkbenchChatSession>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, WorkbenchChatSession>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore storage failures
  }
}

function persistSession(session: WorkbenchChatSession): void {
  const store = readStore();
  store[session.key] = session;
  writeStore(store);
}

function removeSession(sessionKeyValue: string): void {
  const store = readStore();
  delete store[sessionKeyValue];
  writeStore(store);
}

function normalizeSession(raw: WorkbenchChatSession, workspaceId: string, docId: string): WorkbenchChatSession {
  const messages = Array.isArray(raw.messages)
    ? raw.messages.map((message) => ({
        ...message,
        sources: (message.sources ?? []).map((source) => ({
          ...source,
          source_id: normalizeSourceId(source.source_id) || source.source_id,
        })),
        agentTrace: Array.isArray(message.agentTrace) ? message.agentTrace : [],
      }))
    : [];
  return {
    key: sessionKey(workspaceId, docId),
    workspaceId,
    docId,
    messages,
    sourceMap: typeof raw.sourceMap === "object" && raw.sourceMap ? raw.sourceMap : {},
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

function upsertSessionRecord(
  state: WorkbenchChatState,
  workspaceId: string,
  docId: string,
  updater: (session: WorkbenchChatSession) => WorkbenchChatSession,
): Pick<WorkbenchChatState, "sessions"> {
  const key = sessionKey(workspaceId, docId);
  const current = state.sessions[key] ?? createEmptySession(workspaceId, docId);
  const next = updater(current);
  persistSession(next);
  return {
    sessions: {
      ...state.sessions,
      [key]: next,
    },
  };
}

function sessionSnapshot(state: WorkbenchChatState, workspaceId: string, docId: string): WorkbenchChatSession {
  const key = sessionKey(workspaceId, docId);
  return state.sessions[key] ?? createEmptySession(workspaceId, docId);
}

export const useWorkbenchChatStore = create<WorkbenchChatState>((set, get) => ({
  sessions: {},
  sendingBySession: {},
  statusBySession: {},
  loadedSessions: {},
  ensureSession: (workspaceId, docId) => {
    if (!workspaceId || !docId) return;
    const key = sessionKey(workspaceId, docId);
    if (get().loadedSessions[key]) return;
    const store = readStore();
    const restored = store[key] ? normalizeSession(store[key], workspaceId, docId) : createEmptySession(workspaceId, docId);
    if (!store[key]) {
      persistSession(restored);
    }
    set((state) => ({
      sessions: {
        ...state.sessions,
        [key]: restored,
      },
      sendingBySession: {
        ...state.sendingBySession,
        [key]: state.sendingBySession[key] ?? false,
      },
      statusBySession: {
        ...state.statusBySession,
        [key]: state.statusBySession[key] ?? "Ready",
      },
      loadedSessions: {
        ...state.loadedSessions,
        [key]: true,
      },
    }));
  },
  stopGeneration: (workspaceId, docId) => {
    const key = sessionKey(workspaceId, docId);
    const runId = runIds.get(key) || "";
    if (runId) {
      void cancelChatRun(runId);
      runIds.delete(key);
    }
    controllers.get(key)?.abort();
    controllers.delete(key);
    set((state) => ({
      ...upsertSessionRecord(state, workspaceId, docId, (session) => ({
        ...session,
        updatedAt: new Date().toISOString(),
        messages: session.messages.filter((message, index) => {
          const isLast = index === session.messages.length - 1;
          if (!isLast || message.role !== "assistant") return true;
          return Boolean(message.content.trim()) || (message.agentTrace?.length ?? 0) > 0;
        }),
      })),
      sendingBySession: {
        ...state.sendingBySession,
        [key]: false,
      },
      statusBySession: {
        ...state.statusBySession,
        [key]: "Stopped",
      },
    }));
  },
  resetSession: (workspaceId, docId) => {
    if (!workspaceId || !docId) return;
    const key = sessionKey(workspaceId, docId);
    if (get().sendingBySession[key]) {
      get().stopGeneration(workspaceId, docId);
    }
    controllers.delete(key);
    runIds.delete(key);
    removeSession(key);
    const nextSession = createEmptySession(workspaceId, docId);
    persistSession(nextSession);
    set((state) => ({
      sessions: {
        ...state.sessions,
        [key]: nextSession,
      },
      sendingBySession: {
        ...state.sendingBySession,
        [key]: false,
      },
      statusBySession: {
        ...state.statusBySession,
        [key]: "Ready",
      },
      loadedSessions: {
        ...state.loadedSessions,
        [key]: true,
      },
    }));
  },
  submitQuestion: async ({ workspaceId, docId, question, selectedModelEntry }) => {
    if (!workspaceId || !docId) return;
    get().ensureSession(workspaceId, docId);
    const key = sessionKey(workspaceId, docId);
    const trimmedQuestion = question.trim();
    const state = get();
    const session = sessionSnapshot(state, workspaceId, docId);
    if (!trimmedQuestion || state.sendingBySession[key]) return;
    if (!selectedModelEntry?.provider) {
      set((current) => ({
        ...upsertSessionRecord(current, workspaceId, docId, (currentSession) => ({
          ...currentSession,
          updatedAt: new Date().toISOString(),
          messages: [...currentSession.messages, createMessage("system", "没有可用模型，请先完成 Provider 设置。")],
        })),
        statusBySession: {
          ...current.statusBySession,
          [key]: "No model",
        },
      }));
      return;
    }

    controllers.get(key)?.abort();
    const controller = new AbortController();
    const runId = createRunId();
    const assistantMessageId = createMessageId();
    const historyMessages = buildHistoryPayload(session.messages);

    controllers.set(key, controller);
    runIds.set(key, runId);
    set((current) => ({
      ...upsertSessionRecord(current, workspaceId, docId, (currentSession) => ({
        ...currentSession,
        updatedAt: new Date().toISOString(),
        messages: [
          ...currentSession.messages,
          createMessage("user", trimmedQuestion),
          createAssistantPlaceholder(assistantMessageId),
        ],
      })),
      sendingBySession: {
        ...current.sendingBySession,
        [key]: true,
      },
      statusBySession: {
        ...current.statusBySession,
        [key]: "Thinking",
      },
    }));

    try {
      const payload = {
        question: trimmedQuestion,
        provider: selectedModelEntry.provider,
        model: selectedModelEntry.model || null,
        workspace_id: workspaceId,
        mode: "deep" as const,
        doc_ids: [docId],
        include_index_context: true,
        messages: historyMessages,
        source_map: session.sourceMap,
        session_id: `workbench:${key}`,
        run_id: runId,
      };
      let streamStarted = false;
      try {
        await streamChatWithSignal(
          payload,
          (event) => {
            if (event.type === "meta") {
              streamStarted = true;
              set((current) => ({
                ...upsertSessionRecord(current, workspaceId, docId, (currentSession) => ({
                  ...currentSession,
                  sourceMap: mergeSourceMap(currentSession.sourceMap, event.sources),
                  updatedAt: new Date().toISOString(),
                  messages: currentSession.messages.map((message) => (
                    message.id === assistantMessageId
                      ? {
                          ...message,
                          sources: event.sources,
                          contextStats: event.context_stats,
                          agentTrace: (event.context_stats.agent_trace as AgentTraceStep[] | undefined) ?? message.agentTrace,
                        }
                      : message
                  )),
                })),
                statusBySession: {
                  ...current.statusBySession,
                  [key]: "Answering",
                },
              }));
              return;
            }
            if (event.type === "delta") {
              streamStarted = true;
              set((current) => upsertSessionRecord(current, workspaceId, docId, (currentSession) => ({
                ...currentSession,
                updatedAt: new Date().toISOString(),
                messages: currentSession.messages.map((message) => (
                  message.id === assistantMessageId
                    ? { ...message, content: `${message.content}${event.text}` }
                    : message
                )),
              })));
              return;
            }
            if (event.type === "done") {
              set((current) => ({
                statusBySession: {
                  ...current.statusBySession,
                  [key]: event.finish_reason === "length" ? "Output limit" : "Ready",
                },
              }));
              if (event.finish_reason === "length") {
                set((current) => upsertSessionRecord(current, workspaceId, docId, (currentSession) => ({
                  ...currentSession,
                  updatedAt: new Date().toISOString(),
                  messages: [...currentSession.messages, createMessage("system", "本轮回答达到模型输出上限，内容可能被截断。")],
                })));
              }
            }
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        set((current) => ({
          statusBySession: {
            ...current.statusBySession,
            [key]: "Ready",
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
        ...upsertSessionRecord(current, workspaceId, docId, (currentSession) => ({
          ...currentSession,
          sourceMap: mergeSourceMap(currentSession.sourceMap, response.sources),
          updatedAt: new Date().toISOString(),
          messages: currentSession.messages.map((message) => (
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
        })),
        statusBySession: {
          ...current.statusBySession,
          [key]: "Ready",
        },
      }));
    } catch (error) {
      if (controller.signal.aborted) return;
      set((current) => ({
        ...upsertSessionRecord(current, workspaceId, docId, (currentSession) => ({
          ...currentSession,
          updatedAt: new Date().toISOString(),
          messages: [
            ...currentSession.messages.filter((message) => (
              message.id !== assistantMessageId || Boolean(message.content.trim()) || (message.agentTrace?.length ?? 0) > 0
            )),
            createMessage("system", error instanceof Error ? error.message : "Chat 请求失败"),
          ],
        })),
        statusBySession: {
          ...current.statusBySession,
          [key]: "Error",
        },
      }));
    } finally {
      if (controllers.get(key) === controller) {
        controllers.delete(key);
        if (runIds.get(key) === runId) {
          runIds.delete(key);
        }
        set((current) => ({
          sendingBySession: {
            ...current.sendingBySession,
            [key]: false,
          },
        }));
      }
    }
  },
}));

export function getWorkbenchChatSessionKey(workspaceId: string, docId: string): string {
  return sessionKey(workspaceId, docId);
}
