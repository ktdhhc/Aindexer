import type { FormEvent } from "react";

import type { FileItem } from "../../shared/api/files";
import type { SearchItem } from "../../shared/api/search";
import { compactAuthors, formatQueueStatus, isRunningStatus } from "./utils";

interface LibraryPanelProps {
  rows: SearchItem[];
  filesById: Map<string, FileItem>;
  selectedDocId: string;
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  onSearchSubmit: () => void;
  onSelect: (docId: string) => void;
  onRun: (docId: string) => void;
  onCancel: (docId: string) => void;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  runPending: boolean;
  cancelPending: boolean;
}

export function LibraryPanel({
  rows,
  filesById,
  selectedDocId,
  searchInput,
  onSearchInputChange,
  onSearchSubmit,
  onSelect,
  onRun,
  onCancel,
  isLoading,
  isFetching,
  isError,
  runPending,
  cancelPending,
}: LibraryPanelProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSearchSubmit();
  };

  return (
    <aside className="v35-panel v35-column v35-library-panel" aria-label="文献列表">
      <header className="v35-column-header">
        <div>
          <h2 className="v35-section-title">Library</h2>
          <p className="v35-muted">按最近更新时间排序</p>
        </div>
      </header>

      <form className="v35-search-box" onSubmit={handleSubmit}>
        <input
          className="v35-input"
          value={searchInput}
          onChange={(event) => {
            onSearchInputChange(event.target.value);
          }}
          placeholder="搜索文献、作者、关键词"
        />
      </form>

      <div className="v35-library-list">
        {isLoading ? <p className="v35-muted">正在加载文献...</p> : null}
        {isFetching && !isLoading ? <p className="v35-muted">搜索中...</p> : null}
        {isError ? <p className="v35-error">搜索失败，请稍后重试</p> : null}
        {!isLoading && rows.length === 0 ? <p className="v35-muted">当前工作区暂无文献</p> : null}

        {rows.map((row) => {
          const fileRow = filesById.get(row.doc_id);
          const status = fileRow?.status || row.status;
          const stage = fileRow?.stage || "uploaded";
          const stageMessage = fileRow?.stage_message || "";
          const running = isRunningStatus(status, stage);
          const statusMeta = formatQueueStatus(status, stage);

          return (
            <article
              key={row.doc_id}
              className={`v35-paper-row ${selectedDocId === row.doc_id ? "is-active" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => {
                onSelect(row.doc_id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(row.doc_id);
                }
              }}
            >
              <div className="v35-row-status">
                <h3>{row.display_name || row.filename || row.doc_id}</h3>
                <span className={`v35-status is-${statusMeta.tone}`}>{statusMeta.label}</span>
              </div>
              <p>{compactAuthors(row.authors)} · {row.year || "-"}</p>
              {stageMessage ? <p className="v35-row-stage">{stageMessage}</p> : null}
              <div className="v35-row-actions">
                {running ? (
                  <button
                    type="button"
                    className="v35-button"
                    disabled={cancelPending}
                    onClick={(event) => {
                      event.stopPropagation();
                      onCancel(row.doc_id);
                    }}
                  >
                    取消
                  </button>
                ) : (
                  <button
                    type="button"
                    className="v35-button"
                    disabled={runPending}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRun(row.doc_id);
                    }}
                  >
                    索引
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </aside>
  );
}
