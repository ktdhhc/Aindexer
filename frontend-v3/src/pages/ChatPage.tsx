import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { type ChatSession, useChatStore } from "../app/chatStore";
import { getDefaultChatPageSession, usePageSessionStore } from "../app/pageSessionStore";
import { useWorkspaceStore } from "../app/workspaceStore";
import {
  resolveAssistantCitedSources,
  stripAssistantCitationFooter,
  type AgentTraceStep,
  type ChatContextStats,
  type ChatMode,
  type ChatThinkingBlock,
} from "../shared/api/chat";
import { listFiles, type FileItem } from "../shared/api/files";
import { listProviders } from "../shared/api/providers";
import { getModelDefault, parseModelDefaultKey } from "../shared/lib/modelDefaults";
import { renderMarkdownToHtml } from "../features/workbench/utils";
import {
  type ProviderModelEntry,
  useAvailableProviderModelEntries,
} from "../shared/lib/providerModels";
import { isDesktopShell } from "../shared/lib/runtime";

const CHAT_MODES: Array<{ mode: ChatMode; label: string; icon: "scan" | "focus" | "path" }> = [
  { mode: "wide", label: "全景", icon: "scan" },
  { mode: "deep", label: "精读", icon: "focus" },
  { mode: "agent", label: "探索", icon: "path" },
];

const THREAD_BOTTOM_THRESHOLD = 24;

function modeLabel(mode: ChatMode): string {
  return CHAT_MODES.find((item) => item.mode === mode)?.label ?? "精读";
}

