import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { useWorkspaceStore } from "../app/workspaceStore";
import { askChatV0WithSignal } from "../shared/api/chat";
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
  source?: {
    docId: string;
    displayName: string;
  };
}

interface ChatSession {
  id: string;
  title: string;
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

function createMessageId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createSessionId(): string {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createMessage(role: ChatMessage["role"], content: string, source?: ChatMessage["source"]): ChatMessage {
  return {
    id: createMessageId(),
    role,
    content,
    source,
    createdAt: new Date().toISOString(),
  };
}

function createEmptySession(): ChatSession {
  const now = new Date().toISOString();
  return {
    id: createSessionId(),
    title: "新会话",
    createdAt: now,
    updatedAt: now,
    lastQuestion: "",
    messages: [],
  };
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

  const threadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeControllerRef = useRef<AbortController | null>(null);

  const providersQuery = useQuery({
    queryKey: ["providers"],
    queryFn: listProviders,
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
    const nextSessions = (store[workspaceId] ?? []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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

  async function submitQuestion(input = question) {
    const trimmedQuestion = input.trim();
    const entry = selectedModelEntry;
    const currentSessionId = activeSessionId;
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

    activeControllerRef.current?.abort();
    const controller = new AbortController();
    activeControllerRef.current = controller;

    updateActiveSession((session) => ({
      ...session,
      title: session.messages.length === 0 ? buildSessionTitle(trimmedQuestion) : session.title,
      updatedAt: new Date().toISOString(),
      lastQuestion: trimmedQuestion,
      messages: [...session.messages, createMessage("user", trimmedQuestion)],
    }));
    setQuestion("");
    setIsSending(true);
    setStatusMessage("Thinking");

    try {
      const response = await askChatV0WithSignal(
        {
          question: trimmedQuestion,
          provider: entry.provider,
          model: entry.model || null,
          workspace_id: workspaceId,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setSessions((current) => {
        const nextSessions = current
          .map((session) => {
            if (session.id !== currentSessionId) return session;
            return {
              ...session,
              updatedAt: new Date().toISOString(),
              messages: [
                ...session.messages,
                createMessage("assistant", response.answer, {
                  docId: response.doc_id,
                  displayName: response.display_name,
                }),
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
    const next = createEmptySession();
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

  const canSend = Boolean(question.trim() && selectedModelEntry?.provider && !isSending && activeSession);

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
          <div className="v35-chat-thread" ref={threadRef}>
            {activeMessages.length === 0 ? (
              <div className="v35-chat-empty">
                <span>Aindexer</span>
                <h2>向当前工作区提问</h2>
                <p>选择模型，输入问题。</p>
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
                  {message.source ? (
                    <button
                      className="v35-chat-source"
                      type="button"
                      title={message.source.docId}
                      onClick={() => void navigator.clipboard?.writeText(message.source?.docId ?? "")}
                    >
                      {message.source.displayName}
                    </button>
                  ) : null}
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
            <textarea
              ref={textareaRef}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="输入问题，Enter 发送，Shift + Enter 换行"
            />
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
                  <button type="button" onClick={() => setActiveSessionId(session.id)}>
                    <strong>{session.title}</strong>
                    <span>{formatSessionTime(session.updatedAt)} · {session.messages.filter((message) => message.role !== "system").length} turns</span>
                  </button>
                  <button className="v35-chat-session-delete" type="button" aria-label={`删除 ${session.title}`} onClick={() => deleteSession(session.id)}>
                    删除
                  </button>
                </article>
              ))}
            </div>
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
