import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getDefaultWorkbenchPageSession, usePageSessionStore, type WorkbenchSortDirection, type WorkbenchSortField } from "../app/pageSessionStore";
import { getWorkbenchChatSessionKey, useWorkbenchChatStore } from "../app/workbenchChatStore";
import { useWorkspaceStore } from "../app/workspaceStore";
import { CanvasPanel } from "../features/workbench/CanvasPanel";
import { LibraryBanner } from "../features/workbench/LibraryBanner";
import { LibraryPanel } from "../features/workbench/LibraryPanel";
import { NotesPanel } from "../features/workbench/NotesPanel";
import type { PreviewMode, WorkbenchStats } from "../features/workbench/types";
import { WorkbenchToolbar } from "../features/workbench/WorkbenchToolbar";
import {
  compactAuthors,
  extractTopKeywords,
  isRunningStatus,
  renderMarkdownToHtml,
} from "../features/workbench/utils";
import { listFieldTemplates } from "../shared/api/fields";
import { buildOriginalFileUrl, deleteFile, listFiles, uploadFile } from "../shared/api/files";
import type { FileItem } from "../shared/api/files";
import { buildExportMarkdownUrl } from "../shared/api/export";
import { getActiveIndexRuns, getIndexDetail, getIndexMarkdown, runAllIndexes, streamIndex, cancelIndex, updateIndexEditor, type IndexProgressEvent } from "../shared/api/index";
import { listProviders } from "../shared/api/providers";
import { searchDocuments } from "../shared/api/search";
import { getModelDefault, parseModelDefaultKey } from "../shared/lib/modelDefaults";
import { type ProviderModelEntry, useProviderModels } from "../shared/lib/providerModels";

function buildStats(totalRows: FileItem[]): WorkbenchStats {
  let indexed = 0;
  let running = 0;
  let review = 0;

  for (const row of totalRows) {
    if (row.status === "indexed") {
      indexed += 1;
      continue;
    }
    if (isRunningStatus(row.status, row.stage)) {
      running += 1;
      continue;
    }
    if (row.status === "needs_review" || row.status === "failed") {
      review += 1;
    }
  }

  return {
    total: totalRows.length,
    indexed,
    running,
    review,
  };
}

function normalizeLibrarySearchText(value: string | number | null | undefined): string {
  return String(value || "").trim().toLowerCase();
}

function matchesLibrarySearch(
  row: Awaited<ReturnType<typeof searchDocuments>>[number],
  query: string,
): boolean {
  const normalizedQuery = normalizeLibrarySearchText(query);
  if (!normalizedQuery) {
    return true;
  }

  const metadata = [
    row.display_name,
    row.filename,
    row.title,
    row.year ? String(row.year) : "",
    ...(row.authors || []),
    ...(row.keywords || []),
  ]
    .map((value) => normalizeLibrarySearchText(value))
    .filter(Boolean);

  return metadata.some((value) => value.includes(normalizedQuery));
}

function applyIndexProgressEvent(current: FileItem[] | undefined, event: IndexProgressEvent): FileItem[] | undefined {
  if (!current) return current;
  return current.map((item) => {
    if (item.id !== event.doc_id) return item;
    return {
      ...item,
      status: event.status,
      stage: event.stage,
      stage_message: event.stage_message ?? item.stage_message,
      error_message: event.error_message ?? item.error_message,
      progress: event.progress,
      output_seen_tokens: event.output_seen_tokens ?? item.output_seen_tokens,
      output_budget_tokens: event.output_budget_tokens ?? item.output_budget_tokens,
      failure_code: event.failure_code ?? item.failure_code,
      failure_label: event.failure_label ?? item.failure_label,
    };
  });
}

