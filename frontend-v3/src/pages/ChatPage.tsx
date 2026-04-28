import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { useWorkspaceStore } from "../app/workspaceStore";
import { askChatWithSignal, streamChatWithSignal, type ChatContextStats, type ChatMode, type ChatSource } from "../shared/api/chat";
import { listFiles, type FileItem } from "../shared/api/files";
import { listProviders } from "../shared/api/providers";
import { getModelDefault, parseModelDefaultKey } from "../shared/lib/modelDefaults";
import {
  buildAvailableProviderModelEntries,
  type ProviderModelEntry,
} from "../shared/lib/providerModels";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  sources?: ChatSource[];
  contextStats?: ChatContextStats;
}

interface ChatSession {
  id: string;
  title: string;
  mode: ChatMode;
  locked: boolean;
  injectedDocIds: string[];
  selectedDocIds: string[];
  createdAt: string;
  updatedAt: string;
  lastQuestion: string;
  messages: ChatMessage[];
}

type ChatSessionStore = Record<string, ChatSession[]>;

const STORAGE_KEY = "aindexer_v35_chat_sessions";
const QUICK_PROMPTS = [
  "这篇文献的核心贡献是什么？",
  "提取研究方法、数据来源和限制。",
  "写一段适合综述使用的中文摘要。",
  "列出后续阅读时应该核对的问题。",
];

const CHAT_MODES: Array<{ mode: ChatMode; label: string; icon: "scan" | "focus" | "path" }> = [
  { mode: "wide", label: "全景", icon: "scan" },
  { mode: "deep", label: "精读", icon: "focus" },
  { mode: "agent", label: "探索", icon: "path" },
];

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
    createdAt: now,
    updatedAt: now,
    lastQuestion: "",
    messages: [],
  };
}

function modeLabel(mode: ChatMode): string {
  return CHAT_MODES.find((item) => item.mode === mode)?.label ?? "精读";
}

function normalizeSession(raw: ChatSession): ChatSession {
  const mode = raw.mode && ["wide", "deep", "agent"].includes(raw.mode) ? raw.mode : "deep";
  const injectedDocIds = Array.isArray((raw as ChatSession & { injectedDocIds?: string[] }).injectedDocIds)
    ? (raw as ChatSession & { injectedDocIds?: string[] }).injectedDocIds ?? []
    : Array.isArray(raw.selectedDocIds)
      ? raw.selectedDocIds
      : [];
  return {
    ...raw,
    mode,
    locked: Boolean(raw.locked || raw.messages?.some((message) => message.role === "user" || message.role === "assistant")),
    injectedDocIds,
    selectedDocIds: Array.isArray((raw as ChatSession & { injectedDocIds?: string[] }).injectedDocIds)
      ? (Array.isArray(raw.selectedDocIds) ? raw.selectedDocIds : [])
      : [],
    messages: Array.isArray(raw.messages) ? raw.messages : [],
  };
}

function ModeIcon({ icon }: { icon: "scan" | "focus" | "path" }) {
  if (icon === "scan") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h10M4 17h16" /></svg>;
  }
  if (icon === "focus") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4H5a1 1 0 0 0-1 1v3M16 4h3a1 1 0 0 1 1 1v3M8 20H5a1 1 0 0 1-1-1v-3M16 20h3a1 1 0 0 0 1-1v-3M9 12h6" /></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 18c5 0 4-12 9-12 2.5 0 4 1.8 5 4M15 6h-3M15 6v3M19 18H9" /></svg>;
}