function statNumber(stats: ChatContextStats | undefined, key: string, fallback = 0): number {
  const value = Number(stats?.[key] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

function formatWideStrategy(stats?: ChatContextStats): string {
  if (!stats) return "待检索";
  if (stats.wide_ranked_fallback) return "Top-K 摘要";
  if (stats.wide_strategy === "full_index") return "全文索引";
  if (stats.wide_strategy === "structured_summary") return "结构摘要";
  return "全景";
}

function formatSourceMeta(source: { title?: string; year?: number | null; authors?: string[] }): string {
  const parts = [source.title || "", source.year ? String(source.year) : "", (source.authors ?? []).slice(0, 3).join(", ")].filter(Boolean);
  return parts.join(" · ");
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

function CopyIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="5" width="8" height="10" rx="1.5" /><path d="M5.5 12.5H5A2 2 0 0 1 3 10.5v-6A2 2 0 0 1 5 2.5h6A2 2 0 0 1 13 4.5V5" /></svg>;
}

function RetryIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15 10a5 5 0 1 1-1.4-3.5" /><path d="M15 5.5v3.2h-3.2" /></svg>;
}

function formatCompression(stats?: ChatContextStats): string {
  if (!stats) return "";
  const level = String(stats.compression_level || "none");
  const tokens = Number(stats.estimated_input_tokens || 0);
  const levelLabel = level === "none" ? "原文" : level === "advisory" ? "建议压缩" : level === "auto" ? "已压缩" : "已兜底";
  if (stats.wide_strategy) {
    return `${formatWideStrategy(stats)} · ${tokens || "-"} tokens · ${levelLabel}`;
  }
  const docs = statNumber(stats, "included_source_count", Number(stats.doc_count || 0));
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

function isThreadNearBottom(node: HTMLDivElement): boolean {
  return node.scrollHeight - node.scrollTop - node.clientHeight <= THREAD_BOTTOM_THRESHOLD;
}

function thinkingExpansionKey(messageId: string, blockId: string): string {
  return `${messageId}::${blockId}`;
}

function plannerIterationFromThinkingId(thinkingId: string): number | null {
  const matched = /^agent_planner_(\d+)$/.exec(thinkingId);
  if (!matched) return null;
  const value = Number(matched[1]);
  return Number.isFinite(value) ? value : null;
}

function formatTraceSourceIds(ids: string[]): string {
  if (ids.length <= 3) return ids.join(", ");
  return `${ids.slice(0, 3).join(", ")} +${ids.length - 3}`;
}

function summarizeTraceForIteration(traceSteps: AgentTraceStep[], iteration: number): string {
  const indexIds: string[] = [];
  const paperIds: string[] = [];
  let readMetadata = false;
  const retryDetails: string[] = [];

  for (const step of traceSteps) {
    if (step.iteration !== iteration) continue;
    if (step.step === "read_metadata") {
      readMetadata = true;
      continue;
    }
    if (step.step === "read_index") {
      for (const source of step.sources ?? []) {
        if (source.source_id && !indexIds.includes(source.source_id)) {
          indexIds.push(source.source_id);
        }
      }
      continue;
    }
    if (step.step === "read_paper") {
      for (const source of step.sources ?? []) {
        if (source.source_id && !paperIds.includes(source.source_id)) {
          paperIds.push(source.source_id);
        }
      }
      continue;
    }
    if (step.step.startsWith("planner_retry_") && step.detail && !retryDetails.includes(step.detail)) {
      retryDetails.push(step.detail);
    }
  }

  const parts: string[] = [];
  if (readMetadata) parts.push("元数据");
  if (indexIds.length > 0) parts.push(`索引 ${formatTraceSourceIds(indexIds)}`);
  if (paperIds.length > 0) parts.push(`原文 ${formatTraceSourceIds(paperIds)}`);
  parts.push(...retryDetails);
  return parts.join(" / ");
}

function buildThinkingLabel(block: ChatThinkingBlock, traceSteps: AgentTraceStep[]): string {
  const iteration = plannerIterationFromThinkingId(block.id);
  if (!iteration) return block.label;
  const traceSummary = summarizeTraceForIteration(traceSteps, iteration);
  return traceSummary ? `${block.label} - ${traceSummary}` : block.label;
}

type UnifiedTraceEntry =
  | { kind: "thinking"; key: string; block: ChatThinkingBlock }
  | { kind: "trace"; key: string; step: AgentTraceStep };

function buildInlineTraceSteps(thinkingBlocks: ChatThinkingBlock[], traceSteps: AgentTraceStep[]): AgentTraceStep[] {
  const plannedIterations = new Set(
    thinkingBlocks
      .map((block) => plannerIterationFromThinkingId(block.id))
      .filter((value): value is number => value !== null),
  );
  return traceSteps.filter((step) => {
    if (!step.iteration || !plannedIterations.has(step.iteration)) {
      return true;
    }
    return !(step.step === "read_metadata" || step.step === "read_index" || step.step === "read_paper" || step.step.startsWith("planner_retry_"));
  });
}

function formatTraceStepLabel(step: AgentTraceStep): string {
  if (step.step === "metadata") return "注入元数据";
  return step.label || step.step;
}

function buildUnifiedTraceEntries(thinkingBlocks: ChatThinkingBlock[], traceSteps: AgentTraceStep[]): UnifiedTraceEntry[] {
  const inlineTraceSteps = buildInlineTraceSteps(thinkingBlocks, traceSteps);
  const entries: UnifiedTraceEntry[] = [];

  for (const step of inlineTraceSteps) {
    if (step.step === "metadata") {
      entries.push({
        kind: "trace",
        key: `${step.step}:${step.iteration ?? "x"}:metadata`,
        step,
      });
    }
  }

  for (const block of thinkingBlocks) {
    entries.push({ kind: "thinking", key: `thinking:${block.id}`, block });
  }

  for (let index = 0; index < inlineTraceSteps.length; index += 1) {
    const step = inlineTraceSteps[index];
    if (step.step === "metadata") continue;
    entries.push({
      kind: "trace",
      key: `${step.step}:${step.iteration ?? "x"}:${index}`,
      step,
    });
  }

  return entries;
}

export function ChatPage() {
  const desktopShell = isDesktopShell();
  const workspaceId = useWorkspaceStore((state) => state.workspaceId);
  const ensureWorkspace = useChatStore((state) => state.ensureWorkspace);
  const sessions = useChatStore((state) => state.sessionsByWorkspace[workspaceId] ?? []);
  const activeSessionId = useChatStore((state) => state.activeSessionIds[workspaceId] ?? "");
  const isSending = useChatStore((state) => Boolean(state.sendingByWorkspace[workspaceId]));
  const statusMessage = useChatStore((state) => state.statusByWorkspace[workspaceId] ?? "Ready");
  const setActiveSessionId = useChatStore((state) => state.setActiveSessionId);
  const createChatSession = useChatStore((state) => state.createSession);
  const deleteChatSession = useChatStore((state) => state.deleteSession);
  const renameSession = useChatStore((state) => state.renameSession);
  const changeMode = useChatStore((state) => state.changeMode);
  const toggleSource = useChatStore((state) => state.toggleSource);
  const addSource = useChatStore((state) => state.addSource);
  const submitChatQuestion = useChatStore((state) => state.submitQuestion);
  const stopChatGeneration = useChatStore((state) => state.stopGeneration);
  const chatPageSession = usePageSessionStore((state) => state.chatByWorkspace[workspaceId] ?? getDefaultChatPageSession());
  const ensureChatPageSession = usePageSessionStore((state) => state.ensureChatSession);
  const updateChatPageSession = usePageSessionStore((state) => state.updateChatSession);

  const selectedModelKey = chatPageSession.selectedModelKey;
  const question = chatPageSession.question;
  const sourceSearch = chatPageSession.sourceSearch;
  const editingSessionId = chatPageSession.editingSessionId;
  const editingSessionTitle = chatPageSession.editingSessionTitle;
  const expandedTraceByMessage = chatPageSession.expandedTraceByMessage;
  const expandedThinkingByBlock = chatPageSession.expandedThinkingByBlock;
  const threadScrollTopBySessionId = chatPageSession.threadScrollTopBySessionId;
  const setSelectedModelKey = useCallback((next: string) => {
    updateChatPageSession(workspaceId, { selectedModelKey: next });
  }, [updateChatPageSession, workspaceId]);
  const setQuestion = useCallback((next: string) => {
    updateChatPageSession(workspaceId, { question: next });
  }, [updateChatPageSession, workspaceId]);
  const setSourceSearch = useCallback((next: string) => {
    updateChatPageSession(workspaceId, { sourceSearch: next });
  }, [updateChatPageSession, workspaceId]);
  const setEditingSessionTitle = useCallback((next: string) => {
    updateChatPageSession(workspaceId, { editingSessionTitle: next });
  }, [updateChatPageSession, workspaceId]);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  const threadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messageRefs = useRef<Record<string, HTMLElement | null>>({});
  const autoFollowEnabledRef = useRef(true);
  const resumeSmoothUntilRef = useRef(0);
  const suppressAutoFollowUntilRef = useRef(0);

  const preserveThreadScroll = useCallback((apply: () => void) => {
    const node = threadRef.current;
    const savedScrollTop = node?.scrollTop ?? null;
    suppressAutoFollowUntilRef.current = performance.now() + 280;
    autoFollowEnabledRef.current = false;
    apply();
    if (savedScrollTop === null) return;
    const restoreScrollTop = () => {
      const currentNode = threadRef.current;
      if (!currentNode) return;
      currentNode.scrollTo({ top: savedScrollTop, behavior: "auto" });
      setShowJumpToBottom(!isThreadNearBottom(currentNode));
    };
    restoreScrollTop();
    requestAnimationFrame(() => {
      restoreScrollTop();
      requestAnimationFrame(restoreScrollTop);
    });
  }, []);

  const providersQuery = useQuery({
    queryKey: ["providers"],
    queryFn: listProviders,
  });

  const filesQuery = useQuery({
    queryKey: ["files", workspaceId],
    queryFn: () => listFiles(workspaceId),
  });

  const chatDefault = parseModelDefaultKey(getModelDefault("chat"));

  const modelOptions = useAvailableProviderModelEntries(providersQuery.data ?? []);

  const selectedModelEntry = useMemo(() => parseModelKey(selectedModelKey), [selectedModelKey]);
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );
  const activeMessages = activeSession?.messages ?? [];
  const latestAssistantMessage = useMemo(() => {
    return [...activeMessages].reverse().find((message) => message.role === "assistant") ?? null;
  }, [activeMessages]);
  const latestVisibleAssistantMessage = useMemo(() => {
    return [...activeMessages].reverse().find((message) => {
      if (message.role !== "assistant") return false;
      return Boolean(stripAssistantCitationFooter(message.content).trim());
    }) ?? null;
  }, [activeMessages]);
  const activeMode = activeSession?.mode ?? "deep";
  const injectedDocIds = activeSession?.injectedDocIds ?? [];
  const selectedDocIds = activeSession?.selectedDocIds ?? [];
  const currentContextDocIds = useMemo(() => [...new Set([...injectedDocIds, ...selectedDocIds])], [injectedDocIds, selectedDocIds]);
  const indexedFiles = useMemo(() => {
    return (filesQuery.data ?? []).filter((item) => item.status === "indexed");
  }, [filesQuery.data]);
  const latestContextStats = latestVisibleAssistantMessage?.contextStats;
  const latestSources = latestVisibleAssistantMessage?.sources ?? [];
  const wideTotal = statNumber(latestContextStats, "total_indexed_count", indexedFiles.length);
  const wideIncluded = statNumber(latestContextStats, "included_source_count", latestSources.length);
  const wideOmitted = statNumber(latestContextStats, "omitted_source_count", Math.max(0, wideTotal - wideIncluded));
  const agentIndexCount = statNumber(latestContextStats, "read_index_count", latestSources.filter((source) => source.source_kind !== "paper").length);
  const agentPaperCount = statNumber(latestContextStats, "read_original_count", latestSources.filter((source) => source.source_kind === "paper").length);
  const sourceCountLabel = activeMode === "deep"
    ? `${injectedDocIds.length}+${selectedDocIds.length}/${indexedFiles.length}`
    : activeMode === "wide"
      ? `${wideIncluded}/${wideTotal}`
      : activeMode === "agent"
        ? `I${agentIndexCount}/P${agentPaperCount}`
        : `${indexedFiles.length}`;
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
  const timelineEntries = useMemo(() => {
    let turn = 0;
    return activeMessages.flatMap((message) => {
      if (message.role !== "user") return [];
      turn += 1;
      const summary = message.content.replace(/\s+/g, " ").trim();
      return [{
        id: message.id,
        turn,
        summary: summary.length > 28 ? `${summary.slice(0, 28)}...` : summary || `第 ${turn} 轮`,
      }];
    });
  }, [activeMessages]);

  useEffect(() => {
    ensureWorkspace(workspaceId);
    ensureChatPageSession(workspaceId);
  }, [ensureChatPageSession, ensureWorkspace, workspaceId]);

  useEffect(() => {
    if (!editingSessionId) return;
    if (sessions.some((session) => session.id === editingSessionId)) return;
    updateChatPageSession(workspaceId, { editingSessionId: "", editingSessionTitle: "" });
  }, [editingSessionId, sessions, updateChatPageSession, workspaceId]);

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
    const node = threadRef.current;
    if (!node) return;

    const syncScrollState = () => {
      if (performance.now() < suppressAutoFollowUntilRef.current) {
        setShowJumpToBottom(!isThreadNearBottom(node));
        return;
      }
      const nearBottom = isThreadNearBottom(node);
      if (nearBottom) {
        autoFollowEnabledRef.current = true;
        setShowJumpToBottom(false);
        return;
      }
      if (performance.now() < resumeSmoothUntilRef.current && autoFollowEnabledRef.current) {
        setShowJumpToBottom(false);
        return;
      }
      autoFollowEnabledRef.current = false;
      setShowJumpToBottom(true);
    };

    node.addEventListener("scroll", syncScrollState, { passive: true });
    syncScrollState();
    return () => {
      node.removeEventListener("scroll", syncScrollState);
      if (activeSessionId) {
        updateChatPageSession(workspaceId, (current) => ({
          threadScrollTopBySessionId: {
            ...current.threadScrollTopBySessionId,
            [activeSessionId]: node.scrollTop,
          },
        }));
      }
    };
  }, [activeSessionId, updateChatPageSession, workspaceId]);

  useEffect(() => {
    const node = threadRef.current;
    if (!node) return;
    resumeSmoothUntilRef.current = 0;
    requestAnimationFrame(() => {
      const savedScrollTop = activeSessionId ? threadScrollTopBySessionId[activeSessionId] ?? 0 : 0;
      if (savedScrollTop > 0) {
        node.scrollTo({ top: savedScrollTop, behavior: "auto" });
        const nearBottom = isThreadNearBottom(node);
        autoFollowEnabledRef.current = nearBottom;
        setShowJumpToBottom(!nearBottom);
        return;
      }
      autoFollowEnabledRef.current = true;
      setShowJumpToBottom(false);
      node.scrollTo({ top: node.scrollHeight, behavior: "auto" });
    });
  }, [activeSessionId, threadScrollTopBySessionId]);

  useEffect(() => {
    const node = threadRef.current;
    if (!node) return;
    requestAnimationFrame(() => {
      if (performance.now() < suppressAutoFollowUntilRef.current) {
        setShowJumpToBottom(!isThreadNearBottom(node));
        return;
      }
      if (autoFollowEnabledRef.current) {
        const behavior = performance.now() < resumeSmoothUntilRef.current ? "smooth" : "auto";
        node.scrollTo({ top: node.scrollHeight, behavior });
        setShowJumpToBottom(false);
        return;
      }
      setShowJumpToBottom(!isThreadNearBottom(node));
    });
  }, [activeMessages, isSending]);

  function selectMentionSource(file: FileItem) {
    addSource(workspaceId, file.id);
    const atIndex = question.lastIndexOf("@");
    if (atIndex >= 0) {
      setQuestion(`${question.slice(0, atIndex)}${question.slice(atIndex).replace(/^@\S*/, "")}`.replace(/\s{2,}/g, " "));
    }
    textareaRef.current?.focus();
  }

  function startRenameSession(session: ChatSession) {
    updateChatPageSession(workspaceId, {
      editingSessionId: session.id,
      editingSessionTitle: session.title,
    });
  }

  function commitRenameSession(sessionId = editingSessionId) {
    const nextTitle = editingSessionTitle.trim();
    if (!sessionId) return;
    renameSession(workspaceId, sessionId, nextTitle);
    updateChatPageSession(workspaceId, { editingSessionId: "", editingSessionTitle: "" });
  }

  function cancelRenameSession() {
    updateChatPageSession(workspaceId, { editingSessionId: "", editingSessionTitle: "" });
  }

  function jumpToMessage(messageId: string) {
    const container = threadRef.current;
    const node = messageRefs.current[messageId];
    if (!container || !node) return;
    const containerRect = container.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const top = container.scrollTop + (nodeRect.top - containerRect.top) - 18;
    container.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }

  function jumpToBottom() {
    const node = threadRef.current;
    if (!node) return;
    autoFollowEnabledRef.current = true;
    setShowJumpToBottom(false);
    resumeSmoothUntilRef.current = performance.now() + 420;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }

  async function submitQuestion(input = question, retryFromMessageId?: string) {
    setQuestion("");
    await submitChatQuestion({
      workspaceId,
      question: input,
      selectedModelEntry,
      indexedFiles,
      retryFromMessageId,
    });
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
    stopChatGeneration(workspaceId);
  }

  function createSession() {
    createChatSession(workspaceId, activeMode);
    setQuestion("");
    textareaRef.current?.focus();
  }

  function deleteSession(sessionId: string) {
    updateChatPageSession(workspaceId, (current) => {
      const nextScrollTopBySessionId = { ...current.threadScrollTopBySessionId };
      delete nextScrollTopBySessionId[sessionId];
      return {
        editingSessionId: current.editingSessionId === sessionId ? "" : current.editingSessionId,
        editingSessionTitle: current.editingSessionId === sessionId ? "" : current.editingSessionTitle,
        threadScrollTopBySessionId: nextScrollTopBySessionId,
      };
    });
    deleteChatSession(workspaceId, sessionId);
  }

  function toggleTrace(messageId: string) {
    preserveThreadScroll(() => {
      updateChatPageSession(workspaceId, (current) => ({
        expandedTraceByMessage: {
          ...current.expandedTraceByMessage,
          [messageId]: !current.expandedTraceByMessage[messageId],
        },
      }));
    });
  }

  function toggleThinking(messageId: string, blockId: string) {
    const key = thinkingExpansionKey(messageId, blockId);
    preserveThreadScroll(() => {
      updateChatPageSession(workspaceId, (current) => ({
        expandedThinkingByBlock: {
          ...current.expandedThinkingByBlock,
          [key]: !current.expandedThinkingByBlock[key],
        },
      }));
    });
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
          <span>{statusMessage}</span>
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
                  onClick={() => preserveThreadScroll(() => changeMode(workspaceId, item.mode))}
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
                <h2>{desktopShell ? "开始提问" : "Ask something..."}</h2>
              </div>
            ) : null}

            {activeMessages.map((message) => {
              const displayContent = message.role === "assistant" ? stripAssistantCitationFooter(message.content) : message.content;
              const displaySources = message.role === "assistant" ? resolveAssistantCitedSources(message.content, message.sources) : (message.sources ?? []);
              const traceSteps = message.agentTrace ?? [];
              const thinkingBlocks = message.thinkingBlocks ?? [];
              const unifiedTraceEntries = buildUnifiedTraceEntries(thinkingBlocks, traceSteps);
              const traceExpanded = expandedTraceByMessage[message.id] ?? !displayContent.trim();
              const isLiveAssistant = message.role === "assistant" && isSending && latestAssistantMessage?.id === message.id;
              return (
                <article className={`v35-chat-turn role-${message.role}`} key={message.id} ref={(node) => { messageRefs.current[message.id] = node; }}>
                  <header>
                    <span>
                      {message.role === "user" ? "You" : message.role === "assistant" ? "Assistant" : "System"}
                      {isLiveAssistant ? <i className="v35-chat-live-inline"><span className="v35-chat-dot" />生成中</i> : null}
                    </span>
                    <time>{formatTime(message.createdAt)}</time>
                  </header>
                  {message.role === "assistant" && unifiedTraceEntries.length > 0 ? (
                    <div className={`v35-chat-inline-trace ${traceExpanded ? "is-expanded" : "is-collapsed"}`}>
                      <button className="v35-chat-inline-trace-toggle" type="button" onClick={() => toggleTrace(message.id)}>
                        <span>Trace</span>
                        <em>{traceExpanded ? "收起" : `展开 ${unifiedTraceEntries.length} 项`}</em>
                      </button>
                      {traceExpanded ? (
                        <div className="v35-chat-inline-trace-steps">
                          {unifiedTraceEntries.map((entry) => {
                            if (entry.kind === "thinking") {
                              const block = entry.block;
                              const blockKey = thinkingExpansionKey(message.id, block.id);
                              const thinkingExpanded = expandedThinkingByBlock[blockKey] ?? !block.completed;
                              const thinkingLabel = buildThinkingLabel(block, traceSteps);
                              return (
                                <div className={`v35-chat-thinking ${thinkingExpanded ? "is-expanded" : "is-collapsed"}`} key={entry.key}>
                                  <button className="v35-chat-thinking-toggle" type="button" onClick={() => toggleThinking(message.id, block.id)}>
                                    <span>{thinkingLabel}</span>
                                    <em>{thinkingExpanded ? "收起" : "展开"}</em>
                                  </button>
                                  {thinkingExpanded ? <p>{block.content}</p> : null}
                                </div>
                              );
                            }
                            const step = entry.step;
                            return (
                              <article className="v35-chat-inline-trace-step" key={entry.key}>
                                <header>
                                  <strong>{formatTraceStepLabel(step)}</strong>
                                  <span>{step.detail || step.status || "done"}</span>
                                </header>
                                {(step.sources ?? []).length > 0 ? (
                                  <div className="v35-chat-inline-trace-sources">
                                    {(step.sources ?? []).map((source) => (
                                      <button key={`${source.source_kind || "index"}:${source.doc_id}:${source.source_id || ""}`} type="button" onClick={() => void navigator.clipboard?.writeText(source.doc_id)}>
                                        <strong>{source.source_id ? `[${source.source_id}] ` : ""}{source.display_name}</strong>
                                      </button>
                                    ))}
                                  </div>
                                ) : null}
                              </article>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {message.role === "assistant" ? (
                    displayContent.trim()
                      ? <div className="v35-chat-markdown" dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(displayContent) }} />
                      : isLiveAssistant
                        ? <p>{statusMessage}</p>
                        : null
                  ) : (
                    <p>{displayContent}</p>
                  )}
                  <footer>
                    {displaySources.map((source) => (
                      <button
                        className="v35-chat-source"
                        key={`${source.source_kind || "index"}:${source.doc_id}:${source.source_id || ""}`}
                        type="button"
                        title={source.doc_id}
                        onClick={() => void navigator.clipboard?.writeText(source.doc_id)}
                      >
                        {source.source_id ? `[${source.source_id}] ` : ""}{source.display_name}
                      </button>
                    ))}
                    {message.contextStats ? <span className="v35-chat-context-stat">{formatCompression(message.contextStats)}</span> : null}
                    {desktopShell ? (
                      <div className="v35-chat-footer-actions">
                        <button className="v35-icon-button" type="button" aria-label="复制回答" title="复制回答" onClick={() => void navigator.clipboard?.writeText(displayContent)}>
                          <CopyIcon />
                        </button>
                        {message.role === "user" ? (
                          <button className="v35-icon-button" type="button" aria-label="重试提问" title="重试提问" disabled={isSending} onClick={() => void submitQuestion(message.content, message.id)}>
                            <RetryIcon />
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <button className="v35-chat-text-action" type="button" onClick={() => void navigator.clipboard?.writeText(displayContent)}>
                        复制
                      </button>
                    )}
                    {message.role === "user" ? (
                      desktopShell ? null : (
                        <button className="v35-chat-text-action" type="button" disabled={isSending} onClick={() => void submitQuestion(message.content, message.id)}>
                          重试
                        </button>
                      )
                    ) : null}
                  </footer>
                </article>
              );
            })}

          </div>

          {timelineEntries.length > 0 ? (
            <aside className="v35-chat-timeline" aria-label="Timeline">
              {timelineEntries.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  data-summary={entry.summary}
                  onClick={() => jumpToMessage(entry.id)}
                >
                  <span>{String(entry.turn).padStart(2, "0")}</span>
                </button>
              ))}
            </aside>
          ) : null}

          <form className="v35-chat-composer" onSubmit={handleSubmit}>
            {showJumpToBottom ? (
              <button
                className="v35-icon-button v35-chat-jump-bottom"
                type="button"
                aria-label={isSending ? "回到底部并恢复跟随" : "回到底部"}
                title={isSending ? "回到底部并恢复跟随" : "回到底部"}
                onClick={jumpToBottom}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M8 3v10M4.5 9.5 8 13l3.5-3.5" />
                </svg>
              </button>
            ) : null}
            {activeMode === "deep" && selectedSourceFiles.length > 0 ? (
              <div className="v35-chat-selected-sources">
                {selectedSourceFiles.map((item) => (
                  <button key={item.id} type="button" disabled={isSending} onClick={() => toggleSource(workspaceId, item.id)}>
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
              placeholder="输入问题"
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
                  onChange={(event) => preserveThreadScroll(() => setSelectedModelKey(event.target.value))}
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
                    <button type="button" onClick={() => setActiveSessionId(workspaceId, session.id)} onDoubleClick={() => startRenameSession(session)}>
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
              <span className="v35-chat-side-count">{sourceCountLabel}</span>
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
                      onClick={() => toggleSource(workspaceId, item.id)}
                    >
                      <strong>{item.display_name || item.filename}</strong>
                      <span>{injectedDocIds.includes(item.id) ? "已注入" : selectedDocIds.includes(item.id) ? "当前选择" : item.file_type}</span>
                    </button>
                  ))}
                  {visibleSourceFiles.length === 0 ? <p className="v35-muted">暂无可选文献</p> : null}
                </div>
              </>
            ) : activeMode === "wide" ? (
              <div className="v35-chat-wide-scope">
                <div className="v35-chat-wide-meter">
                  <span><strong>{wideTotal}</strong><em>全库</em></span>
                  <span><strong>{wideIncluded}</strong><em>纳入</em></span>
                  <span><strong>{wideOmitted}</strong><em>略过</em></span>
                </div>
                <div className="v35-chat-wide-strip">
                  <span>{formatWideStrategy(latestContextStats)}</span>
                  <span>{Number(latestContextStats?.estimated_input_tokens || 0) || "-"} tokens</span>
                </div>
                {latestSources.length > 0 ? (
                  <div className="v35-chat-wide-source-list">
                    {latestSources.map((source) => (
                      <button key={source.doc_id} type="button" title={source.doc_id} onClick={() => void navigator.clipboard?.writeText(source.doc_id)}>
                        <strong>{source.source_id ? `[${source.source_id}] ` : ""}{source.display_name}</strong>
                        <span>{source.title || source.doc_id}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="v35-muted">发送后显示纳入范围</p>
                )}
              </div>
            ) : activeMode === "agent" ? (
              <div className="v35-chat-wide-scope">
                <div className="v35-chat-wide-meter">
                  <span><strong>{agentIndexCount}</strong><em>索引</em></span>
                  <span><strong>{agentPaperCount}</strong><em>原文</em></span>
                  <span><strong>{latestSources.length}</strong><em>总计</em></span>
                </div>
                {latestSources.length > 0 ? (
                  <div className="v35-chat-wide-source-list">
                    {latestSources.map((source) => (
                      <button key={`${source.source_kind || "index"}:${source.doc_id}:${source.source_id || ""}`} type="button" title={source.doc_id} onClick={() => void navigator.clipboard?.writeText(source.doc_id)}>
                        <strong>{source.source_id ? `[${source.source_id}] ` : ""}{source.display_name}</strong>
                        <span>{formatSourceMeta(source) || source.doc_id}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="v35-muted">发送后显示本轮读取来源</p>
                )}
              </div>
            ) : (
              null
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}
