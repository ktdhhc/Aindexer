import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useWorkspaceStore } from "../app/workspaceStore";
import { askChatV0 } from "../shared/api/chat";
import { listFieldTemplates } from "../shared/api/fields";
import { listFiles, uploadFile } from "../shared/api/files";
import { getIndexMarkdown, runIndex } from "../shared/api/index";
import { listProviders } from "../shared/api/providers";
import { searchDocuments } from "../shared/api/search";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  meta?: string;
}

function nextMessageId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function ConsolePage() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceStore((state) => state.workspaceId);

  const [provider, setProvider] = useState("");
  const [fieldTemplateId, setFieldTemplateId] = useState("tpl_default");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPreviewDocId, setSelectedPreviewDocId] = useState("");
  const [workbenchMessage, setWorkbenchMessage] = useState("");

  const [chatProvider, setChatProvider] = useState("");
  const [chatModel, setChatModel] = useState("");
  const [chatQuestion, setChatQuestion] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

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
    enabled: searchQuery.trim().length > 0,
  });

  const previewQuery = useQuery({
    queryKey: ["index-markdown", workspaceId, selectedPreviewDocId],
    queryFn: () => getIndexMarkdown(selectedPreviewDocId, workspaceId),
    enabled: Boolean(selectedPreviewDocId),
    retry: false,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => uploadFile(file, workspaceId),
    onSuccess: async (result) => {
      setWorkbenchMessage(result.duplicate ? "检测到重复文档，已定位已有记录。" : "上传成功，文档已加入当前工作区。" );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["files", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["search", workspaceId] }),
      ]);
    },
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
  const fileRows = filesQuery.data ?? [];

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
    if (fileRows.length === 0) {
      setSelectedPreviewDocId("");
      return;
    }

    if (!selectedPreviewDocId || !fileRows.some((item) => item.id === selectedPreviewDocId)) {
      const firstIndexed = fileRows.find((item) => item.status === "indexed");
      setSelectedPreviewDocId((firstIndexed || fileRows[0]).id);
    }
  }, [fileRows, selectedPreviewDocId]);

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearchQuery(searchInput.trim());
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

  return (
    <section className="v3-page v3-workbench-page">
      <header className="v3-page-header">
        <h1 className="v3-page-title">工作台</h1>
        <p className="v3-page-subtitle">仪表台、搜索区、预览区和 Chat 区在同一工作面内协同。当前工作区：{workspaceId}</p>
      </header>

      <article className="v3-card v3-workbench-top">
        <div className="v3-module-header">
          <h2 className="v3-card-title">仪表台</h2>
          <p className="v3-muted">上传、索引策略与关键指标</p>
        </div>

        <div className="v3-kpi-grid">
          <article className="v3-kpi-card">
            <span className="v3-kpi-label">总文档</span>
            <strong className="v3-kpi-value">{dashboardStats.total}</strong>
          </article>
          <article className="v3-kpi-card">
            <span className="v3-kpi-label">已索引</span>
            <strong className="v3-kpi-value">{dashboardStats.indexed}</strong>
          </article>
          <article className="v3-kpi-card">
            <span className="v3-kpi-label">运行中</span>
            <strong className="v3-kpi-value">{dashboardStats.running}</strong>
          </article>
          <article className="v3-kpi-card">
            <span className="v3-kpi-label">待处理</span>
            <strong className="v3-kpi-value">{dashboardStats.pending + dashboardStats.review}</strong>
          </article>
        </div>

        <div className="v3-workbench-top-grid">
          <article className="v3-subcard">
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
              <label className="v3-button v3-button-primary v3-upload-label" htmlFor="workbenchUploadInput">
                上传文档
              </label>
              <input
                id="workbenchUploadInput"
                className="v3-upload-input"
                type="file"
                accept=".pdf,.txt,.docx"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) {
                    return;
                  }
                  void uploadMutation.mutateAsync(file);
                  event.currentTarget.value = "";
                }}
              />
              <button
                className="v3-button v3-button-secondary"
                type="button"
                onClick={() => {
                  void filesQuery.refetch();
                }}
              >
                刷新文档
              </button>
            </div>
          </article>

          <article className="v3-subcard">
            <h3 className="v3-subcard-title">最近文档</h3>
            <div className="v3-doc-list">
              {(fileRows.slice(0, 4) || []).map((item) => (
                <article className="v3-subcard" key={item.id}>
                  <div className="v3-subcard-head">
                    <strong>{item.display_name || item.filename}</strong>
                    <span className="v3-status-pill">{item.status}</span>
                  </div>
                  <div className="v3-actions-row">
                    <button
                      className="v3-button v3-button-secondary"
                      type="button"
                      onClick={() => {
                        setSelectedPreviewDocId(item.id);
                      }}
                    >
                      预览
                    </button>
                    <button
                      className="v3-button v3-button-secondary"
                      type="button"
                      onClick={() => {
                        void runMutation.mutateAsync(item.id);
                      }}
                      disabled={runMutation.isPending || !provider}
                    >
                      索引
                    </button>
                  </div>
                </article>
              ))}
              {filesQuery.isLoading ? <p className="v3-muted">正在加载文档...</p> : null}
              {!filesQuery.isLoading && fileRows.length === 0 ? <p className="v3-muted">当前工作区暂无文档</p> : null}
            </div>
          </article>
        </div>
      </article>

      <div className="v3-workbench-body">
        <article className="v3-card v3-workbench-search-col">
          <div className="v3-module-header">
            <h2 className="v3-card-title">搜索区</h2>
            <p className="v3-muted">按关键词过滤当前工作区索引结果</p>
          </div>

          <form className="v3-search-form" onSubmit={handleSearchSubmit}>
            <input
              className="v3-input"
              value={searchInput}
              onChange={(event) => {
                setSearchInput(event.target.value);
              }}
              placeholder="输入标题、作者、关键词"
            />
            <button className="v3-button v3-button-primary" type="submit">
              搜索
            </button>
          </form>

          {searchResultQuery.isFetching ? <p className="v3-muted">正在搜索...</p> : null}
          {searchQuery && searchResultQuery.isError ? <p className="v3-error">搜索失败</p> : null}

          <div className="v3-card-stack">
            {searchQuery && searchableRows.length === 0 && !searchResultQuery.isFetching ? (
              <p className="v3-muted">当前工作区没有匹配结果</p>
            ) : null}
            {searchableRows.map((item) => (
              <article className="v3-subcard" key={item.doc_id}>
                <div className="v3-subcard-head">
                  <strong>{item.title || item.display_name || item.filename}</strong>
                  <span className="v3-status-pill">{item.status}</span>
                </div>
                <p className="v3-muted">年份：{item.year ?? "-"}</p>
                <div className="v3-actions-row">
                  <button
                    className="v3-button v3-button-secondary"
                    type="button"
                    onClick={() => {
                      setSelectedPreviewDocId(item.doc_id);
                    }}
                  >
                    加载到预览区
                  </button>
                </div>
              </article>
            ))}
          </div>
        </article>

        <div className="v3-workbench-right-col">
          <article className="v3-card v3-workbench-preview-card">
            <div className="v3-module-header">
              <h2 className="v3-card-title">预览区</h2>
              <p className="v3-muted">查看文献索引 Markdown 结果</p>
            </div>

            <div className="v3-preview-toolbar">
              <select
                className="v3-input"
                value={selectedPreviewDocId}
                onChange={(event) => {
                  setSelectedPreviewDocId(event.target.value);
                }}
                disabled={!fileRows.length}
              >
                {fileRows.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.display_name || item.filename}
                  </option>
                ))}
              </select>
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
            </div>

            <div className="v3-preview-panel">
              {!selectedPreviewDocId ? <p className="v3-muted">请选择文档</p> : null}
              {selectedPreviewDocId && previewQuery.isLoading ? <p className="v3-muted">正在加载预览...</p> : null}
              {selectedPreviewDocId && previewQuery.isError ? <p className="v3-error">预览不可用，可能尚未生成索引</p> : null}
              {previewQuery.data?.markdown ? <pre className="v3-preview-content">{previewQuery.data.markdown}</pre> : null}
            </div>
          </article>

          <article className="v3-card v3-workbench-chat-card">
            <div className="v3-module-header">
              <h2 className="v3-card-title">Chat 区</h2>
              <p className="v3-muted">在当前工作区内调用 LLM 对已索引文献提问</p>
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
                  className="v3-button v3-button-secondary"
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

      {workbenchMessage ? <p className="v3-muted">{workbenchMessage}</p> : null}
    </section>
  );
}
