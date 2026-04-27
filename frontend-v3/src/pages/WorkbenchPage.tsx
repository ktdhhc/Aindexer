import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useWorkspaceStore } from "../app/workspaceStore";
import { CanvasPanel } from "../features/workbench/CanvasPanel";
import { LibraryBanner } from "../features/workbench/LibraryBanner";
import { LibraryPanel } from "../features/workbench/LibraryPanel";
import { NotesPanel } from "../features/workbench/NotesPanel";
import type { ChatMessage, PreviewMode, QueueItemView, WorkbenchStats } from "../features/workbench/types";
import { WorkbenchToolbar } from "../features/workbench/WorkbenchToolbar";
import {
  compactAuthors,
  extractTopKeywords,
  formatQueueStatus,
  isRunningStatus,
  nextMessageId,
  renderMarkdownToHtml,
  sortedQueueRows,
} from "../features/workbench/utils";
import { askChatV0 } from "../shared/api/chat";
import { listFieldTemplates } from "../shared/api/fields";
import { buildOriginalFileUrl, listFiles, uploadFile } from "../shared/api/files";
import type { FileItem } from "../shared/api/files";
import { buildExportMarkdownUrl } from "../shared/api/export";
import { getIndexMarkdown, runAllIndexes, runIndex, cancelIndex } from "../shared/api/index";
import { listProviders } from "../shared/api/providers";
import { searchDocuments } from "../shared/api/search";

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

