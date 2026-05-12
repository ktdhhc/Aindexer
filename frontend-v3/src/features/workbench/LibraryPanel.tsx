import type { FormEvent } from "react";

import type { FileItem } from "../../shared/api/files";
import type { SearchItem } from "../../shared/api/search";
import { isDesktopShell } from "../../shared/lib/runtime";
import { formatCompactStage, formatQueueStatusWithFailure, isRunningStatus } from "./utils";

type LibrarySortField = "display_name" | "authors" | "year" | "modified_at";
type LibrarySortDirection = "asc" | "desc";

interface LibraryPanelProps {
  rows: SearchItem[];
  filesById: Map<string, FileItem>;
  selectedDocId: string;
  multiSelectMode: boolean;
  selectedBulkDocIds: string[];
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  onSearchSubmit: () => void;
  sortField: LibrarySortField;
  sortDirection: LibrarySortDirection;
  onSortFieldChange: (value: LibrarySortField) => void;
  onSortDirectionChange: (value: LibrarySortDirection) => void;
  onRefresh: () => void;
  onSelect: (docId: string) => void;
  onToggleMultiSelectMode: () => void;
  onToggleBulkDocId: (docId: string) => void;
  indexableCount: number;
  selectedBulkCount: number;
  runAllDisabled: boolean;
  onRunAll: () => void;
  onBulkDelete: () => void;
  onBulkRegenerate: () => void;
  onBulkExportTxt: () => void;
  bulkDeleteDisabled: boolean;
  bulkRegenerateDisabled: boolean;
  bulkExportDisabled: boolean;
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

function SelectIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="4.5" y="4.5" width="11" height="11" rx="2.2" />
      <path d="m7.6 10 1.7 1.7 3.4-3.4" />
    </svg>
  );
}

function TxtIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5 6.2h10" />
      <path d="M8.2 6.2v7.6" />
      <path d="M11.8 6.2v7.6" />
      <path d="M6.4 13.8h6.8" />
    </svg>
  );
}

function StageIcon({ tone }: { tone: "ok" | "warn" | "error" | "muted" | "default" }) {
  return (
    <span className={`v35-stage-dot is-${tone}`} aria-hidden="true" />
  );
}

function stripDocumentExtension(value: string): string {
  return value.replace(/\.(pdf|txt|docx)$/i, "");
}

export function LibraryPanel({
  rows,
  filesById,
  selectedDocId,
  multiSelectMode,
  selectedBulkDocIds,
  searchInput,
  onSearchInputChange,
  onSearchSubmit,
  sortField,
  sortDirection,
  onSortFieldChange,
  onSortDirectionChange,
  onRefresh,
  onSelect,
  onToggleMultiSelectMode,
  onToggleBulkDocId,
  indexableCount,
  selectedBulkCount,
  runAllDisabled,
  onRunAll,
  onBulkDelete,
  onBulkRegenerate,
  onBulkExportTxt,
  bulkDeleteDisabled,
  bulkRegenerateDisabled,
  bulkExportDisabled,
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
  const selectedBulkDocIdSet = new Set(selectedBulkDocIds);
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
            className={`v35-button v35-button-compact v35-workbench-icon-button ${multiSelectMode ? "is-active" : ""}`}
            title="多选"
            aria-label="多选"
            onClick={onToggleMultiSelectMode}
          >
            <SelectIcon />
          </button>
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

      {multiSelectMode ? (
        <div className="v35-library-batchbar" aria-label="批量操作">
          <span className="v35-status is-muted">{selectedBulkCount}</span>
          <div className="v35-library-batch-actions">
            <button type="button" className="v35-button v35-button-compact v35-workbench-icon-button" title="重新生成" aria-label="重新生成" disabled={bulkRegenerateDisabled} onClick={onBulkRegenerate}><RegenerateIcon /></button>
            <button type="button" className="v35-button v35-button-compact v35-workbench-icon-button" title="导出 TXT" aria-label="导出 TXT" disabled={bulkExportDisabled} onClick={onBulkExportTxt}><TxtIcon /></button>
            <button type="button" className="v35-button v35-button-compact v35-workbench-icon-button v35-button-danger" title="删除" aria-label="删除" disabled={bulkDeleteDisabled} onClick={onBulkDelete}><DeleteIcon /></button>
          </div>
        </div>
      ) : null}

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
          const statusMeta = formatQueueStatusWithFailure(status, stage, fileRow?.failure_label);
          const compactStage = formatCompactStage(status, stage);
          const runTitle = status === "uploaded" ? "生成索引" : "重新生成索引";
          const rawProgress = Number(fileRow?.progress ?? (running ? 5 : status === "indexed" ? 100 : 0));
          const progress = Math.max(0, Math.min(100, Number.isFinite(rawProgress) ? rawProgress : 0));
          const showProgress = running;
          const fileType = String(fileRow?.file_type || "").trim().toUpperCase();
          const hasYear = typeof row.year === "number" && Number.isFinite(row.year);
          const displayName = stripDocumentExtension(row.display_name || row.filename || row.doc_id);
          const showStageChip = running && compactStage.label !== statusMeta.label;
          const bulkSelected = selectedBulkDocIdSet.has(row.doc_id);

          return (
            <article
              key={row.doc_id}
              className={`v35-paper-row ${selectedDocId === row.doc_id ? "is-active" : ""} ${multiSelectMode ? "is-multi-mode" : ""} ${bulkSelected ? "is-multi-selected" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => {
                if (multiSelectMode) {
                  onToggleBulkDocId(row.doc_id);
                  return;
                }
                onSelect(row.doc_id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  if (multiSelectMode) {
                    onToggleBulkDocId(row.doc_id);
                    return;
                  }
                  onSelect(row.doc_id);
                }
              }}
            >
              <div className="v35-row-status">
                <h3 title={displayName}>{displayName}</h3>
                {multiSelectMode ? <span className={`v35-row-selector ${bulkSelected ? "is-selected" : ""}`} aria-hidden="true" /> : null}
              </div>
              <div className="v35-row-meta" title={stageMessage || undefined}>
                {fileType ? <span className="v35-mini-chip">{fileType}</span> : null}
                {hasYear ? <span className="v35-mini-chip">{row.year}</span> : null}
                <span className={`v35-mini-chip is-${statusMeta.tone}`}>
                  <StageIcon tone={statusMeta.tone} />
                  {statusMeta.label}
                </span>
                {showStageChip ? (
                  <span className={`v35-mini-chip is-${compactStage.tone}`}>
                    <StageIcon tone={compactStage.tone} />
                    {compactStage.label}
                  </span>
                ) : null}
              </div>
              <div className="v35-row-actions">
                {multiSelectMode ? null : running ? (
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
              {showProgress ? (
                <div
                  className="v35-index-progress is-edge is-running"
                  aria-label="索引进行中"
                >
                  <i className="v35-index-progress-track" aria-hidden="true">
                    <span className="v35-index-progress-fill" style={{ width: `${Math.max(progress, 6)}%` }} />
                  </i>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </aside>
  );
}
