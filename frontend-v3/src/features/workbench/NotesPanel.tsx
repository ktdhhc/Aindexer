import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useRef } from "react";

import type { WorkbenchChatMessage } from "../../app/workbenchChatStore";
import { resolveAssistantCitedSources, stripAssistantCitationFooter } from "../../shared/api/chat";
import { renderMarkdownToHtml } from "./utils";

function ChatIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h7A2.5 2.5 0 0 1 16 5.5v5A2.5 2.5 0 0 1 13.5 13H9l-3.5 3v-3H6.5A2.5 2.5 0 0 1 4 10.5z" />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M15.5 6.5V3.5h-3" />
      <path d="M14.8 10a4.8 4.8 0 1 1-1.3-3.3" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="6" y="6" width="8" height="8" rx="1.5" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10 16 4l-3.5 12-2.8-4.2z" />
      <path d="m9.7 11.8 3.1-3.1" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="7" y="5" width="8" height="10" rx="1.5" />
      <path d="M5.5 12.5H5A2 2 0 0 1 3 10.5v-6A2 2 0 0 1 5 2.5h6A2 2 0 0 1 13 4.5V5" />
    </svg>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

interface NotesPanelProps {
  selectedDocId: string;
  chatMessages: WorkbenchChatMessage[];
  chatQuestion: string;
  chatStatus: string;
  chatPending: boolean;
  chatAvailable: boolean;
  onChatQuestionChange: (value: string) => void;
  onChatSubmit: () => void;
  onChatStop: () => void;
  onChatReset: () => void;
}

export function NotesPanel({
  selectedDocId,
  chatMessages,
  chatQuestion,
  chatStatus,
  chatPending,
  chatAvailable,
  onChatQuestionChange,
  onChatSubmit,
  onChatStop,
  onChatReset,
}: NotesPanelProps) {
  const threadRef = useRef<HTMLDivElement>(null);

  const latestAssistantText = useMemo(() => {
    const latest = [...chatMessages].reverse().find((message) => message.role === "assistant");
    return latest ? stripAssistantCitationFooter(latest.content).trim() : "";
  }, [chatMessages]);

  useEffect(() => {
    const node = threadRef.current;
    if (!node) return;
    requestAnimationFrame(() => {
      node.scrollTo({ top: node.scrollHeight, behavior: "auto" });
    });
  }, [chatMessages, chatPending]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onChatSubmit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    onChatSubmit();
  };

  return (
    <aside className="v35-panel v35-column v35-notes-chat-panel" aria-label="文献问答面板">
      <header className="v35-column-header v35-notes-chat-header">
        <div className="v35-notes-chat-titleblock">
          <span className="v35-notes-chat-mark" aria-hidden="true"><ChatIcon /></span>
          <h2 className="v35-section-title">Chat</h2>
        </div>
        <div className="v35-column-actions">
          {chatPending ? (
            <button className="v35-icon-button" type="button" aria-label="停止回答" title="停止" onClick={onChatStop}>
              <StopIcon />
            </button>
          ) : null}
          <button className="v35-icon-button" type="button" aria-label="重置会话" title="重置" onClick={onChatReset} disabled={!selectedDocId}>
            <ResetIcon />
          </button>
        </div>
      </header>

      <div className="v35-notes-chat-thread" ref={threadRef}>
        {chatMessages.length === 0 ? (
          <div className="v35-notes-chat-empty">
            <span>{chatAvailable ? chatStatus : "Idle"}</span>
          </div>
        ) : null}

        {chatMessages.map((message) => {
          const displayContent = message.role === "assistant" ? stripAssistantCitationFooter(message.content) : message.content;
          const displaySources = message.role === "assistant" ? resolveAssistantCitedSources(message.content, message.sources) : [];
          const isLiveAssistant = message.role === "assistant" && chatPending && message === chatMessages[chatMessages.length - 1];
          return (
            <article className={`v35-notes-chat-turn role-${message.role}`} key={message.id}>
              <header>
                <span>{message.role === "user" ? "You" : message.role === "assistant" ? "Assistant" : "System"}</span>
                <time>{formatTime(message.createdAt)}</time>
              </header>
              {message.role === "assistant" ? (
                displayContent.trim()
                  ? <div className="v35-chat-markdown" dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(displayContent) }} />
                  : isLiveAssistant
                    ? <p className="v35-notes-chat-waiting" aria-label={chatStatus}><span className="v35-chat-dot" /></p>
                    : null
              ) : (
                <p>{displayContent}</p>
              )}
              <footer>
                {displaySources.map((source) => (
                  <span className="v35-notes-chat-source" key={`${source.source_kind || "index"}:${source.doc_id}:${source.source_id || ""}`}>
                    {source.source_id ? `[${source.source_id}]` : source.display_name}
                  </span>
                ))}
                {message.role === "assistant" && displayContent.trim() ? (
                  <button
                    className="v35-icon-button"
                    type="button"
                    aria-label="复制回答"
                    title="复制"
                    onClick={() => {
                      void navigator.clipboard?.writeText(displayContent);
                    }}
                  >
                    <CopyIcon />
                  </button>
                ) : null}
              </footer>
            </article>
          );
        })}
      </div>

      <form className="v35-notes-chat-composer" onSubmit={handleSubmit}>
        <textarea
          value={chatQuestion}
          onChange={(event) => {
            onChatQuestionChange(event.target.value);
          }}
          onKeyDown={handleKeyDown}
          placeholder={chatAvailable ? "Ask" : "-"}
          disabled={!chatAvailable || chatPending}
        />
        <div className="v35-notes-chat-composer-bar">
          <span>{chatStatus}</span>
          <div className="v35-column-actions">
            {latestAssistantText ? (
              <button
                className="v35-icon-button"
                type="button"
                aria-label="复制最后回答"
                title="复制最后回答"
                onClick={() => {
                  void navigator.clipboard?.writeText(latestAssistantText);
                }}
              >
                <CopyIcon />
              </button>
            ) : null}
            <button className="v35-icon-button" type="submit" aria-label="发送问题" title="发送" disabled={!chatAvailable || !chatQuestion.trim() || chatPending}>
              <SendIcon />
            </button>
          </div>
        </div>
      </form>
    </aside>
  );
}
