import type { FormEvent } from "react";

import type { FileItem } from "../../shared/api/files";
import type { SearchItem } from "../../shared/api/search";
import { isDesktopShell } from "../../shared/lib/runtime";
import { formatQueueStatus, isRunningStatus } from "./utils";

type LibrarySortField = "display_name" | "authors" | "year" | "modified_at";
type LibrarySortDirection = "asc" | "desc";

interface LibraryPanelProps {
  rows: SearchItem[];
  filesById: Map<string, FileItem>;
  selectedDocId: string;
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  onSearchSubmit: () => void;
  sortField: LibrarySortField;
  sortDirection: LibrarySortDirection;
  onSortFieldChange: (value: LibrarySortField) => void;
  onSortDirectionChange: (value: LibrarySortDirection) => void;
  onRefresh: () => void;
  onSelect: (docId: string) => void;
  indexableCount: number;
  runAllDisabled: boolean;
  onRunAll: () => void;
  onRun: (docId: string) => void;
  onCancel: (docId: string) => void;
  onDelete: (docId: string) => void;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  runPending: boolean;
  cancelPending: boolean;
  deletePending: boolean;
}

function BatchRunIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4.5 10h6" />
      <path d="m8 6.5 3.5 3.5L8 13.5" />
      <path d="M4.5 5h11" />
      <path d="M4.5 15h11" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M16 10a6 6 0 1 1-1.6-4.1" />
      <path d="M16 4.5v3.8h-3.8" />
    </svg>
  );
}

function RunIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m7 5 7 5-7 5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function RegenerateIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M15 10a5 5 0 1 1-1.4-3.5" />
      <path d="M15 5.5v3.2h-3.2" />
    </svg>
  );
}

function CancelIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M6 6l8 8" />
      <path d="m14 6-8 8" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5.5 6.5h9" />
      <path d="M8 6.5V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5" />
      <path d="M7 6.5l.6 8a1 1 0 0 0 1 .9h2.8a1 1 0 0 0 1-.9l.6-8" />
    </svg>
  );
}

export function LibraryPanel({
  rows,
  filesById,
  selectedDocId,
  searchInput,
  onSearchInputChange,
  onSearchSubmit,
  sortField,
  sortDirection,
  onSortFieldChange,
  onSortDirectionChange,
  onRefresh,
  onSelect,
  indexableCount,
  runAllDisabled,
  onRunAll,
  onRun,
  onCancel,
  onDelete,
  isLoading,
  isFetching,
  isError,
  runPending,
  cancelPending,
  deletePending,
}: LibraryPanelProps) {
  const desktopShell = isDesktopShell();
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSearchSubmit();
  };

  return (
    <aside className="v35-panel v35-column v35-library-panel" aria-label="文献列表">
      <header className="v35-column-header">
        <div>
          <h2 className="v35-section-title">Library</h2>
          <p className="v35-muted">{indexableCount} 待索引</p>
        </div>
        <div className="v35-column-actions">
          <button
            type="button"
            className="v35-button v35-button-compact v35-workbench-icon-button"
            title="刷新文库"
            aria-label="刷新文库"
            onClick={onRefresh}
          >
            <RefreshIcon />
          </button>
          <button
            type="button"
            className="v35-button v35-button-primary v35-button-compact v35-workbench-icon-button"
            title="一键生成全部未索引文献"
            aria-label="一键生成全部未索引文献"
            disabled={runAllDisabled}
            onClick={onRunAll}
          >
            <BatchRunIcon />
          </button>
        </div>
      </header>

      <form className="v35-search-box" onSubmit={handleSubmit}>
        <input
          className="v35-input"
          value={searchInput}
          onChange={(event) => {
            onSearchInputChange(event.target.value);
          }}
          placeholder={desktopShell ? "搜文献 / 作者 / 关键词" : "搜索文献、作者、关键词"}
        />
      </form>

      <div className="v35-library-sortbar" aria-label="文献排序">
        <label className="v35-field" htmlFor="v35LibrarySortField">
          <select
            id="v35LibrarySortField"
            className="v35-input"
            value={sortField}
            onChange={(event) => {
              onSortFieldChange(event.target.value as LibrarySortField);
            }}
          >
            <option value="display_name">显示名</option>
            <option value="authors">作者</option>
            <option value="year">年份</option>
            <option value="modified_at">修改时间</option>
          </select>
        </label>

        <label className="v35-field" htmlFor="v35LibrarySortDirection">
          <select
            id="v35LibrarySortDirection"
            className="v35-input"
            value={sortDirection}
            onChange={(event) => {
              onSortDirectionChange(event.target.value as LibrarySortDirection);
            }}
          >
            <option value="asc">顺序</option>
            <option value="desc">逆序</option>
          </select>
        </label>
      </div>

      <div className="v35-library-list">
        {isLoading ? <p className="v35-muted">正在加载文献...</p> : null}
        {isFetching && !isLoading ? <p className="v35-muted">搜索中...</p> : null}
        {isError ? <p className="v35-error">搜索失败，请稍后重试</p> : null}
        {!isLoading && rows.length === 0 ? <p className="v35-muted">当前工作区暂无文献</p> : null}

        {rows.map((row) => {
          const fileRow = filesById.get(row.doc_id);
          const status = fileRow?.status || row.status;
          const stage = fileRow?.stage || "uploaded";
          const stageMessage = fileRow?.stage_message === "索引生成完成" ? "" : (fileRow?.stage_message || "");
          const running = isRunningStatus(status, stage);
          const statusMeta = formatQueueStatus(status, stage);
          const runTitle = status === "uploaded" ? "生成索引" : "重新生成索引";

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
              {stageMessage ? <p className="v35-row-stage">{stageMessage}</p> : null}
              <div className="v35-row-actions">
                {running ? (
                  <button
                    type="button"
                    className="v35-button v35-button-compact v35-workbench-icon-button"
                    disabled={cancelPending}
                    title="取消索引"
                    aria-label="取消索引"
                    onClick={(event) => {
                      event.stopPropagation();
                      onCancel(row.doc_id);
                    }}
                  >
                    <CancelIcon />
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="v35-button v35-button-primary v35-button-compact v35-workbench-icon-button"
                      disabled={runPending}
                      title={runTitle}
                      aria-label={runTitle}
                      onClick={(event) => {
                        event.stopPropagation();
                        onRun(row.doc_id);
                      }}
                    >
                      {status === "uploaded" ? <RunIcon /> : <RegenerateIcon />}
                    </button>
                    <button
                      type="button"
                      className="v35-button v35-button-compact v35-workbench-icon-button v35-button-danger"
                      disabled={deletePending}
                      title="删除文献"
                      aria-label="删除文献"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDelete(row.doc_id);
                      }}
                    >
                      <DeleteIcon />
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </aside>
  );
}