function formatCompression(stats?: ChatContextStats): string {
  if (!stats) return "";
  const level = String(stats.compression_level || "none");
  const tokens = Number(stats.estimated_input_tokens || 0);
  const docs = Number(stats.doc_count || 0);
  const levelLabel = level === "none" ? "原文" : level === "advisory" ? "建议压缩" : level === "auto" ? "已压缩" : "已兜底";
  return `${docs} sources · ${tokens || "-"} tokens · ${levelLabel}`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatSessionTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function parseModelKey(value: string): ProviderModelEntry | null {
  if (!value) return null;
  const [provider, ...modelParts] = value.split("::");
  const model = modelParts.join("::");
  return provider ? { provider, model } : null;
}

function buildSessionTitle(question: string): string {
  const normalized = question.replace(/\s+/g, " ").trim();
  if (!normalized) return "新会话";
  return normalized.length > 24 ? `${normalized.slice(0, 24)}...` : normalized;
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

export function ChatPage() {
  const workspaceId = useWorkspaceStore((state) => state.workspaceId);
  const [selectedModelKey, setSelectedModelKey] = useState("");
  const [question, setQuestion] = useState("");
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [loadedWorkspaceId, setLoadedWorkspaceId] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Ready");
  const [sourceSearch, setSourceSearch] = useState("");
  const [editingSessionId, setEditingSessionId] = useState("");
  const [editingSessionTitle, setEditingSessionTitle] = useState("");

  const threadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeControllerRef = useRef<AbortController | null>(null);

  const providersQuery = useQuery({
    queryKey: ["providers"],
    queryFn: listProviders,
  });

  const filesQuery = useQuery({
    queryKey: ["files", workspaceId],
    queryFn: () => listFiles(workspaceId),
  });

  const chatDefault = parseModelDefaultKey(getModelDefault("chat"));

  const modelOptions = useMemo<ProviderModelEntry[]>(() => {
    return buildAvailableProviderModelEntries(providersQuery.data ?? []);
  }, [providersQuery.data]);

  const selectedModelEntry = useMemo(() => parseModelKey(selectedModelKey), [selectedModelKey]);
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );
  const activeMessages = activeSession?.messages ?? [];
  const activeMode = activeSession?.mode ?? "deep";
  const injectedDocIds = activeSession?.injectedDocIds ?? [];
  const selectedDocIds = activeSession?.selectedDocIds ?? [];
  const currentContextDocIds = useMemo(() => [...new Set([...injectedDocIds, ...selectedDocIds])], [injectedDocIds, selectedDocIds]);
  const indexedFiles = useMemo(() => {
    return (filesQuery.data ?? []).filter((item) => item.status === "indexed");
  }, [filesQuery.data]);
  const visibleSourceFiles = useMemo(() => {
    const query = sourceSearch.trim().toLowerCase();
    if (!query) return indexedFiles;
    return indexedFiles.filter((item) => {
      const corpus = `${item.display_name || ""} ${item.filename || ""}`.toLowerCase();
      return corpus.includes(query);
    });
  }, [indexedFiles, sourceSearch]);
  const selectedSourceFiles = useMemo(() => {
    const map = new Map(indexedFiles.map((item) => [item.id, item]));
    return selectedDocIds.map((docId) => map.get(docId)).filter(Boolean) as FileItem[];
  }, [indexedFiles, selectedDocIds]);
  const mentionState = useMemo(() => {
    if (activeMode !== "deep" || isSending) {
      return { active: false, term: "" };
    }
    const atIndex = question.lastIndexOf("@");
    if (atIndex < 0) {
      return { active: false, term: "" };
    }
    const tail = question.slice(atIndex + 1);
    if (/\s/.test(tail)) {
      return { active: false, term: "" };
    }
    return { active: true, term: tail.trim().toLowerCase() };
  }, [activeMode, activeSession?.locked, isSending, question]);
  const mentionCandidates = useMemo(() => {
    if (!mentionState.active) return [];
    const term = mentionState.term;
    return indexedFiles.filter((item) => {
      const corpus = `${item.display_name || ""} ${item.filename || ""}`.toLowerCase();
      return !term || corpus.includes(term);
    });
  }, [indexedFiles, mentionState]);

  useEffect(() => {
    if (modelOptions.length === 0) {
      setSelectedModelKey("");
      return;
    }
    if (!selectedModelKey || !modelOptions.some((entry) => `${entry.provider}::${entry.model}` === selectedModelKey)) {
      const defaultKey =
        chatDefault && modelOptions.some((entry) => entry.provider === chatDefault.provider && entry.model === chatDefault.model)
          ? `${chatDefault.provider}::${chatDefault.model}`
          : `${modelOptions[0].provider}::${modelOptions[0].model}`;
      setSelectedModelKey(defaultKey);
    }
  }, [chatDefault, modelOptions, selectedModelKey]);

  useEffect(() => {
    const store = readSessionStore();
    const nextSessions = (store[workspaceId] ?? []).map(normalizeSession).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (nextSessions.length === 0) {
      const initial = createEmptySession();
      setSessions([initial]);
      setActiveSessionId(initial.id);
      setLoadedWorkspaceId(workspaceId);
      return;
    }
    setSessions(nextSessions);
    setActiveSessionId((current) => (nextSessions.some((session) => session.id === current) ? current : nextSessions[0].id));
    setLoadedWorkspaceId(workspaceId);
  }, [workspaceId]);

  useEffect(() => {
    if (loadedWorkspaceId !== workspaceId) return;
    if (sessions.length === 0) return;
    const store = readSessionStore();
    store[workspaceId] = sessions;
    writeSessionStore(store);
  }, [loadedWorkspaceId, sessions, workspaceId]);

  useEffect(() => {
    const node = threadRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [activeMessages, isSending, activeSessionId]);

  function updateActiveSession(updater: (session: ChatSession) => ChatSession) {
    setSessions((current) => {
      const target = current.find((session) => session.id === activeSessionId);
      if (!target) return current;
      const nextSession = updater(target);
      const nextSessions = current
        .map((session) => (session.id === activeSessionId ? nextSession : session))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return nextSessions;
    });
  }

  function changeMode(mode: ChatMode) {
    if (!activeSession || activeSession.locked || isSending) return;
    updateActiveSession((session) => ({
      ...session,
      mode,
      updatedAt: new Date().toISOString(),
    }));
  }

  function toggleSource(docId: string) {
    if (!activeSession || isSending) return;
    updateActiveSession((session) => {
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
    });
  }

  function addSource(docId: string) {
    if (!activeSession || isSending) return;
    updateActiveSession((session) => ({
      ...session,
      selectedDocIds:
        session.injectedDocIds.includes(docId) || session.selectedDocIds.includes(docId)
          ? session.selectedDocIds
          : [...session.selectedDocIds, docId],
      updatedAt: new Date().toISOString(),
    }));
  }

  function selectMentionSource(file: FileItem) {
    addSource(file.id);
    const atIndex = question.lastIndexOf("@");
    if (atIndex >= 0) {
      setQuestion(`${question.slice(0, atIndex)}${question.slice(atIndex).replace(/^@\S*/, "")}`.replace(/\s{2,}/g, " "));
    }
    textareaRef.current?.focus();
  }

  function startRenameSession(session: ChatSession) {
    setEditingSessionId(session.id);
    setEditingSessionTitle(session.title);
  }

  function commitRenameSession(sessionId = editingSessionId) {
    const nextTitle = editingSessionTitle.trim();
    if (!sessionId) return;
    setSessions((current) => current.map((session) => (
      session.id === sessionId
        ? { ...session, title: nextTitle || session.title, updatedAt: new Date().toISOString() }
        : session
    )));
    setEditingSessionId("");
    setEditingSessionTitle("");
  }

  function cancelRenameSession() {
    setEditingSessionId("");
    setEditingSessionTitle("");
  }

  async function submitQuestion(input = question) {
    const trimmedQuestion = input.trim();
    const entry = selectedModelEntry;
    const currentSessionId = activeSessionId;
    const currentMode = activeMode;
    const currentDocIds = currentContextDocIds;
    const newlySelectedDocIds = selectedDocIds;
    if (!trimmedQuestion || isSending || !currentSessionId) return;
    if (!entry?.provider) {
      updateActiveSession((session) => ({
        ...session,
        updatedAt: new Date().toISOString(),
        messages: [...session.messages, createMessage("system", "没有可用模型，请先在配置页完成 Provider 设置。")],
      }));
      setStatusMessage("No model");
      return;
    }
    if (currentMode === "deep" && currentDocIds.length === 0) {
      updateActiveSession((session) => ({
        ...session,
        updatedAt: new Date().toISOString(),
        messages: [...session.messages, createMessage("system", "精读模式需要先选择至少一篇文献。")],
      }));
      setStatusMessage("Select source");
      return;
    }

    activeControllerRef.current?.abort();
    const controller = new AbortController();
    activeControllerRef.current = controller;

    updateActiveSession((session) => ({
      ...session,
      title: session.messages.length === 0 ? buildSessionTitle(trimmedQuestion) : session.title,
      locked: true,
      updatedAt: new Date().toISOString(),
      lastQuestion: trimmedQuestion,
      messages: [...session.messages, createMessage("user", trimmedQuestion)],
    }));
    setQuestion("");
    setIsSending(true);
    setStatusMessage(modeLabel(currentMode));

    try {
      const payload = {
        question: trimmedQuestion,
        provider: entry.provider,
        model: entry.model || null,
          workspace_id: workspaceId,
          mode: currentMode,
          doc_ids: currentDocIds,
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
              setSessions((current) => current.map((session) => {
                if (session.id !== currentSessionId) return session;
                if (session.messages.some((item) => item.id === assistantMessageId)) return session;
                return {
                  ...session,
                  injectedDocIds: [...new Set([...session.injectedDocIds, ...newlySelectedDocIds])],
                  selectedDocIds: session.id === currentSessionId ? [] : session.selectedDocIds,
                  updatedAt: new Date().toISOString(),
                  messages: [...session.messages, message],
                };
              }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
              return;
            }
            if (event.type === "delta") {
              streamStarted = true;
              setSessions((current) => current.map((session) => {
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
              }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
            }
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setStatusMessage("Ready");
        return;
      } catch (streamError) {
        if (controller.signal.aborted) return;
        if (streamStarted) {
          throw streamError;
        }
      }

      const response = await askChatWithSignal(payload, controller.signal);
      if (controller.signal.aborted) return;
      setSessions((current) => {
        const nextSessions = current
          .map((session) => {
            if (session.id !== currentSessionId) return session;
            return {
              ...session,
              injectedDocIds: [...new Set([...session.injectedDocIds, ...newlySelectedDocIds])],
              selectedDocIds: [],
              updatedAt: new Date().toISOString(),
              messages: [
                ...session.messages,
                createMessage("assistant", response.answer, response.sources, response.context_stats),
              ],
            };
          })
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        return nextSessions;
      });
      setStatusMessage("Ready");
    } catch (error) {
      if (controller.signal.aborted) return;
      setSessions((current) => {
        const nextSessions = current
          .map((session) => {
            if (session.id !== currentSessionId) return session;
            return {
              ...session,
              updatedAt: new Date().toISOString(),
              messages: [...session.messages, createMessage("system", error instanceof Error ? error.message : "Chat 请求失败")],
            };
          })
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        return nextSessions;
      });
      setStatusMessage("Error");
    } finally {
      if (activeControllerRef.current === controller) {
        activeControllerRef.current = null;
        setIsSending(false);
      }
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitQuestion();
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    void submitQuestion();
  }

  function stopGeneration() {
    activeControllerRef.current?.abort();
    activeControllerRef.current = null;
    setIsSending(false);
    setStatusMessage("Stopped");
  }

  function usePrompt(prompt: string) {
    setQuestion(prompt);
    textareaRef.current?.focus();
  }

  function createSession() {
    const next = createEmptySession(activeMode);
    setSessions((current) => [next, ...current]);
    setActiveSessionId(next.id);
    setQuestion("");
    setStatusMessage("Ready");
    textareaRef.current?.focus();
  }

  function deleteSession(sessionId: string) {
    if (isSending && sessionId === activeSessionId) {
      stopGeneration();
    }
    const nextSessions = sessions.filter((session) => session.id !== sessionId);
    if (nextSessions.length === 0) {
      const fallback = createEmptySession();
      setSessions([fallback]);
      setActiveSessionId(fallback.id);
      return;
    }
    setSessions(nextSessions);
    if (sessionId === activeSessionId) {
      setActiveSessionId(nextSessions[0].id);
    }
  }

  const canSend = Boolean(
    question.trim()
    && selectedModelEntry?.provider
    && !isSending
    && activeSession
    && (activeMode !== "deep" || currentContextDocIds.length > 0),
  );

  return (
    <section className="v35-chat-page">
      <header className="v35-chat-hero">
        <div>
          <p className="v35-banner-kicker">Research Chat</p>
          <h1>问答</h1>
        </div>
        <div className="v35-chat-hero-meta">
          <span>{workspaceId}</span>
          <span className={isSending ? "is-live" : ""}>{statusMessage}</span>
        </div>
      </header>

      <div className="v35-chat-workspace">
        <main className="v35-chat-paper v35-paper-panel">
          <nav className="v35-chat-mode-rail" aria-label="Chat mode">
            {CHAT_MODES.map((item) => (
              <button
                className={activeMode === item.mode ? "is-active" : ""}
                key={item.mode}
                type="button"
                disabled={Boolean(activeSession?.locked) || isSending}
                onClick={() => changeMode(item.mode)}
                title={activeSession?.locked ? "当前会话已锁定模式" : item.label}
              >
                <ModeIcon icon={item.icon} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          <div className="v35-chat-thread" ref={threadRef}>
            {activeMessages.length === 0 ? (
              <div className="v35-chat-empty">
                <span>Aindexer</span>
                <h2>向当前工作区提问</h2>
                <p>{activeMode === "deep" ? "选择文献后开始精读。" : activeMode === "wide" ? "横向查看工作区索引。" : "让系统先找材料再回答。"}</p>
              </div>
            ) : null}

            {activeMessages.map((message) => (
              <article className={`v35-chat-turn role-${message.role}`} key={message.id}>
                <header>
                  <span>{message.role === "user" ? "You" : message.role === "assistant" ? "Assistant" : "System"}</span>
                  <time>{formatTime(message.createdAt)}</time>
                </header>
                <p>{message.content}</p>
                <footer>
                  {(message.sources ?? []).map((source) => (
                    <button
                      className="v35-chat-source"
                      key={source.doc_id}
                      type="button"
                      title={source.doc_id}
                      onClick={() => void navigator.clipboard?.writeText(source.doc_id)}
                    >
                      {source.display_name}
                    </button>
                  ))}
                  {message.contextStats ? <span className="v35-chat-context-stat">{formatCompression(message.contextStats)}</span> : null}
                  <button className="v35-chat-text-action" type="button" onClick={() => void navigator.clipboard?.writeText(message.content)}>
                    复制
                  </button>
                  {message.role === "user" ? (
                    <button className="v35-chat-text-action" type="button" disabled={isSending} onClick={() => void submitQuestion(message.content)}>
                      重试
                    </button>
                  ) : null}
                </footer>
              </article>
            ))}

            {isSending ? (
              <article className="v35-chat-turn role-assistant is-pending">
                <header>
                  <span>Assistant</span>
                  <time>now</time>
                </header>
                <p><span className="v35-chat-dot" /> 正在生成...</p>
              </article>
            ) : null}
          </div>

          <form className="v35-chat-composer" onSubmit={handleSubmit}>
            {activeMode === "deep" && selectedSourceFiles.length > 0 ? (
              <div className="v35-chat-selected-sources">
                {selectedSourceFiles.map((item) => (
                  <button key={item.id} type="button" disabled={isSending} onClick={() => toggleSource(item.id)}>
                    {item.display_name || item.filename}
                  </button>
                ))}
              </div>
            ) : null}
            <textarea
              ref={textareaRef}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="输入问题，Enter 发送，Shift + Enter 换行"
            />
            {mentionState.active && mentionCandidates.length > 0 ? (
              <div className="v35-chat-mention-popover">
                {mentionCandidates.map((item) => (
                  <button key={item.id} type="button" onClick={() => selectMentionSource(item)}>
                    <strong>{item.display_name || item.filename}</strong>
                    <span>{item.file_type}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <div className="v35-chat-composer-bar">
              <div className="v35-chat-composer-meta">
                <select
                  className="v35-input v35-chat-model-select"
                  value={selectedModelKey}
                  onChange={(event) => setSelectedModelKey(event.target.value)}
                  disabled={providersQuery.isLoading || modelOptions.length === 0 || isSending}
                >
                  {modelOptions.map((entry) => (
                    <option key={`${entry.provider}::${entry.model}`} value={`${entry.provider}::${entry.model}`}>
                      {entry.provider} · {entry.model}
                    </option>
                  ))}
                </select>
                <span>{activeSession ? `${activeSession.messages.filter((message) => message.role !== "system").length} turns` : "0 turns"}</span>
              </div>
              <div>
                {isSending ? (
                  <button className="v35-button" type="button" onClick={stopGeneration}>
                    停止
                  </button>
                ) : null}
                <button className="v35-button v35-button-primary" type="submit" disabled={!canSend}>
                  发送
                </button>
              </div>
            </div>
          </form>
        </main>

        <aside className="v35-chat-side v35-paper-panel">
          <section className="v35-chat-side-section">
            <div className="v35-chat-session-head">
              <h2 className="v35-section-title">Sessions</h2>
              <button className="v35-button" type="button" onClick={createSession}>
                新建
              </button>
            </div>
            <div className="v35-chat-session-list">
              {sessions.map((session) => (
                <article className={`v35-chat-session-item ${session.id === activeSessionId ? "is-active" : ""}`} key={session.id}>
                  {editingSessionId === session.id ? (
                    <input
                      className="v35-input v35-chat-session-rename"
                      value={editingSessionTitle}
                      autoFocus
                      onChange={(event) => setEditingSessionTitle(event.target.value)}
                      onBlur={() => commitRenameSession(session.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") commitRenameSession(session.id);
                        if (event.key === "Escape") cancelRenameSession();
                      }}
                    />
                  ) : (
                    <button type="button" onClick={() => setActiveSessionId(session.id)} onDoubleClick={() => startRenameSession(session)}>
                      <strong>{session.title}</strong>
                      <span>{modeLabel(session.mode)} · {formatSessionTime(session.updatedAt)} · {session.messages.filter((message) => message.role !== "system").length} turns</span>
                    </button>
                  )}
                  <button className="v35-chat-session-delete" type="button" aria-label={`删除 ${session.title}`} onClick={() => deleteSession(session.id)}>
                    删除
                  </button>
                </article>
              ))}
            </div>
          </section>

          <section className="v35-chat-side-section">
            <div className="v35-chat-session-head">
              <h2 className="v35-section-title">Sources</h2>
              <span className="v35-chat-side-count">{activeMode === "deep" ? `${injectedDocIds.length}+${selectedDocIds.length}/${indexedFiles.length}` : `${indexedFiles.length}`}</span>
            </div>
            {activeMode === "deep" ? (
              <>
                <input
                  className="v35-input v35-chat-source-search"
                  value={sourceSearch}
                  onChange={(event) => setSourceSearch(event.target.value)}
                  placeholder="筛选文献"
                  disabled={isSending}
                />
                <div className="v35-chat-source-list">
                  {visibleSourceFiles.map((item) => (
                    <button
                      className={selectedDocIds.includes(item.id) ? "is-active" : ""}
                      key={item.id}
                      type="button"
                      disabled={isSending || injectedDocIds.includes(item.id)}
                      onClick={() => toggleSource(item.id)}
                    >
                      <strong>{item.display_name || item.filename}</strong>
                      <span>{injectedDocIds.includes(item.id) ? "已注入" : selectedDocIds.includes(item.id) ? "当前选择" : item.file_type}</span>
                    </button>
                  ))}
                  {visibleSourceFiles.length === 0 ? <p className="v35-muted">暂无可选文献</p> : null}
                </div>
              </>
            ) : (
              <p className="v35-muted">{activeMode === "wide" ? "使用工作区内的已索引文献。" : "系统会按问题读取候选文献。"}</p>
            )}
          </section>

          <section className="v35-chat-side-section">
            <h2 className="v35-section-title">Prompt</h2>
            <div className="v35-chat-prompt-list">
              {QUICK_PROMPTS.map((prompt) => (
                <button key={prompt} type="button" onClick={() => usePrompt(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}