export function WorkbenchPage() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceStore((state) => state.workspaceId);

  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [templateId, setTemplateId] = useState("tpl_default");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDocId, setSelectedDocId] = useState("");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("rendered");
  const [chatQuestion, setChatQuestion] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [statusText, setStatusText] = useState("准备就绪");

  const providersQuery = useQuery({
    queryKey: ["providers"],
    queryFn: listProviders,
  });

  const templatesQuery = useQuery({
    queryKey: ["field-templates"],
    queryFn: listFieldTemplates,
  });

  const filesQuery = useQuery({
    queryKey: ["files", workspaceId],
    queryFn: () => listFiles(workspaceId),
  });

  const searchQueryResult = useQuery({
    queryKey: ["search", workspaceId, searchQuery],
    queryFn: () => searchDocuments(workspaceId, searchQuery),
  });

  const previewQuery = useQuery({
    queryKey: ["index-markdown", workspaceId, selectedDocId],
    queryFn: () => getIndexMarkdown(selectedDocId, workspaceId),
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
      ]);
    },
    onError: (error) => {
      setStatusText(error instanceof Error ? error.message : "批量索引失败");
    },
  });

  const runMutation = useMutation({
    mutationFn: async (docId: string) => {
      if (!provider) {
        throw new Error("请先选择 Provider");
      }
      return runIndex(docId, workspaceId, provider, model.trim() || null, templateId);
    },
    onSuccess: async () => {
      setStatusText("索引任务已启动");
      await queryClient.invalidateQueries({ queryKey: ["files", workspaceId] });
    },
    onError: (error) => {
      setStatusText(error instanceof Error ? error.message : "索引启动失败");
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (docId: string) => cancelIndex(docId, workspaceId),
    onSuccess: async () => {
      setStatusText("已发送取消请求");
      await queryClient.invalidateQueries({ queryKey: ["files", workspaceId] });
    },
    onError: (error) => {
      setStatusText(error instanceof Error ? error.message : "取消失败");
    },
  });

  const chatMutation = useMutation({
    mutationFn: askChatV0,
  });

  const fileRows = filesQuery.data ?? [];
  const providerRows = providersQuery.data ?? [];

  const modelOptions = useMemo(() => {
    const options: string[] = [];
    for (const row of providerRows) {
      if (row.provider !== provider) {
        continue;
      }
      const modelName = String(row.model || "").trim();
      if (modelName && !options.includes(modelName)) {
        options.push(modelName);
      }
    }
    return options;
  }, [provider, providerRows]);

  const searchRows = useMemo(() => {
    return [...(searchQueryResult.data ?? [])].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  }, [searchQueryResult.data]);

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

  const queueRows = useMemo<QueueItemView[]>(() => {
    return sortedQueueRows(fileRows)
      .slice(0, 5)
      .map((row) => {
        const statusMeta = formatQueueStatus(row.status, row.stage);
        return {
          row,
          running: isRunningStatus(row.status, row.stage),
          label: statusMeta.label,
          tone: statusMeta.tone,
        };
      });
  }, [fileRows]);

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

  useEffect(() => {
    if (providerRows.length === 0) {
      return;
    }
    if (!provider || !providerRows.some((item) => item.provider === provider)) {
      setProvider(providerRows[0].provider);
    }
  }, [provider, providerRows]);

  useEffect(() => {
    if (modelOptions.length === 0) {
      if (model) {
        setModel("");
      }
      return;
    }
    if (!model || !modelOptions.includes(model)) {
      setModel(modelOptions[0]);
    }
  }, [model, modelOptions]);

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
      return;
    }
    if (!selectedDocId || !searchRows.some((row) => row.doc_id === selectedDocId)) {
      setSelectedDocId(searchRows[0].doc_id);
    }
  }, [searchRows, selectedDocId]);

  useEffect(() => {
    const hasRunning = fileRows.some((item) => isRunningStatus(item.status, item.stage));
    if (!hasRunning) {
      return;
    }
    const timer = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ["files", workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["search", workspaceId] });
    }, 2000);
    return () => {
      window.clearInterval(timer);
    };
  }, [fileRows, queryClient, workspaceId]);

  const selectedTitle = selectedSearchRow?.display_name || selectedSearchRow?.title || selectedFileRow?.display_name || "未选择文献";

  const handleSearchSubmit = () => {
    setSearchQuery(searchInput.trim());
  };

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
      previewQuery.refetch(),
    ]);
    setStatusText("已刷新");
  };

  const handleAskChat = async () => {
    const question = chatQuestion.trim();
    if (!question) {
      return;
    }
    if (!provider) {
      setChatMessages((current) => [
        ...current,
        { id: nextMessageId(), role: "system", content: "没有可用 Provider，请先完成 Provider 配置。" },
      ]);
      return;
    }

    setChatMessages((current) => [
      ...current,
      { id: nextMessageId(), role: "user", content: question },
    ]);
    setChatQuestion("");

    try {
      const result = await chatMutation.mutateAsync({
        question,
        provider,
        model: model.trim() || null,
        workspace_id: workspaceId,
      });
      setChatMessages((current) => [
        ...current,
        {
          id: nextMessageId(),
          role: "assistant",
          content: result.answer,
          meta: `来源：${result.display_name} (${result.doc_id})`,
        },
      ]);
    } catch (error) {
      setChatMessages((current) => [
        ...current,
        {
          id: nextMessageId(),
          role: "system",
          content: error instanceof Error ? error.message : "Chat 请求失败",
        },
      ]);
    }
  };

  return (
    <section className="v35-workbench-page">
      <LibraryBanner
        workspaceId={workspaceId}
        keywords={topKeywords}
        stats={stats}
        statusText={statusText}
      />

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
        runAllPending={runAllMutation.isPending}
        onRunAll={() => {
          void runAllMutation.mutateAsync();
        }}
        onRefresh={() => {
          void handleRefresh();
        }}
        onUploadFiles={(files) => {
          void uploadMutation.mutateAsync(files);
        }}
      />

      <div className="v35-editorial-grid">
        <LibraryPanel
          rows={searchRows}
          filesById={filesById}
          selectedDocId={selectedDocId}
          searchInput={searchInput}
          onSearchInputChange={setSearchInput}
          onSearchSubmit={handleSearchSubmit}
          onSelect={setSelectedDocId}
          onRun={(docId) => {
            void runMutation.mutateAsync(docId);
          }}
          onCancel={(docId) => {
            void cancelMutation.mutateAsync(docId);
          }}
          isLoading={searchQueryResult.isLoading}
          isFetching={searchQueryResult.isFetching}
          isError={searchQueryResult.isError}
          runPending={runMutation.isPending}
          cancelPending={cancelMutation.isPending}
        />

        <CanvasPanel
          selectedDocId={selectedDocId}
          selectedTitle={selectedTitle}
          selectedMeta={selectedMeta}
          previewMarkdown={previewMarkdown}
          previewHtml={previewHtml}
          previewMode={previewMode}
          onPreviewModeChange={setPreviewMode}
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
        />

        <NotesPanel
          stats={stats}
          queueRows={queueRows}
          onRun={(docId) => {
            void runMutation.mutateAsync(docId);
          }}
          onCancel={(docId) => {
            void cancelMutation.mutateAsync(docId);
          }}
          runPending={runMutation.isPending}
          cancelPending={cancelMutation.isPending}
          chatMessages={chatMessages}
          chatQuestion={chatQuestion}
          onChatQuestionChange={setChatQuestion}
          onChatSubmit={() => {
            void handleAskChat();
          }}
          chatPending={chatMutation.isPending}
        />
      </div>
    </section>
  );
}
