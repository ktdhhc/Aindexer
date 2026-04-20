import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { useWorkspaceStore } from "../app/workspaceStore";
import { askChatV0 } from "../shared/api/chat";
import { listProviders } from "../shared/api/providers";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  meta?: string;
}

function createMessageId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function ChatPage() {
  const workspaceId = useWorkspaceStore((state) => state.workspaceId);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [model, setModel] = useState("");
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const providersQuery = useQuery({
    queryKey: ["providers"],
    queryFn: listProviders,
  });

  const selectedProviderRow = useMemo(() => {
    return providersQuery.data?.find((item) => item.provider === selectedProvider) ?? null;
  }, [providersQuery.data, selectedProvider]);

  useEffect(() => {
    const providers = providersQuery.data;
    if (!providers || providers.length === 0) {
      setSelectedProvider("");
      return;
    }
    if (!selectedProvider || !providers.some((item) => item.provider === selectedProvider)) {
      setSelectedProvider(providers[0].provider);
    }
  }, [providersQuery.data, selectedProvider]);

  useEffect(() => {
    if (!selectedProviderRow) {
      setModel("");
      return;
    }
    setModel(String(selectedProviderRow.model || ""));
  }, [selectedProviderRow]);

  const askMutation = useMutation({
    mutationFn: askChatV0,
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) {
      return;
    }
    if (!selectedProvider) {
      setMessages((current) => [
        ...current,
        {
          id: createMessageId(),
          role: "system",
          content: "没有可用 Provider，请先在配置页完成 Provider 设置。",
        },
      ]);
      return;
    }

    setMessages((current) => [
      ...current,
      {
        id: createMessageId(),
        role: "user",
        content: trimmedQuestion,
      },
    ]);
    setQuestion("");

    try {
      const response = await askMutation.mutateAsync({
        question: trimmedQuestion,
        provider: selectedProvider,
        model: model.trim() || null,
        workspace_id: workspaceId,
      });
      setMessages((current) => [
        ...current,
        {
          id: createMessageId(),
          role: "assistant",
          content: response.answer,
          meta: `来源：${response.display_name} (${response.doc_id})`,
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: createMessageId(),
          role: "system",
          content: error instanceof Error ? error.message : "Chat 请求失败",
        },
      ]);
    }
  }

  return (
    <section className="v3-page">
      <header className="v3-page-header">
        <h1 className="v3-page-title">Chat</h1>
        <p className="v3-page-subtitle">独立的 LLM 聊天工作区。使用现有 Provider 配置并调用 `/api/chat/ask_v0`。</p>
        <p className="v3-muted">当前工作区：{workspaceId}</p>
      </header>

      <article className="v3-card">
        <h2 className="v3-card-title">会话配置</h2>
        <div className="v3-form-grid">
          <label className="v3-form-label" htmlFor="chatProvider">Provider</label>
          <select
            id="chatProvider"
            className="v3-input"
            value={selectedProvider}
            onChange={(event) => {
              setSelectedProvider(event.target.value);
            }}
            disabled={providersQuery.isLoading || !providersQuery.data?.length}
          >
            {providersQuery.data?.map((provider) => (
              <option key={provider.provider} value={provider.provider}>
                {provider.provider}
              </option>
            ))}
          </select>

          <label className="v3-form-label" htmlFor="chatModel">Model</label>
          <input
            id="chatModel"
            className="v3-input"
            value={model}
            onChange={(event) => {
              setModel(event.target.value);
            }}
            placeholder="留空则使用 Provider 默认模型"
          />
        </div>

        <div className="v3-chat-log">
          {messages.length === 0 ? <p className="v3-muted">输入问题后开始对话。</p> : null}
          {messages.map((message) => (
            <article key={message.id} className={`v3-chat-message role-${message.role}`}>
              <header className="v3-chat-message-head">
                <span>{message.role === "user" ? "你" : message.role === "assistant" ? "助手" : "系统"}</span>
                {message.meta ? <span className="v3-chat-message-meta">{message.meta}</span> : null}
              </header>
              <p className="v3-chat-message-content">{message.content}</p>
            </article>
          ))}
        </div>

        <form className="v3-chat-form" onSubmit={(event) => { void handleSubmit(event); }}>
          <textarea
            className="v3-textarea"
            value={question}
            onChange={(event) => {
              setQuestion(event.target.value);
            }}
            placeholder="请输入要向 LLM 询问的问题..."
          />
          <div className="v3-actions-row">
            <button className="v3-button v3-button-primary" type="submit" disabled={askMutation.isPending || !selectedProvider}>
              {askMutation.isPending ? "发送中..." : "发送"}
            </button>
            <button
              className="v3-button v3-button-secondary"
              type="button"
              onClick={() => {
                setMessages([]);
              }}
              disabled={messages.length === 0}
            >
              清空会话
            </button>
          </div>
        </form>
      </article>
    </section>
  );
}
