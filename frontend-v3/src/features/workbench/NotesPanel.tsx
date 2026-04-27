import type { FormEvent } from "react";

import type { QueueItemView, WorkbenchStats, ChatMessage } from "./types";

interface NotesPanelProps {
  stats: WorkbenchStats;
  queueRows: QueueItemView[];
  onRun: (docId: string) => void;
  onCancel: (docId: string) => void;
  runPending: boolean;
  cancelPending: boolean;
  chatMessages: ChatMessage[];
  chatQuestion: string;
  onChatQuestionChange: (value: string) => void;
  onChatSubmit: () => void;
  chatPending: boolean;
}

export function NotesPanel({
  stats,
  queueRows,
  onRun,
  onCancel,
  runPending,
  cancelPending,
  chatMessages,
  chatQuestion,
  onChatQuestionChange,
  onChatSubmit,
  chatPending,
}: NotesPanelProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onChatSubmit();
  };

  return (
    <aside className="v35-panel v35-column" aria-label="Notes 面板">
      <header className="v35-column-header">
        <div>
          <h2 className="v35-section-title">Notes</h2>
          <p className="v35-muted">字段、任务、助手</p>
        </div>
      </header>

      <div className="v35-notes-body">
        <section className="v35-note-card">
          <h3 className="v35-section-title">字段摘要</h3>
          <div className="v35-evidence-list">
            <div className="v35-evidence-row"><span>文献总量</span><strong>{stats.total}</strong></div>
            <div className="v35-evidence-row"><span>已索引</span><strong>{stats.indexed}</strong></div>
            <div className="v35-evidence-row"><span>待审核</span><strong>{stats.review}</strong></div>
          </div>
        </section>

        <section className="v35-note-card">
          <h3 className="v35-section-title">后台任务</h3>
          {queueRows.length === 0 ? <p className="v35-muted">当前没有待处理任务。</p> : null}
          {queueRows.map((item) => (
            <article key={item.row.id} className="v35-queue-item">
              <div className="v35-row-status">
                <strong>{item.row.display_name || item.row.filename}</strong>
                <span className={`v35-status is-${item.tone}`}>{item.label}</span>
              </div>
              <p className="v35-muted">{item.row.stage_message || item.row.stage || "等待索引"}</p>
              <div className="v35-row-actions">
                {item.running ? (
                  <button
                    type="button"
                    className="v35-button"
                    disabled={cancelPending}
                    onClick={() => {
                      onCancel(item.row.id);
                    }}
                  >
                    取消
                  </button>
                ) : (
                  <button
                    type="button"
                    className="v35-button"
                    disabled={runPending}
                    onClick={() => {
                      onRun(item.row.id);
                    }}
                  >
                    索引
                  </button>
                )}
              </div>
            </article>
          ))}
        </section>

        <section className="v35-note-card">
          <h3 className="v35-section-title">Assistant</h3>
          <div className="v35-chat-log">
            {chatMessages.length === 0 ? <p className="v35-muted">输入问题后开始对话。</p> : null}
            {chatMessages.map((message) => (
              <article key={message.id} className={`v35-chat-message role-${message.role}`}>
                <p className="v35-chat-role">
                  {message.role === "user" ? "你" : message.role === "assistant" ? "助手" : "系统"}
                </p>
                <p>{message.content}</p>
                {message.meta ? <p className="v35-muted">{message.meta}</p> : null}
              </article>
            ))}
          </div>
        </section>

        <form className="v35-chat-input" onSubmit={handleSubmit}>
          <textarea
            value={chatQuestion}
            onChange={(event) => {
              onChatQuestionChange(event.target.value);
            }}
            placeholder="向当前工作区提问"
          />
          <button className="v35-button v35-button-primary" type="submit" disabled={chatPending}>
            {chatPending ? "发送中..." : "发送"}
          </button>
        </form>
      </div>
    </aside>
  );
}