export function WorkbenchPage() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceStore((state) => state.workspaceId);
  const workbenchSession = usePageSessionStore((state) => state.workbenchByWorkspace[workspaceId] ?? getDefaultWorkbenchPageSession());
  const ensureWorkbenchSession = usePageSessionStore((state) => state.ensureWorkbenchSession);
  const updateWorkbenchSession = usePageSessionStore((state) => state.updateWorkbenchSession);

  const provider = workbenchSession.provider;
  const model = workbenchSession.model;
  const templateId = workbenchSession.templateId;
  const searchInput = workbenchSession.searchInput;
  const searchSortField = workbenchSession.searchSortField;
  const searchSortDirection = workbenchSession.searchSortDirection;
  const selectedDocId = workbenchSession.selectedDocId;
  const previewMode = workbenchSession.previewMode as PreviewMode;
  const setProvider = useCallback((next: string) => {
    updateWorkbenchSession(workspaceId, { provider: next });
  }, [updateWorkbenchSession, workspaceId]);
  const setModel = useCallback((next: string) => {
    updateWorkbenchSession(workspaceId, { model: next });
  }, [updateWorkbenchSession, workspaceId]);
  const setTemplateId = useCallback((next: string) => {
    updateWorkbenchSession(workspaceId, { templateId: next });
  }, [updateWorkbenchSession, workspaceId]);
  const setSearchInput = useCallback((next: string) => {
    updateWorkbenchSession(workspaceId, { searchInput: next });
  }, [updateWorkbenchSession, workspaceId]);
  const setSearchSortField = useCallback((next: WorkbenchSortField) => {
    updateWorkbenchSession(workspaceId, { searchSortField: next });
  }, [updateWorkbenchSession, workspaceId]);
  const setSearchSortDirection = useCallback((next: WorkbenchSortDirection) => {
    updateWorkbenchSession(workspaceId, { searchSortDirection: next });
  }, [updateWorkbenchSession, workspaceId]);
  const setSelectedDocId = useCallback((next: string) => {
    updateWorkbenchSession(workspaceId, { selectedDocId: next });
  }, [updateWorkbenchSession, workspaceId]);
  const setPreviewMode = useCallback((next: PreviewMode) => {
    updateWorkbenchSession(workspaceId, { previewMode: next });
  }, [updateWorkbenchSession, workspaceId]);
  const [isEditingPreview, setIsEditingPreview] = useState(false);
  const [previewDraft, setPreviewDraft] = useState("");
  const [previewDisplayNameDraft, setPreviewDisplayNameDraft] = useState("");
  const [previewTitleDraft, setPreviewTitleDraft] = useState("");
  const [previewYearDraft, setPreviewYearDraft] = useState("");
  const [chatQuestion, setChatQuestion] = useState("");
  const [statusText, setStatusText] = useState("准备就绪");
  const [streamingDocIds, setStreamingDocIds] = useState<string[]>([]);
  const ensureChatSession = useWorkbenchChatStore((state) => state.ensureSession);
  const submitChatQuestion = useWorkbenchChatStore((state) => state.submitQuestion);
  const stopChatGeneration = useWorkbenchChatStore((state) => state.stopGeneration);
  const resetChatSession = useWorkbenchChatStore((state) => state.resetSession);
  const deferredSearchQuery = useDeferredValue(searchInput.trim());

  const providersQuery = useQuery({
    queryKey: ["providers"],
    queryFn: listProviders,
  });

  const templatesQuery = useQuery({
    queryKey: ["field-templates"],
    queryFn: listFieldTemplates,
  });

  const activeIndexRunsQuery = useQuery({
    queryKey: ["index-runs-active"],
    queryFn: getActiveIndexRuns,
    refetchInterval: (query) => {
      const payload = query.state.data as Awaited<ReturnType<typeof getActiveIndexRuns>> | undefined;
      return payload?.active_total ? 1500 : false;
    },
  });

  const workspaceActiveRunCount = activeIndexRunsQuery.data?.active_by_workspace?.[workspaceId] ?? 0;
  const shouldPollLibraryFiles = workspaceActiveRunCount > streamingDocIds.length;

  const filesQuery = useQuery({
    queryKey: ["files", workspaceId],
    queryFn: () => listFiles(workspaceId),
    refetchInterval: shouldPollLibraryFiles ? 1500 : false,
  });

  const searchQueryResult = useQuery({
    queryKey: ["search", workspaceId],
    queryFn: () => searchDocuments(workspaceId, ""),
  });

  const previewQuery = useQuery({
    queryKey: ["index-markdown", workspaceId, selectedDocId],
    queryFn: () => getIndexMarkdown(selectedDocId, workspaceId),
    enabled: Boolean(selectedDocId),
    retry: false,
  });

  const indexDetailQuery = useQuery({
    queryKey: ["index-detail", workspaceId, selectedDocId],
    queryFn: () => getIndexDetail(selectedDocId, workspaceId),
    enabled: Boolean(selectedDocId),
    retry: false,
  });

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      let uploaded = 0;
      let duplicated = 0;
      for (const file of files) {
        const result = await uploadFile(file, workspaceId);
        if (result.duplicate) {
          duplicated += 1;
        } else {
          uploaded += 1;
        }
      }
      return { uploaded, duplicated };
    },
    onSuccess: async ({ uploaded, duplicated }) => {
      setStatusText(`上传完成：新增 ${uploaded}，重复 ${duplicated}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["files", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["search", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["index-runs-active"] }),
      ]);
    },
    onError: (error) => {
      setStatusText(error instanceof Error ? error.message : "上传失败");
    },
  });

  const runAllMutation = useMutation({
    mutationFn: async () => {
      if (!provider) {
        throw new Error("请先选择 Provider");
      }
      return runAllIndexes(workspaceId, provider, model.trim() || null, templateId);
    },
    onSuccess: async (result) => {
      setStatusText(`批量索引已启动：${result.queued} 条，跳过 ${result.skipped} 条`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["files", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["search", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["index-runs-active"] }),
      ]);
    },
    onError: (error) => {
      setStatusText(error instanceof Error ? error.message : "批量索引失败");
    },
  });

  const runMutation = useMutation({
    onMutate: async (docId: string) => {
      setStreamingDocIds((current) => (current.includes(docId) ? current : [...current, docId]));
      setStatusText("索引任务已启动");
      await queryClient.invalidateQueries({ queryKey: ["index-runs-active"] });
      queryClient.setQueryData<FileItem[]>(["files", workspaceId], (current) => {
        if (!current) return current;
        return current.map((item) => {
          if (item.id !== docId) return item;
          return {
            ...item,
            status: "parsing",
            stage: "queued",
            stage_message: "任务已加入队列",
            progress: Math.max(5, Number(item.progress ?? 0)),
            failure_code: null,
            failure_label: null,
            error_message: null,
          };
        });
      });
    },
    mutationFn: async (docId: string) => {
      if (!provider) {
        throw new Error("请先选择 Provider");
      }
      return streamIndex(docId, workspaceId, provider, model.trim() || null, templateId, (event) => {
        queryClient.setQueryData<FileItem[]>(["files", workspaceId], (current) => applyIndexProgressEvent(current, event));
      });
    },
    onSuccess: async () => {
      setStatusText("索引任务已完成");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["files", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["search", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["index-runs-active"] }),
      ]);
    },
    onError: (error) => {
      setStatusText(error instanceof Error ? error.message : "索引启动失败");
    },
    onSettled: async (_data, _error, docId) => {
      setStreamingDocIds((current) => current.filter((item) => item !== docId));
      await queryClient.invalidateQueries({ queryKey: ["index-runs-active"] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (docId: string) => cancelIndex(docId, workspaceId),
    onSuccess: async () => {
      setStatusText("已发送取消请求");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["files", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["index-runs-active"] }),
      ]);
    },
    onError: (error) => {
      setStatusText(error instanceof Error ? error.message : "取消失败");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (docId: string) => deleteFile(docId, workspaceId),
    onSuccess: async (_, docId) => {
      setStatusText("文献已删除");
      if (selectedDocId === docId) {
        setSelectedDocId("");
        setIsEditingPreview(false);
        setPreviewDraft("");
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["files", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["search", workspaceId] }),
      ]);
    },
    onError: (error) => {
      setStatusText(error instanceof Error ? error.message : "删除失败");
    },
  });

  const savePreviewMutation = useMutation({
    mutationFn: async () => {
      if (!selectedDocId) {
        throw new Error("未选择文献");
      }
      const trimmedYear = previewYearDraft.trim();
      const nextYear = trimmedYear ? Number.parseInt(trimmedYear, 10) : null;
      if (trimmedYear && !Number.isFinite(nextYear)) {
        throw new Error("年份格式不正确");
      }
      return updateIndexEditor(selectedDocId, workspaceId, {
        display_name: previewDisplayNameDraft.trim(),
        title: previewTitleDraft.trim(),
        year: Number.isFinite(nextYear) ? nextYear : null,
        generated_at: indexDetailQuery.data?.updated_at || null,
        markdown: previewDraft,
      });
    },
    onSuccess: async () => {
      setStatusText("索引内容已保存");
      setIsEditingPreview(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["index-markdown", workspaceId, selectedDocId] }),
        queryClient.invalidateQueries({ queryKey: ["index-detail", workspaceId, selectedDocId] }),
        queryClient.invalidateQueries({ queryKey: ["search", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["files", workspaceId] }),
      ]);
    },
    onError: (error) => {
      setStatusText(error instanceof Error ? error.message : "保存失败");
    },
  });

  const fileRows = filesQuery.data ?? [];
  const providerRows = providersQuery.data ?? [];
  const indexingDefault = parseModelDefaultKey(getModelDefault("indexing"));
  const configuredProviderRow = useMemo(() => {
    return providerRows.find((item) => item.provider === provider) ?? null;
  }, [provider, providerRows]);

  const modelOptions = useProviderModels(provider, configuredProviderRow?.model);

  const searchRows = useMemo(() => {
    const rows = (searchQueryResult.data ?? []).filter((row) => matchesLibrarySearch(row, deferredSearchQuery));
    const factor = searchSortDirection === "asc" ? 1 : -1;
    return [...rows].sort((left, right) => {
      if (searchSortField === "modified_at") {
        return factor * String(left.created_at || "").localeCompare(String(right.created_at || ""));
      }
      if (searchSortField === "year") {
        return factor * ((left.year || 0) - (right.year || 0));
      }
      if (searchSortField === "authors") {
        const leftAuthors = (left.authors ?? []).join(", ") || "~";
        const rightAuthors = (right.authors ?? []).join(", ") || "~";
        return factor * leftAuthors.localeCompare(rightAuthors, "zh-Hans-CN");
      }
      const leftName = left.display_name || left.title || left.filename || left.doc_id;
      const rightName = right.display_name || right.title || right.filename || right.doc_id;
      return factor * leftName.localeCompare(rightName, "zh-Hans-CN");
    });
  }, [deferredSearchQuery, searchQueryResult.data, searchSortDirection, searchSortField]);

  const filesById = useMemo(() => {
    return new Map(fileRows.map((row) => [row.id, row]));
  }, [fileRows]);

  const selectedSearchRow = useMemo(() => {
    return searchRows.find((row) => row.doc_id === selectedDocId) ?? null;
  }, [searchRows, selectedDocId]);

  const selectedFileRow = useMemo(() => {
    return filesById.get(selectedDocId) ?? null;
  }, [filesById, selectedDocId]);

  const stats = useMemo(() => buildStats(fileRows), [fileRows]);
  const topKeywords = useMemo(() => extractTopKeywords(searchRows, 10), [searchRows]);

  const indexableCount = useMemo(() => {
    return fileRows.filter((row) => {
      if (isRunningStatus(row.status, row.stage)) {
        return false;
      }
      return ["uploaded", "needs_review", "failed", "cancelled"].includes(row.status);
    }).length;
  }, [fileRows]);

  const workspaceIndexingActive = Boolean(activeIndexRunsQuery.data?.active_by_workspace?.[workspaceId]);

  const previewMarkdown = previewQuery.data?.markdown || "";
  const previewHtml = useMemo(() => {
    if (!previewMarkdown) {
      return "";
    }
    return renderMarkdownToHtml(previewMarkdown);
  }, [previewMarkdown]);

  const selectedMeta = useMemo(() => {
    if (!selectedSearchRow && !selectedFileRow) {
      return "";
    }
    const sourceDocId = selectedSearchRow?.doc_id || selectedFileRow?.id || "-";
    const status = selectedFileRow?.status || selectedSearchRow?.status || "-";
    const stage = selectedFileRow?.stage || "-";
    const authors = selectedSearchRow?.authors ? compactAuthors(selectedSearchRow.authors) : "-";
    const year = selectedSearchRow?.year || "-";
    return `${sourceDocId} · ${authors} · ${year} · ${status}/${stage}`;
  }, [selectedFileRow, selectedSearchRow]);

  const canEditPreview = Boolean(selectedDocId && previewMarkdown && !previewQuery.isLoading && !previewQuery.isError);
  const chatSessionKey = selectedDocId ? getWorkbenchChatSessionKey(workspaceId, selectedDocId) : "";
  const selectedModelEntry = useMemo<ProviderModelEntry | null>(() => {
    if (!provider) return null;
    return { provider, model: model.trim() || "" };
  }, [model, provider]);
  const activeChatSession = useWorkbenchChatStore((state) => (chatSessionKey ? state.sessions[chatSessionKey] : undefined));
  const chatPending = useWorkbenchChatStore((state) => (chatSessionKey ? Boolean(state.sendingBySession[chatSessionKey]) : false));
  const chatStatus = useWorkbenchChatStore((state) => (chatSessionKey ? state.statusBySession[chatSessionKey] ?? "Ready" : "Idle"));
  const chatMessages = activeChatSession?.messages ?? [];
  const chatAvailable = Boolean(selectedDocId && selectedFileRow?.status === "indexed" && selectedModelEntry?.provider);

  useEffect(() => {
    ensureWorkbenchSession(workspaceId);
  }, [ensureWorkbenchSession, workspaceId]);

  useEffect(() => {
    setStreamingDocIds([]);
  }, [workspaceId]);

  useEffect(() => {
    if (providerRows.length === 0) {
      return;
    }
    if (!provider || !providerRows.some((item) => item.provider === provider)) {
      const defaultProvider =
        indexingDefault && providerRows.some((item) => item.enabled && item.provider === indexingDefault.provider)
          ? indexingDefault.provider
          : (providerRows.find((item) => item.enabled)?.provider ?? providerRows[0].provider);
      setProvider(defaultProvider);
    }
  }, [indexingDefault, provider, providerRows]);

  useEffect(() => {
    if (modelOptions.length === 0) {
      if (model) {
        setModel("");
      }
      return;
    }
    if (!model || !modelOptions.includes(model)) {
      const defaultModel =
        indexingDefault?.provider === provider && indexingDefault.model && modelOptions.includes(indexingDefault.model)
          ? indexingDefault.model
          : modelOptions[0];
      setModel(defaultModel);
    }
  }, [indexingDefault, model, modelOptions, provider]);

  useEffect(() => {
    const templates = templatesQuery.data;
    if (!templates || templates.length === 0) {
      return;
    }
    if (!templateId || !templates.some((item) => item.id === templateId)) {
      setTemplateId(templates[0].id);
    }
  }, [templateId, templatesQuery.data]);

  useEffect(() => {
    if (searchRows.length === 0) {
      setSelectedDocId("");
      setIsEditingPreview(false);
      setPreviewDraft("");
      setPreviewDisplayNameDraft("");
      setPreviewTitleDraft("");
      setPreviewYearDraft("");
      return;
    }
    if (!selectedDocId || !searchRows.some((row) => row.doc_id === selectedDocId)) {
      setSelectedDocId(searchRows[0].doc_id);
    }
  }, [searchRows, selectedDocId]);

  useEffect(() => {
    setChatQuestion("");
    if (!selectedDocId) {
      return;
    }
    ensureChatSession(workspaceId, selectedDocId);
  }, [ensureChatSession, selectedDocId, workspaceId]);

  useEffect(() => {
    if (isEditingPreview) {
      return;
    }
    setPreviewDraft(previewMarkdown);
    setPreviewDisplayNameDraft(selectedFileRow?.display_name || selectedSearchRow?.display_name || "");
    setPreviewTitleDraft(indexDetailQuery.data?.title || selectedSearchRow?.title || "");
    setPreviewYearDraft(indexDetailQuery.data?.year ? String(indexDetailQuery.data.year) : selectedSearchRow?.year ? String(selectedSearchRow.year) : "");
  }, [indexDetailQuery.data?.title, indexDetailQuery.data?.year, isEditingPreview, previewMarkdown, selectedDocId, selectedFileRow?.display_name, selectedSearchRow?.display_name, selectedSearchRow?.title, selectedSearchRow?.year]);

  const previousWorkspaceActiveRunCountRef = useRef(0);

  useEffect(() => {
    const previous = previousWorkspaceActiveRunCountRef.current;
    if (previous > 0 && workspaceActiveRunCount === 0) {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["files", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["search", workspaceId] }),
      ]);
    }
    previousWorkspaceActiveRunCountRef.current = workspaceActiveRunCount;
  }, [queryClient, workspaceActiveRunCount, workspaceId]);

  const selectedTitle = selectedSearchRow?.display_name || selectedSearchRow?.title || selectedFileRow?.display_name || "未选择文献";

  const handleSearchSubmit = () => {};

  const handleCopy = async () => {
    if (!previewMarkdown) {
      return;
    }
    try {
      await navigator.clipboard.writeText(previewMarkdown);
      setStatusText("预览内容已复制");
    } catch {
      setStatusText("复制失败，请手动复制");
    }
  };

  const handleRefresh = async () => {
    await Promise.all([
      filesQuery.refetch(),
      searchQueryResult.refetch(),
      activeIndexRunsQuery.refetch(),
      previewQuery.refetch(),
    ]);
    setStatusText("已刷新");
  };

  const handleStartEdit = () => {
    if (!canEditPreview) {
      return;
    }
    setPreviewDraft(previewMarkdown);
    setPreviewDisplayNameDraft(selectedFileRow?.display_name || selectedSearchRow?.display_name || "");
    setPreviewTitleDraft(indexDetailQuery.data?.title || selectedSearchRow?.title || "");
    setPreviewYearDraft(indexDetailQuery.data?.year ? String(indexDetailQuery.data.year) : selectedSearchRow?.year ? String(selectedSearchRow.year) : "");
    setPreviewMode("raw");
    setIsEditingPreview(true);
  };

  const handleCancelEdit = () => {
    setPreviewDraft(previewMarkdown);
    setPreviewDisplayNameDraft(selectedFileRow?.display_name || selectedSearchRow?.display_name || "");
    setPreviewTitleDraft(indexDetailQuery.data?.title || selectedSearchRow?.title || "");
    setPreviewYearDraft(indexDetailQuery.data?.year ? String(indexDetailQuery.data.year) : selectedSearchRow?.year ? String(selectedSearchRow.year) : "");
    setIsEditingPreview(false);
    setStatusText("已取消编辑");
  };

  const handleAskChat = async () => {
    const question = chatQuestion.trim();
    if (!question || !selectedDocId) {
      return;
    }
    setChatQuestion("");
    await submitChatQuestion({
      workspaceId,
      docId: selectedDocId,
      question,
      selectedModelEntry,
    });
  };

  return (
    <section className="v35-workbench-page">
      <LibraryBanner
        workspaceId={workspaceId}
        keywords={topKeywords}
        stats={stats}
        statusText={statusText}
      />

      <div className="v35-editorial-grid">
        <div className="v35-library-stack">
          <WorkbenchToolbar
            providers={providersQuery.data ?? []}
            selectedProvider={provider}
            onProviderChange={setProvider}
            modelOptions={modelOptions}
            selectedModel={model}
            onModelChange={setModel}
            templates={templatesQuery.data ?? []}
            selectedTemplateId={templateId}
            onTemplateChange={setTemplateId}
            controlsDisabled={workspaceIndexingActive}
            onUploadFiles={(files) => {
              void uploadMutation.mutateAsync(files);
            }}
          />

          <LibraryPanel
            rows={searchRows}
            filesById={filesById}
            selectedDocId={selectedDocId}
            searchInput={searchInput}
            onSearchInputChange={setSearchInput}
            onSearchSubmit={handleSearchSubmit}
            sortField={searchSortField}
            sortDirection={searchSortDirection}
            onSortFieldChange={setSearchSortField}
            onSortDirectionChange={setSearchSortDirection}
            onRefresh={() => {
              void handleRefresh();
            }}
            onSelect={setSelectedDocId}
            indexableCount={indexableCount}
            runAllDisabled={runAllMutation.isPending || !provider || indexableCount === 0}
            onRunAll={() => {
              void runAllMutation.mutateAsync();
            }}
            onRun={(docId) => {
              void runMutation.mutateAsync(docId);
            }}
            onCancel={(docId) => {
              void cancelMutation.mutateAsync(docId);
            }}
            onDelete={(docId) => {
              void deleteMutation.mutateAsync(docId);
            }}
            isLoading={searchQueryResult.isLoading}
            isFetching={searchQueryResult.isFetching}
            isError={searchQueryResult.isError}
            runPending={runMutation.isPending}
            cancelPending={cancelMutation.isPending}
            deletePending={deleteMutation.isPending}
          />
        </div>

        <CanvasPanel
          selectedDocId={selectedDocId}
          selectedTitle={selectedTitle}
          selectedMeta={selectedMeta}
          previewMarkdown={previewMarkdown}
          previewHtml={previewHtml}
          previewMode={previewMode}
          onPreviewModeChange={setPreviewMode}
          isEditing={isEditingPreview}
          previewDraft={previewDraft}
          onPreviewDraftChange={setPreviewDraft}
          previewDisplayNameDraft={previewDisplayNameDraft}
          onPreviewDisplayNameDraftChange={setPreviewDisplayNameDraft}
          previewTitleDraft={previewTitleDraft}
          onPreviewTitleDraftChange={setPreviewTitleDraft}
          previewYearDraft={previewYearDraft}
          onPreviewYearDraftChange={setPreviewYearDraft}
          onEditStart={handleStartEdit}
          onEditCancel={handleCancelEdit}
          onEditSave={() => {
            void savePreviewMutation.mutateAsync();
          }}
          onRefresh={() => {
            void previewQuery.refetch();
          }}
          onCopy={() => {
            void handleCopy();
          }}
          onOpenOriginal={() => {
            if (!selectedDocId) {
              return;
            }
            window.open(buildOriginalFileUrl(selectedDocId, workspaceId), "_blank", "noopener,noreferrer");
          }}
          onExport={() => {
            if (!selectedDocId) {
              return;
            }
            window.open(buildExportMarkdownUrl(selectedDocId, workspaceId), "_blank", "noopener,noreferrer");
          }}
          isLoading={previewQuery.isLoading}
          isError={previewQuery.isError}
          canEdit={canEditPreview}
          savePending={savePreviewMutation.isPending}
        />

        <NotesPanel
          selectedDocId={selectedDocId}
          chatMessages={chatMessages}
          chatQuestion={chatQuestion}
          chatStatus={chatStatus}
          chatPending={chatPending}
          chatAvailable={chatAvailable}
          onChatQuestionChange={setChatQuestion}
          onChatSubmit={() => {
            void handleAskChat();
          }}
          onChatStop={() => {
            if (!selectedDocId) {
              return;
            }
            stopChatGeneration(workspaceId, selectedDocId);
          }}
          onChatReset={() => {
            if (!selectedDocId) {
              return;
            }
            setChatQuestion("");
            resetChatSession(workspaceId, selectedDocId);
          }}
        />
      </div>
    </section>
  );
}
