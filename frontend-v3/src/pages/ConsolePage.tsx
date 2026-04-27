import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useWorkspaceStore } from "../app/workspaceStore";
import { askChatV0 } from "../shared/api/chat";
import { listFieldTemplates } from "../shared/api/fields";
import { buildOriginalFileUrl, deleteFile, listFiles, uploadFile } from "../shared/api/files";
import { buildExportMarkdownUrl } from "../shared/api/export";
import { cancelIndex, getIndexDetail, getIndexMarkdown, runAllIndexes, runIndex, updateIndexEditor } from "../shared/api/index";
import { listProviders } from "../shared/api/providers";
import { searchDocuments } from "../shared/api/search";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  meta?: string;
}

type SearchSortField = "created" | "year" | "display";

function nextMessageId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function toDateInputValue(raw: string | null | undefined): string {
  if (!raw) {
    return "";
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function compactAuthors(authors: string[] | undefined): string {
  if (!authors || authors.length === 0) {
    return "-";
  }
  return authors.slice(0, 3).join(" / ");
}

function compactKeywords(keywords: string[] | undefined): string[] {
  if (!keywords || keywords.length === 0) {
    return [];
  }
  return keywords.slice(0, 3);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInlineMarkdown(raw: string): string {
  const escaped = escapeHtml(raw);
  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

function renderMarkdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let inUl = false;
  let inOl = false;

  const closeLists = () => {
    if (inUl) {
      html.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      html.push("</ol>");
      inOl = false;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      if (inCodeBlock) {
        html.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);
        inCodeBlock = false;
        codeLines = [];
      } else {
        closeLists();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(escapeHtml(line));
      continue;
    }

    if (!trimmed) {
      closeLists();
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      closeLists();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const ul = /^[-*+]\s+(.+)$/.exec(trimmed);
    if (ul) {
      if (!inUl) {
        if (inOl) {
          html.push("</ol>");
          inOl = false;
        }
        html.push("<ul>");
        inUl = true;
      }
      html.push(`<li>${renderInlineMarkdown(ul[1])}</li>`);
      continue;
    }

    const ol = /^\d+\.\s+(.+)$/.exec(trimmed);
    if (ol) {
      if (!inOl) {
        if (inUl) {
          html.push("</ul>");
          inUl = false;
        }
        html.push("<ol>");
        inOl = true;
      }
      html.push(`<li>${renderInlineMarkdown(ol[1])}</li>`);
      continue;
    }

    closeLists();
    if (trimmed.startsWith(">")) {
      html.push(`<blockquote>${renderInlineMarkdown(trimmed.replace(/^>\s?/, ""))}</blockquote>`);
      continue;
    }

    html.push(`<p>${renderInlineMarkdown(trimmed)}</p>`);
  }

  if (inCodeBlock) {
    html.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);
  }
  closeLists();
  return html.join("");
}

function formatQueueStatus(status: string, stage: string): { label: string; tone: "ok" | "warn" | "error" | "muted" | "default" } {
  if (status === "indexed") {
    return { label: "已索引", tone: "ok" };
  }
  if (status === "failed") {
    return { label: "失败", tone: "error" };
  }
  if (status === "needs_review") {
    return { label: "需审核", tone: "warn" };
  }
  if (status === "cancelled") {
    return { label: "已取消", tone: "muted" };
  }
  if (status === "parsing" || stage === "queued" || stage === "llm_request" || stage === "writing" || stage === "cancel_requested") {
    return { label: "处理中", tone: "warn" };
  }
  return { label: "待索引", tone: "default" };
}

export function ConsolePage() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceStore((state) => state.workspaceId);

  const [provider, setProvider] = useState("");
  const [fieldTemplateId, setFieldTemplateId] = useState("tpl_default");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchSortField, setSearchSortField] = useState<SearchSortField>("created");
  const [searchSortDirection, setSearchSortDirection] = useState<"asc" | "desc">("desc");
  const [searchSortOpen, setSearchSortOpen] = useState(false);
  const [selectedPreviewDocId, setSelectedPreviewDocId] = useState("");
  const [previewMode, setPreviewMode] = useState<"raw" | "rendered">("raw");
  const [isUploadDragOver, setIsUploadDragOver] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editorTitle, setEditorTitle] = useState("");
  const [editorYear, setEditorYear] = useState("");
  const [editorDate, setEditorDate] = useState("");
  const [editorContent, setEditorContent] = useState("");
  const [workbenchMessage, setWorkbenchMessage] = useState("");

  const [chatProvider, setChatProvider] = useState("");
  const [chatModel, setChatModel] = useState("");
  const [chatQuestion, setChatQuestion] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const searchSortRef = useRef<HTMLDivElement | null>(null);

  const providersQuery = useQuery({
    queryKey: ["providers"],
    queryFn: listProviders,
  });

  const fieldTemplatesQuery = useQuery({
    queryKey: ["field-templates"],
    queryFn: listFieldTemplates,
  });

  const filesQuery = useQuery({
    queryKey: ["files", workspaceId],
    queryFn: () => listFiles(workspaceId),
  });

  const searchResultQuery = useQuery({
    queryKey: ["search", workspaceId, searchQuery],
    queryFn: () => searchDocuments(workspaceId, searchQuery),
  });

  const previewQuery = useQuery({
    queryKey: ["index-markdown", workspaceId, selectedPreviewDocId],
    queryFn: () => getIndexMarkdown(selectedPreviewDocId, workspaceId),
    enabled: Boolean(selectedPreviewDocId),
    retry: false,
  });

  const indexDetailQuery = useQuery({
    queryKey: ["index-detail", workspaceId, selectedPreviewDocId],
    queryFn: () => getIndexDetail(selectedPreviewDocId, workspaceId),
    enabled: Boolean(selectedPreviewDocId),
    retry: false,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => uploadFile(file, workspaceId),
    onError: (error) => {
      setWorkbenchMessage(error instanceof Error ? error.message : "上传失败");
    },
  });

  const runMutation = useMutation({
    mutationFn: async (docId: string) => {
      if (!provider) {
        throw new Error("请先选择 Provider");
      }
      if (!fieldTemplateId) {
        throw new Error("请先选择字段模板");
      }
      return runIndex(docId, workspaceId, provider, null, fieldTemplateId);
    },
    onSuccess: async () => {
      setWorkbenchMessage("索引任务已启动");
      await queryClient.invalidateQueries({ queryKey: ["files", workspaceId] });
    },
    onError: (error) => {
      setWorkbenchMessage(error instanceof Error ? error.message : "启动索引失败");
    },
  });

  const runAllMutation = useMutation({
    mutationFn: async () => {
      if (!provider) {
        throw new Error("请先选择 Provider");
      }
      if (!fieldTemplateId) {
        throw new Error("请先选择字段模板");
      }
      return runAllIndexes(workspaceId, provider, null, fieldTemplateId);
    },
    onSuccess: async (result) => {
      setWorkbenchMessage(`批量索引已启动：${result.queued} 条，跳过 ${result.skipped} 条`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["files", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["search", workspaceId] }),
      ]);
    },
    onError: (error) => {
      setWorkbenchMessage(error instanceof Error ? error.message : "批量索引启动失败");
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (docId: string) => cancelIndex(docId, workspaceId),
    onSuccess: async () => {
      setWorkbenchMessage("已发送取消请求");
      await queryClient.invalidateQueries({ queryKey: ["files", workspaceId] });
    },
    onError: (error) => {
      setWorkbenchMessage(error instanceof Error ? error.message : "取消失败");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (docId: string) => deleteFile(docId, workspaceId),
    onSuccess: async (_, docId) => {
      setWorkbenchMessage("文档已删除");
      if (selectedPreviewDocId === docId) {
        setSelectedPreviewDocId("");
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["files", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["search", workspaceId] }),
      ]);
    },
    onError: (error) => {
      setWorkbenchMessage(error instanceof Error ? error.message : "删除失败");
    },
  });

  const saveEditorMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPreviewDocId) {
        throw new Error("未选择文档");
      }
      const trimmedYear = editorYear.trim();
      const nextYear = trimmedYear ? Number.parseInt(trimmedYear, 10) : null;
      if (trimmedYear && !Number.isFinite(nextYear)) {
        throw new Error("年份格式不正确");
      }
      return updateIndexEditor(selectedPreviewDocId, workspaceId, {
        title: editorTitle.trim(),
        display_name: editorTitle.trim(),
        year: Number.isFinite(nextYear) ? nextYear : null,
        generated_at: editorDate.trim() || null,
        markdown: editorContent,
      });
    },
    onSuccess: async () => {
      setWorkbenchMessage("索引内容已通过编辑窗口保存");
      setIsEditorOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["index-markdown", workspaceId, selectedPreviewDocId] }),
        queryClient.invalidateQueries({ queryKey: ["index-detail", workspaceId, selectedPreviewDocId] }),
        queryClient.invalidateQueries({ queryKey: ["search", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["files", workspaceId] }),
      ]);
    },
    onError: (error) => {
      setWorkbenchMessage(error instanceof Error ? error.message : "保存失败");
    },
  });

  const chatMutation = useMutation({
    mutationFn: askChatV0,
    onError: (error) => {
      setChatMessages((current) => [
        ...current,
        {
          id: nextMessageId(),
          role: "system",
          content: error instanceof Error ? error.message : "Chat 请求失败",
        },
      ]);
    },
  });

  const providerCount = providersQuery.data?.length ?? 0;
  const searchableRows = searchResultQuery.data ?? [];
  const sortedSearchRows = useMemo(() => {
    const rows = [...searchableRows];
    const factor = searchSortDirection === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (searchSortField === "year") {
        return factor * ((a.year || 0) - (b.year || 0));
      }
      if (searchSortField === "display") {
        const left = a.display_name || a.title || a.filename || a.doc_id;
        const right = b.display_name || b.title || b.filename || b.doc_id;
        return factor * left.localeCompare(right, "zh-Hans-CN");
      }
      return factor * String(a.created_at || "").localeCompare(String(b.created_at || ""));
    });
    return rows;
  }, [searchSortDirection, searchSortField, searchableRows]);

  const fileRows = filesQuery.data ?? [];
  const queueRows = useMemo(() => {
    return [...fileRows]
      .filter((item) => item.status !== "indexed")
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  }, [fileRows]);

  const previewRenderedHtml = useMemo(() => {
    if (!previewQuery.data?.markdown) {
      return "";
    }
    return renderMarkdownToHtml(previewQuery.data.markdown);
  }, [previewQuery.data?.markdown]);

  const selectedPreviewDoc = useMemo(
    () => fileRows.find((item) => item.id === selectedPreviewDocId) ?? null,
    [fileRows, selectedPreviewDocId],
  );

  const dashboardStats = useMemo(() => {
    let indexed = 0;
    let running = 0;
    let pending = 0;
    let review = 0;

    for (const row of fileRows) {
      const status = String(row.status || "");
      if (status === "indexed") {
        indexed += 1;
      } else if (status === "parsing") {
        running += 1;
      } else if (status === "needs_review" || status === "failed") {
        review += 1;
      } else {
        pending += 1;
      }
    }

    return {
      total: fileRows.length,
      indexed,
      running,
      pending,
      review,
    };
  }, [fileRows]);

  const searchSortLabel = useMemo(() => {
    if (searchSortField === "year") {
      return "年份";
    }
    if (searchSortField === "display") {
      return "索引名";
    }
    return "创建时间";
  }, [searchSortField]);

  const trendingKeywords = useMemo(() => {
    const countMap = new Map<string, number>();
    for (const row of searchableRows) {
      for (const keyword of row.keywords || []) {
        const normalized = String(keyword || "").trim();
        if (!normalized) {
          continue;
        }
        countMap.set(normalized, (countMap.get(normalized) || 0) + 1);
      }
    }
    return [...countMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 16)
      .map(([keyword]) => keyword);
  }, [searchableRows]);

  useEffect(() => {
    const providers = providersQuery.data;
    if (!providers || providers.length === 0) {
      return;
    }
    if (!provider || !providers.some((item) => item.provider === provider)) {
      setProvider(providers[0].provider);
    }
  }, [provider, providersQuery.data]);

  useEffect(() => {
    const providers = providersQuery.data;
    if (!providers || providers.length === 0) {
      return;
    }
    if (!chatProvider || !providers.some((item) => item.provider === chatProvider)) {
      const first = providers[0];
      setChatProvider(first.provider);
      setChatModel(String(first.model || ""));
      return;
    }

    const providerRow = providers.find((item) => item.provider === chatProvider);
    if (providerRow && !chatModel) {
      setChatModel(String(providerRow.model || ""));
    }
  }, [chatModel, chatProvider, providersQuery.data]);

  useEffect(() => {
    const templates = fieldTemplatesQuery.data;
    if (!templates || templates.length === 0) {
      return;
    }
    if (!fieldTemplateId || !templates.some((item) => item.id === fieldTemplateId)) {
      setFieldTemplateId(templates[0].id);
    }
  }, [fieldTemplateId, fieldTemplatesQuery.data]);

  useEffect(() => {
    if (selectedPreviewDocId && !fileRows.some((item) => item.id === selectedPreviewDocId)) {
      setSelectedPreviewDocId("");
    }
  }, [fileRows, selectedPreviewDocId]);

  useEffect(() => {
    if (!searchSortOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (searchSortRef.current?.contains(target)) {
        return;
      }
      setSearchSortOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [searchSortOpen]);

  useEffect(() => {
    const hasRunningTask = fileRows.some((item) => {
      const status = String(item.status || "");
      const stage = String(item.stage || "");
      return status === "parsing" || stage === "queued" || stage === "llm_request" || stage === "writing" || stage === "cancel_requested";
    });
    if (!hasRunningTask) {
      return;
    }
    const timer = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ["files", workspaceId] });
    }, 2000);
    return () => {
      window.clearInterval(timer);
    };
  }, [fileRows, queryClient, workspaceId]);

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearchQuery(searchInput.trim());
  }

  async function handleUploadFiles(files: File[]) {
    if (!files.length) {
      return;
    }
    let uploaded = 0;
    let duplicated = 0;
    let failed = 0;

    for (const file of files) {
      try {
        const result = await uploadMutation.mutateAsync(file);
        if (result.duplicate) {
          duplicated += 1;
        } else {
          uploaded += 1;
        }
      } catch {
        failed += 1;
      }
    }

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["files", workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ["search", workspaceId] }),
    ]);

    const segments = [`新增 ${uploaded}`];
    if (duplicated > 0) {
      segments.push(`重复 ${duplicated}`);
    }
    if (failed > 0) {
      segments.push(`失败 ${failed}`);
    }
    setWorkbenchMessage(`上传完成：${segments.join("，")}`);
  }

  function handleKeywordSearch(keyword: string) {
    setSearchInput(keyword);
    setSearchQuery(keyword);
  }

  async function handleAskChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = chatQuestion.trim();
    if (!question) {
      return;
    }
    if (!chatProvider) {
      setChatMessages((current) => [
        ...current,
        {
          id: nextMessageId(),
          role: "system",
          content: "没有可用 Provider，请先完成 Provider 配置。",
        },
      ]);
      return;
    }

    setChatMessages((current) => [
      ...current,
      {
        id: nextMessageId(),
        role: "user",
        content: question,
      },
    ]);
    setChatQuestion("");

    try {
      const result = await chatMutation.mutateAsync({
        question,
        provider: chatProvider,
        model: chatModel.trim() || null,
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
    } catch {
      // onError already appends system message
    }
  }

  async function handleCopyPreview() {
    if (!previewQuery.data?.markdown) {
      return;
    }
    try {
      await navigator.clipboard.writeText(previewQuery.data.markdown);
      setWorkbenchMessage("预览内容已复制");
    } catch {
      setWorkbenchMessage("复制失败，请手动复制");
    }
  }

  function handleOpenEditor() {
    if (!selectedPreviewDocId) {
      return;
    }
    const fallbackTitle =
      indexDetailQuery.data?.title ||
      searchableRows.find((item) => item.doc_id === selectedPreviewDocId)?.title ||
      selectedPreviewDoc?.display_name ||
      "";
    setEditorTitle(fallbackTitle);
    setEditorYear(indexDetailQuery.data?.year ? String(indexDetailQuery.data.year) : "");
    setEditorDate(
      toDateInputValue(indexDetailQuery.data?.updated_at || selectedPreviewDoc?.updated_at || null),
    );
    setEditorContent(previewQuery.data?.markdown || "");
    setIsEditorOpen(true);
  }

  async function handleSaveEditor() {
    await saveEditorMutation.mutateAsync();
  }

  function handleOpenOriginal() {
    if (!selectedPreviewDocId) {
      return;
    }
    window.open(buildOriginalFileUrl(selectedPreviewDocId, workspaceId), "_blank", "noopener,noreferrer");
  }

  function handleExportMarkdown() {
    if (!selectedPreviewDocId) {
      return;
    }
    window.open(buildExportMarkdownUrl(selectedPreviewDocId, workspaceId), "_blank", "noopener,noreferrer");
  }

  function handleLoadFromSearch(docId: string, displayName: string, status: string) {
    if (status !== "indexed") {
      setWorkbenchMessage("该文档尚未完成索引，暂不可加载预览内容");
      return;
    }
    setSelectedPreviewDocId(docId);
    setWorkbenchMessage(`已加载到预览区：${displayName}`);
  }

  async function handleDeleteFromSearch(docId: string) {
    const confirmed = window.confirm("确认删除该文档吗？删除后不可恢复。");
    if (!confirmed) {
      return;
    }
    await deleteMutation.mutateAsync(docId);
  }

  function isQueueRunning(status: string, stage: string): boolean {
    return (
      status === "parsing" ||
      stage === "queued" ||
      stage === "llm_request" ||
      stage === "writing" ||
      stage === "cancel_requested"
    );
  }

  return (
    <section className="v3-page v3-workbench-page">
      <header className="v3-page-header">
      </header>

      <article className="v3-card v3-workbench-hero">
        <div className="v3-workbench-hero-grid">
          <div className="v3-workbench-hero-main">
            <div className="v3-workbench-hero-head">
              <div>
                <h2 className="v3-workbench-hero-title">仪表台</h2>
               
              </div>
              <span className="v3-queue-pill">
                {dashboardStats.running > 0 ? `${dashboardStats.running} 生成中` : `${dashboardStats.pending + dashboardStats.review} 待处理`}
              </span>
            </div>

            <div className="v3-kpi-grid">
              <article className="v3-kpi-card">
                <span className="v3-kpi-label">已索引</span>
                <strong className="v3-kpi-value">{dashboardStats.indexed}</strong>
              </article>
              <article className="v3-kpi-card">
                <span className="v3-kpi-label">运行中</span>
                <strong className="v3-kpi-value">{dashboardStats.running}</strong>
              </article>
            </div>

            <section className="v3-keyword-cloud">
              {trendingKeywords.length === 0 ? (
                <p className="v3-muted">暂无语义分布，先上传并索引文档。</p>
              ) : (
                trendingKeywords.map((keyword) => (
                  <button
                    key={keyword}
                    className="v3-keyword-chip"
                    type="button"
                    onClick={() => {
                      handleKeywordSearch(keyword);
                    }}
                  >
                    {keyword}
                  </button>
                ))
              )}
            </section>
          </div>

          <aside className="v3-workbench-upload-panel">
            <div
              className={`v3-upload-dropzone ${isUploadDragOver ? "is-dragover" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                setIsUploadDragOver(true);
              }}
              onDragLeave={() => {
                setIsUploadDragOver(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setIsUploadDragOver(false);
                const dropped = Array.from(event.dataTransfer.files || []);
                void handleUploadFiles(dropped);
              }}
            >
              <p className="v3-upload-title">拖拽文档到这里</p>
              <p className="v3-muted">支持 pdf / txt / docx，可一次上传多个文件</p>
              <label className="v3-button v3-button-primary v3-upload-label" htmlFor="workbenchUploadInput">
                选择文件
              </label>
              <input
                id="workbenchUploadInput"
                className="v3-upload-input"
                type="file"
                multiple
                accept=".pdf,.txt,.docx"
                onChange={(event) => {
                  const files = Array.from(event.target.files || []);
                  if (!files.length) {
                    return;
                  }
                  void handleUploadFiles(files);
                  event.currentTarget.value = "";
                }}
              />
            </div>

            <div className="v3-control-grid">
              <label className="v3-control" htmlFor="workbenchProvider">
                <span className="v3-control-label">Provider</span>
                <select
                  id="workbenchProvider"
                  className="v3-input"
                  value={provider}
                  onChange={(event) => {
                    setProvider(event.target.value);
                  }}
                  disabled={providersQuery.isLoading || providerCount === 0}
                >
                  {providersQuery.data?.map((item) => (
                    <option key={item.provider} value={item.provider}>
                      {item.provider}
                    </option>
                  ))}
                </select>
              </label>

              <label className="v3-control" htmlFor="workbenchFieldTemplate">
                <span className="v3-control-label">字段模板</span>
                <select
                  id="workbenchFieldTemplate"
                  className="v3-input"
                  value={fieldTemplateId}
                  onChange={(event) => {
                    setFieldTemplateId(event.target.value);
                  }}
                  disabled={fieldTemplatesQuery.isLoading || !fieldTemplatesQuery.data?.length}
                >
                  {fieldTemplatesQuery.data?.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="v3-actions-row">
              <button
                className="v3-button v3-button-primary"
                type="button"
                onClick={() => {
                  void runAllMutation.mutateAsync();
                }}
                disabled={runAllMutation.isPending || !provider}
              >
                {runAllMutation.isPending ? "启动中..." : "全部索引"}
              </button>
              <button
                className="v3-button v3-button-secondary"
                type="button"
                onClick={() => {
                  void filesQuery.refetch();
                  void searchResultQuery.refetch();
                }}
              >
                刷新
              </button>
            </div>

            <div className="v3-mini-queue">
              {queueRows.map((item) => {
                const running = isQueueRunning(item.status, item.stage);
                const statusMeta = formatQueueStatus(item.status, item.stage);
                const statusClass =
                  statusMeta.tone === "ok"
                    ? "v3-status-pill is-ok"
                    : statusMeta.tone === "warn"
                      ? "v3-status-pill is-warn"
                      : statusMeta.tone === "muted"
                        ? "v3-status-pill is-muted"
                        : statusMeta.tone === "error"
                          ? "v3-status-pill is-error"
                          : "v3-status-pill";

                return (
                  <article className="v3-mini-queue-item" key={item.id}>
                    <div className="v3-mini-queue-main">
                      <strong className="v3-mini-queue-title">{item.display_name || item.filename}</strong>
                      <p className="v3-mini-queue-sub">{item.stage_message || item.stage || "等待索引"}</p>
                    </div>
                    <span className={statusClass}>{statusMeta.label}</span>
                    <div className="v3-mini-queue-actions">
                      {running ? (
                        <button
                          className="v3-button v3-button-warning"
                          type="button"
                          onClick={() => {
                            void cancelMutation.mutateAsync(item.id);
                          }}
                          disabled={cancelMutation.isPending}
                        >
                          取消
                        </button>
                      ) : (
                        <button
                          className="v3-button v3-button-primary"
                          type="button"
                          onClick={() => {
                            void runMutation.mutateAsync(item.id);
                          }}
                          disabled={runMutation.isPending || !provider}
                        >
                          索引
                        </button>
                      )}
                      <button
                        className="v3-button v3-button-danger"
                        type="button"
                        onClick={() => {
                          void handleDeleteFromSearch(item.id);
                        }}
                        disabled={deleteMutation.isPending}
                      >
                        删除
                      </button>
                    </div>
                  </article>
                );
              })}
              {filesQuery.isLoading ? <p className="v3-muted">正在加载文档...</p> : null}
              {!filesQuery.isLoading && queueRows.length === 0 ? <p className="v3-muted">当前工作区没有待索引文档</p> : null}
            </div>
          </aside>
        </div>
      </article>

      <div className="v3-workbench-body">
        <article className="v3-card v3-workbench-search-col">
          <div className="v3-module-header">
            <h2 className="v3-card-title">搜索与导出</h2>
            <p className="v3-muted">默认展示当前工作区全部文档，输入关键词可即时过滤</p>
          </div>

          <div className="v3-search-controls">
            <form className="v3-search-form" onSubmit={handleSearchSubmit}>
              <input
                className="v3-input"
                value={searchInput}
                onChange={(event) => {
                  setSearchInput(event.target.value);
                }}
                placeholder="输入关键词"
              />
              <button className="v3-button v3-button-primary" type="submit">
                搜索
              </button>
            </form>

            <div className="v3-sort-wrap" ref={searchSortRef}>
              <button
                className="v3-sort-trigger"
                type="button"
                onClick={() => {
                  setSearchSortOpen((current) => !current);
                }}
              >
                排序: {searchSortLabel}
              </button>
              <div className="v3-sort-menu" hidden={!searchSortOpen}>
                <button
                  className={`v3-sort-menu-item ${searchSortField === "created" ? "is-active" : ""}`}
                  type="button"
                  onClick={() => {
                    setSearchSortField("created");
                    setSearchSortOpen(false);
                  }}
                >
                  创建时间
                </button>
                <button
                  className={`v3-sort-menu-item ${searchSortField === "year" ? "is-active" : ""}`}
                  type="button"
                  onClick={() => {
                    setSearchSortField("year");
                    setSearchSortOpen(false);
                  }}
                >
                  年份
                </button>
                <button
                  className={`v3-sort-menu-item ${searchSortField === "display" ? "is-active" : ""}`}
                  type="button"
                  onClick={() => {
                    setSearchSortField("display");
                    setSearchSortOpen(false);
                  }}
                >
                  索引名
                </button>
              </div>
            </div>

            <button
              className="v3-button v3-button-secondary"
              type="button"
              onClick={() => {
                setSearchSortDirection((current) => (current === "asc" ? "desc" : "asc"));
              }}
            >
              {searchSortDirection === "asc" ? "升序" : "降序"}
            </button>
          </div>

          {searchResultQuery.isFetching ? <p className="v3-muted">正在搜索...</p> : null}
          {searchResultQuery.isError ? <p className="v3-error">搜索失败，请稍后重试</p> : null}

            <div className="v3-card-stack">
              {sortedSearchRows.length === 0 && !searchResultQuery.isFetching ? (
                <p className="v3-muted">{searchQuery ? "当前工作区没有匹配结果" : "当前工作区暂无可展示文档"}</p>
              ) : null}
              {sortedSearchRows.map((item) => (
                <article
                  className={`v3-search-row ${item.doc_id === selectedPreviewDocId ? "is-active" : ""}`}
                  key={item.doc_id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    handleLoadFromSearch(
                      item.doc_id,
                      item.display_name || item.filename || item.doc_id,
                      item.status,
                    );
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleLoadFromSearch(
                        item.doc_id,
                        item.display_name || item.filename || item.doc_id,
                        item.status,
                      );
                    }
                  }}
                >
                  <div className="v3-search-row-head">
                    <strong className="v3-search-row-title">{item.display_name || item.filename || item.doc_id}</strong>
                    <span className="v3-status-pill">{item.status}</span>
                  </div>
                  <p className="v3-search-row-meta">年份：{item.year ?? "-"} · 作者：{compactAuthors(item.authors)}</p>
                  <div className="v3-search-row-keywords">
                    {compactKeywords(item.keywords).length > 0 ? (
                      compactKeywords(item.keywords).map((keyword) => (
                        <span className="v3-search-keyword-chip" key={`${item.doc_id}_${keyword}`}>
                          {keyword}
                        </span>
                      ))
                    ) : (
                      <span className="v3-muted">关键词：-</span>
                    )}
                  </div>
                  <div className="v3-search-row-actions">
                    <button
                      className="v3-button v3-button-secondary"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        window.open(buildExportMarkdownUrl(item.doc_id, workspaceId), "_blank", "noopener,noreferrer");
                      }}
                      disabled={item.status !== "indexed"}
                    >
                      导出
                    </button>
                    <button
                      className="v3-button v3-button-danger"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDeleteFromSearch(item.doc_id);
                      }}
                      disabled={deleteMutation.isPending}
                    >
                      删除
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </article>

        <div className="v3-workbench-right-col">
          <article className="v3-card v3-workbench-preview-card">
            <div className="v3-module-header">
              <h2 className="v3-card-title">索引预览</h2>
              <p className="v3-muted">当前文档的 Markdown 索引结果</p>
            </div>

            <div className="v3-preview-toolbar">
              <div className="v3-segmented-control">
                <button
                  className={`v3-button v3-button-secondary ${previewMode === "raw" ? "is-active" : ""}`}
                  type="button"
                  onClick={() => {
                    setPreviewMode("raw");
                  }}
                  disabled={!previewQuery.data?.markdown}
                >
                  Markdown
                </button>
                <button
                  className={`v3-button v3-button-secondary ${previewMode === "rendered" ? "is-active" : ""}`}
                  type="button"
                  onClick={() => {
                    setPreviewMode("rendered");
                  }}
                  disabled={!previewQuery.data?.markdown}
                >
                  渲染
                </button>
              </div>
              <button
                className="v3-button v3-button-secondary"
                type="button"
                onClick={() => {
                  void previewQuery.refetch();
                }}
                disabled={!selectedPreviewDocId}
              >
                刷新预览
              </button>
              <button
                className="v3-button v3-button-secondary"
                type="button"
                onClick={() => {
                  void handleCopyPreview();
                }}
                disabled={!previewQuery.data?.markdown}
              >
                复制
              </button>
              <button
                className="v3-button v3-button-secondary"
                type="button"
                onClick={handleOpenOriginal}
                disabled={!selectedPreviewDocId}
              >
                打开原文
              </button>
              <button
                className="v3-button v3-button-secondary"
                type="button"
                onClick={handleExportMarkdown}
                disabled={!selectedPreviewDocId}
              >
                导出 Markdown
              </button>
              <button
                className="v3-button v3-button-primary"
                type="button"
                onClick={handleOpenEditor}
                disabled={!selectedPreviewDocId || !previewQuery.data?.markdown}
              >
                编辑
              </button>
            </div>

            <div className="v3-preview-panel">
              {!selectedPreviewDocId ? <p className="v3-muted">请选择文档</p> : null}
              {selectedPreviewDocId && previewQuery.isLoading ? <p className="v3-muted">正在加载预览...</p> : null}
              {selectedPreviewDocId && previewQuery.isError ? <p className="v3-error">预览不可用，可能尚未生成索引</p> : null}
              {selectedPreviewDoc ? (
                <p className="v3-muted">状态：{selectedPreviewDoc.status} / 阶段：{selectedPreviewDoc.stage || "-"} {selectedPreviewDoc.stage_message ? `- ${selectedPreviewDoc.stage_message}` : ""}</p>
              ) : null}
              {previewQuery.data?.markdown ? (
                previewMode === "raw" ? (
                  <pre className="v3-preview-content">{previewQuery.data.markdown}</pre>
                ) : (
                  <article
                    className="v3-preview-rendered"
                    dangerouslySetInnerHTML={{ __html: previewRenderedHtml }}
                  />
                )
              ) : null}
            </div>
          </article>

          <article className="v3-card v3-workbench-chat-card">
            <div className="v3-module-header">
              <h2 className="v3-card-title">Chat V0</h2>
              <p className="v3-muted">基于当前工作区已索引文献对话</p>
            </div>

            <div className="v3-control-grid">
              <label className="v3-control" htmlFor="workbenchChatProvider">
                <span className="v3-control-label">Provider</span>
                <select
                  id="workbenchChatProvider"
                  className="v3-input"
                  value={chatProvider}
                  onChange={(event) => {
                    const nextProvider = event.target.value;
                    setChatProvider(nextProvider);
                    const providerRow = providersQuery.data?.find((item) => item.provider === nextProvider);
                    setChatModel(String(providerRow?.model || ""));
                  }}
                  disabled={!providersQuery.data?.length}
                >
                  {providersQuery.data?.map((item) => (
                    <option key={item.provider} value={item.provider}>
                      {item.provider}
                    </option>
                  ))}
                </select>
              </label>

              <label className="v3-control" htmlFor="workbenchChatModel">
                <span className="v3-control-label">Model</span>
                <input
                  id="workbenchChatModel"
                  className="v3-input"
                  value={chatModel}
                  onChange={(event) => {
                    setChatModel(event.target.value);
                  }}
                />
              </label>
            </div>

            <div className="v3-chat-log">
              {chatMessages.length === 0 ? <p className="v3-muted">输入问题后开始对话。</p> : null}
              {chatMessages.map((message) => (
                <article key={message.id} className={`v3-chat-message role-${message.role}`}>
                  <header className="v3-chat-message-head">
                    <span>{message.role === "user" ? "你" : message.role === "assistant" ? "助手" : "系统"}</span>
                    {message.meta ? <span className="v3-chat-message-meta">{message.meta}</span> : null}
                  </header>
                  <p className="v3-chat-message-content">{message.content}</p>
                </article>
              ))}
            </div>

            <form className="v3-chat-form" onSubmit={(event) => { void handleAskChat(event); }}>
              <textarea
                className="v3-textarea v3-textarea-compact"
                value={chatQuestion}
                onChange={(event) => {
                  setChatQuestion(event.target.value);
                }}
                placeholder="输入问题..."
              />
              <div className="v3-actions-row">
                <button className="v3-button v3-button-primary" type="submit" disabled={chatMutation.isPending || !chatProvider}>
                  {chatMutation.isPending ? "发送中..." : "发送"}
                </button>
                <button
                  className="v3-button v3-button-warning"
                  type="button"
                  onClick={() => {
                    setChatMessages([]);
                  }}
                  disabled={!chatMessages.length}
                >
                  清空
                </button>
              </div>
            </form>
          </article>
        </div>
      </div>

      {isEditorOpen ? (
        <div className="v3-modal-backdrop" role="dialog" aria-modal="true">
          <article className="v3-modal-panel">
            <header className="v3-modal-header">
              <h3 className="v3-card-title">编辑索引内容</h3>
              <p className="v3-muted">可单独调整日期、年份、标题和正文内容。</p>
            </header>

            <div className="v3-editor-grid">
              <label className="v3-control" htmlFor="editorDate">
                <span className="v3-control-label">日期</span>
                <input
                  id="editorDate"
                  type="date"
                  className="v3-input"
                  value={editorDate}
                  onChange={(event) => {
                    setEditorDate(event.target.value);
                  }}
                />
              </label>

              <label className="v3-control" htmlFor="editorYear">
                <span className="v3-control-label">年份</span>
                <input
                  id="editorYear"
                  type="number"
                  className="v3-input"
                  value={editorYear}
                  onChange={(event) => {
                    setEditorYear(event.target.value);
                  }}
                  placeholder="例如 2026"
                />
              </label>

              <label className="v3-control v3-editor-span-2" htmlFor="editorTitle">
                <span className="v3-control-label">标题</span>
                <input
                  id="editorTitle"
                  type="text"
                  className="v3-input"
                  value={editorTitle}
                  onChange={(event) => {
                    setEditorTitle(event.target.value);
                  }}
                />
              </label>

              <label className="v3-control v3-editor-span-2" htmlFor="editorContent">
                <span className="v3-control-label">具体内容</span>
                <textarea
                  id="editorContent"
                  className="v3-textarea"
                  value={editorContent}
                  onChange={(event) => {
                    setEditorContent(event.target.value);
                  }}
                  rows={16}
                />
              </label>
            </div>

            <div className="v3-actions-row">
              <button
                className="v3-button v3-button-primary"
                type="button"
                onClick={() => {
                  void handleSaveEditor();
                }}
                disabled={saveEditorMutation.isPending}
              >
                {saveEditorMutation.isPending ? "保存中..." : "保存"}
              </button>
              <button
                className="v3-button v3-button-secondary"
                type="button"
                onClick={() => {
                  setIsEditorOpen(false);
                }}
                disabled={saveEditorMutation.isPending}
              >
                取消
              </button>
            </div>
          </article>
        </div>
      ) : null}

      {workbenchMessage ? <p className="v3-muted">{workbenchMessage}</p> : null}
    </section>
  );
}
