import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { DEFAULT_WORKSPACE_ID, useWorkspaceStore } from "../app/workspaceStore";
import {
  type FieldDefinition,
  type FieldTemplate,
  createFieldTemplate,
  deleteFieldTemplate,
  listFieldTemplates,
  listFields,
  resetFields as resetFieldsConfig,
  updateFieldTemplate,
  updateFields,
} from "../shared/api/fields";
import {
  listProviders,
  resetProviders,
  testProvider,
  updateProvider,
} from "../shared/api/providers";
import {
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
  updateWorkspace as renameWorkspace,
} from "../shared/api/workspaces";

type ConfigSection = "providers" | "fields" | "workspaces";

interface ProviderDraft {
  baseUrl: string;
  model: string;
  apiKey: string;
  clearApiKey: boolean;
  temperature: number;
  timeout: number;
  enabled: boolean;
}

function toBoolean(value: boolean | number): boolean {
  return value === true || value === 1;
}

function normalizeFieldRows(items: FieldDefinition[]): FieldDefinition[] {
  return [...items]
    .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
    .map((item, index) => ({
      ...item,
      required: toBoolean(item.required),
      enabled: toBoolean(item.enabled),
      is_default: toBoolean(item.is_default),
      sort_order: item.sort_order ?? index + 1,
      field_type: String(item.field_type || "text"),
      field_key: String(item.field_key || ""),
      label: String(item.label || ""),
      description: String(item.description || ""),
    }));
}

export function ConfigPage() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceStore((state) => state.workspaceId);
  const setWorkspaceId = useWorkspaceStore((state) => state.setWorkspaceId);

  const [section, setSection] = useState<ConfigSection>("providers");
  const [selectedProvider, setSelectedProvider] = useState("");
  const [providerDraft, setProviderDraft] = useState<ProviderDraft | null>(null);
  const [providerMessage, setProviderMessage] = useState("");

  const [selectedFieldTemplateId, setSelectedFieldTemplateId] = useState("tpl_default");
  const [newFieldTemplateName, setNewFieldTemplateName] = useState("");
  const [fieldTemplateNameDraft, setFieldTemplateNameDraft] = useState("");
  const [fieldTemplateDescriptionDraft, setFieldTemplateDescriptionDraft] = useState("");
  const [fieldDrafts, setFieldDrafts] = useState<FieldDefinition[]>([]);
  const [fieldsMessage, setFieldsMessage] = useState("");

  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [workspaceRenameName, setWorkspaceRenameName] = useState("");
  const [workspaceMessage, setWorkspaceMessage] = useState("");

  const providersQuery = useQuery({
    queryKey: ["providers"],
    queryFn: listProviders,
  });

  const fieldTemplatesQuery = useQuery({
    queryKey: ["field-templates"],
    queryFn: listFieldTemplates,
  });

  const fieldsQuery = useQuery({
    queryKey: ["fields", selectedFieldTemplateId],
    queryFn: () => listFields(selectedFieldTemplateId),
    enabled: !!selectedFieldTemplateId,
  });

  const workspacesQuery = useQuery({
    queryKey: ["workspaces"],
    queryFn: listWorkspaces,
  });

  const selectedProviderRow = useMemo(() => {
    return providersQuery.data?.find((item) => item.provider === selectedProvider) ?? null;
  }, [providersQuery.data, selectedProvider]);

  const selectedFieldTemplateRow = useMemo<FieldTemplate | null>(() => {
    return fieldTemplatesQuery.data?.find((item) => item.id === selectedFieldTemplateId) ?? null;
  }, [fieldTemplatesQuery.data, selectedFieldTemplateId]);

  const currentWorkspaceRow = useMemo(() => {
    return workspacesQuery.data?.find((item) => item.id === workspaceId) ?? null;
  }, [workspacesQuery.data, workspaceId]);

  useEffect(() => {
    const providers = providersQuery.data;
    if (!providers || providers.length === 0) {
      setSelectedProvider("");
      setProviderDraft(null);
      return;
    }

    if (!selectedProvider || !providers.some((item) => item.provider === selectedProvider)) {
      setSelectedProvider(providers[0].provider);
    }
  }, [providersQuery.data, selectedProvider]);

  useEffect(() => {
    if (!selectedProviderRow) {
      setProviderDraft(null);
      return;
    }

    setProviderDraft({
      baseUrl: String(selectedProviderRow.base_url || ""),
      model: String(selectedProviderRow.model || ""),
      apiKey: "",
      clearApiKey: false,
      temperature: Number(selectedProviderRow.temperature ?? 0.1),
      timeout: Number(selectedProviderRow.timeout ?? 120),
      enabled: Boolean(selectedProviderRow.enabled),
    });
  }, [selectedProviderRow]);

  useEffect(() => {
    const templates = fieldTemplatesQuery.data;
    if (!templates || templates.length === 0) {
      return;
    }
    if (!selectedFieldTemplateId || !templates.some((item) => item.id === selectedFieldTemplateId)) {
      setSelectedFieldTemplateId(templates[0].id);
    }
  }, [fieldTemplatesQuery.data, selectedFieldTemplateId]);

  useEffect(() => {
    if (!selectedFieldTemplateRow) {
      setFieldTemplateNameDraft("");
      setFieldTemplateDescriptionDraft("");
      return;
    }
    setFieldTemplateNameDraft(selectedFieldTemplateRow.name);
    setFieldTemplateDescriptionDraft(selectedFieldTemplateRow.description || "");
  }, [selectedFieldTemplateRow]);

  useEffect(() => {
    if (!fieldsQuery.data) {
      return;
    }
    setFieldDrafts(normalizeFieldRows(fieldsQuery.data));
  }, [fieldsQuery.data]);

  useEffect(() => {
    if (!currentWorkspaceRow) {
      setWorkspaceRenameName("");
      return;
    }
    setWorkspaceRenameName(currentWorkspaceRow.name);
  }, [currentWorkspaceRow]);

  const saveProviderMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProvider || !providerDraft) {
        throw new Error("请先选择 Provider");
      }

      const payload = {
        base_url: providerDraft.baseUrl.trim(),
        model: providerDraft.model.trim(),
        api_key: providerDraft.apiKey.trim() || undefined,
        clear_api_key: providerDraft.clearApiKey,
        temperature: Number(providerDraft.temperature),
        timeout: Number(providerDraft.timeout),
        enabled: providerDraft.enabled,
      };

      return updateProvider(selectedProvider, payload);
    },
    onSuccess: async () => {
      setProviderMessage("Provider 配置已保存");
      await queryClient.invalidateQueries({ queryKey: ["providers"] });
    },
    onError: (error) => {
      setProviderMessage(error instanceof Error ? error.message : "保存 Provider 配置失败");
    },
  });

  const testProviderMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProvider) {
        throw new Error("请先选择 Provider");
      }
      return testProvider(selectedProvider);
    },
    onSuccess: (result) => {
      const state = result.success ? "成功" : "失败";
      setProviderMessage(`连接测试${state}：${result.message}（${result.elapsed_seconds.toFixed(2)}s）`);
    },
    onError: (error) => {
      setProviderMessage(error instanceof Error ? error.message : "连接测试失败");
    },
  });

  const resetProviderMutation = useMutation({
    mutationFn: resetProviders,
    onSuccess: async () => {
      setProviderMessage("已恢复默认 Provider 配置");
      await queryClient.invalidateQueries({ queryKey: ["providers"] });
    },
    onError: (error) => {
      setProviderMessage(error instanceof Error ? error.message : "恢复默认 Provider 配置失败");
    },
  });

  const saveFieldsMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFieldTemplateId) {
        throw new Error("请先选择字段模板");
      }
      const seen = new Set<string>();
      const cleaned = fieldDrafts.map((item, index) => {
        const label = String(item.label || "").trim();
        if (!label) {
          throw new Error(`第 ${index + 1} 行字段名称不能为空`);
        }
        if (seen.has(label)) {
          throw new Error(`字段名称重复：${label}`);
        }
        seen.add(label);

        return {
          ...item,
          field_key: String(item.field_key || label).trim() || label,
          label,
          description: String(item.description || "").trim(),
          field_type: String(item.field_type || "text"),
          required: toBoolean(item.required),
          enabled: toBoolean(item.enabled),
          is_default: toBoolean(item.is_default),
          sort_order: index + 1,
        };
      });

      return updateFields(cleaned, selectedFieldTemplateId);
    },
    onSuccess: async () => {
      setFieldsMessage("字段配置已保存");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["fields", selectedFieldTemplateId] }),
        queryClient.invalidateQueries({ queryKey: ["field-templates"] }),
      ]);
    },
    onError: (error) => {
      setFieldsMessage(error instanceof Error ? error.message : "字段配置保存失败");
    },
  });

  const resetFieldsMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFieldTemplateId) {
        throw new Error("请先选择字段模板");
      }
      return resetFieldsConfig(selectedFieldTemplateId);
    },
    onSuccess: async () => {
      setFieldsMessage("已恢复默认字段配置");
      await queryClient.invalidateQueries({ queryKey: ["fields", selectedFieldTemplateId] });
    },
    onError: (error) => {
      setFieldsMessage(error instanceof Error ? error.message : "恢复默认字段失败");
    },
  });

  const createFieldTemplateMutation = useMutation({
    mutationFn: async () => {
      const name = newFieldTemplateName.trim();
      if (!name) {
        throw new Error("模板名称不能为空");
      }
      return createFieldTemplate({
        name,
        source_template_id: selectedFieldTemplateId || "tpl_default",
      });
    },
    onSuccess: async (template) => {
      setFieldsMessage("字段模板已创建");
      setNewFieldTemplateName("");
      await queryClient.invalidateQueries({ queryKey: ["field-templates"] });
      setSelectedFieldTemplateId(template.id);
    },
    onError: (error) => {
      setFieldsMessage(error instanceof Error ? error.message : "创建字段模板失败");
    },
  });

  const updateFieldTemplateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFieldTemplateId) {
        throw new Error("请先选择字段模板");
      }
      const name = fieldTemplateNameDraft.trim();
      if (!name) {
        throw new Error("模板名称不能为空");
      }
      return updateFieldTemplate(selectedFieldTemplateId, {
        name,
        description: fieldTemplateDescriptionDraft.trim(),
      });
    },
    onSuccess: async () => {
      setFieldsMessage("字段模板信息已更新");
      await queryClient.invalidateQueries({ queryKey: ["field-templates"] });
    },
    onError: (error) => {
      setFieldsMessage(error instanceof Error ? error.message : "更新字段模板失败");
    },
  });

  const deleteFieldTemplateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFieldTemplateId) {
        throw new Error("请先选择字段模板");
      }
      return deleteFieldTemplate(selectedFieldTemplateId);
    },
    onSuccess: async () => {
      setFieldsMessage("字段模板已删除");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["field-templates"] }),
        queryClient.invalidateQueries({ queryKey: ["fields"] }),
      ]);
      setSelectedFieldTemplateId("tpl_default");
    },
    onError: (error) => {
      setFieldsMessage(error instanceof Error ? error.message : "删除字段模板失败");
    },
  });

  const createWorkspaceMutation = useMutation({
    mutationFn: async () => {
      const name = newWorkspaceName.trim();
      if (!name) {
        throw new Error("工作区名称不能为空");
      }
      return createWorkspace({ name });
    },
    onSuccess: async (workspace) => {
      setWorkspaceMessage("工作区创建成功");
      setNewWorkspaceName("");
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      setWorkspaceId(workspace.id);
    },
    onError: (error) => {
      setWorkspaceMessage(error instanceof Error ? error.message : "创建工作区失败");
    },
  });

  const renameWorkspaceMutation = useMutation({
    mutationFn: async () => {
      if (!workspaceId) {
        throw new Error("请先选择工作区");
      }
      const name = workspaceRenameName.trim();
      if (!name) {
        throw new Error("工作区名称不能为空");
      }
      return renameWorkspace(workspaceId, { name });
    },
    onSuccess: async () => {
      setWorkspaceMessage("工作区已更新");
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
    onError: (error) => {
      setWorkspaceMessage(error instanceof Error ? error.message : "更新工作区失败");
    },
  });

  const deleteWorkspaceMutation = useMutation({
    mutationFn: async () => {
      if (!workspaceId) {
        throw new Error("请先选择工作区");
      }
      if (workspaceId === DEFAULT_WORKSPACE_ID) {
        throw new Error("默认工作区不允许删除");
      }
      return deleteWorkspace(workspaceId);
    },
    onSuccess: async () => {
      setWorkspaceMessage("工作区已删除");
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      setWorkspaceId(DEFAULT_WORKSPACE_ID);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["files"] }),
        queryClient.invalidateQueries({ queryKey: ["search"] }),
      ]);
    },
    onError: (error) => {
      setWorkspaceMessage(error instanceof Error ? error.message : "删除工作区失败");
    },
  });

  function updateProviderDraft(patch: Partial<ProviderDraft>) {
    setProviderDraft((current) => {
      if (!current) {
        return current;
      }
      return { ...current, ...patch };
    });
  }

  function updateField(index: number, patch: Partial<FieldDefinition>) {
    setFieldDrafts((rows) => rows.map((item, currentIndex) => (currentIndex === index ? { ...item, ...patch } : item)));
  }

  function addField() {
    setFieldDrafts((rows) => [
      ...rows,
      {
        field_key: "",
        label: "",
        description: "",
        field_type: "text",
        required: false,
        enabled: true,
        sort_order: rows.length + 1,
        is_default: false,
      },
    ]);
  }

  function removeField(index: number) {
    setFieldDrafts((rows) => rows.filter((_, currentIndex) => currentIndex !== index));
  }

  return (
    <section className="v3-page">
      <header className="v3-page-header">
        <h1 className="v3-page-title">配置</h1>
        <p className="v3-page-subtitle">统一管理 Provider 与字段配置。此页面将替代原来的两个独立配置入口。</p>
      </header>

      <div className="v3-segmented-control" role="tablist" aria-label="配置分组">
        <button
          className={`v3-button v3-button-secondary ${section === "providers" ? "is-active" : ""}`}
          onClick={() => {
            setSection("providers");
          }}
          role="tab"
          aria-selected={section === "providers"}
        >
          Provider
        </button>
        <button
          className={`v3-button v3-button-secondary ${section === "fields" ? "is-active" : ""}`}
          onClick={() => {
            setSection("fields");
          }}
          role="tab"
          aria-selected={section === "fields"}
        >
          字段
        </button>
        <button
          className={`v3-button v3-button-secondary ${section === "workspaces" ? "is-active" : ""}`}
          onClick={() => {
            setSection("workspaces");
          }}
          role="tab"
          aria-selected={section === "workspaces"}
        >
          工作区
        </button>
      </div>

      {section === "providers" ? (
        <article className="v3-card">
          <h2 className="v3-card-title">Provider 配置</h2>

          {providersQuery.isLoading ? <p className="v3-muted">正在加载 Provider...</p> : null}
          {providersQuery.isError ? <p className="v3-error">Provider 加载失败</p> : null}

          <div className="v3-provider-card-grid">
            {(providersQuery.data ?? []).map((item) => (
              <button
                key={item.provider}
                className={`v3-provider-tile ${item.provider === selectedProvider ? "is-selected" : ""}`}
                onClick={() => {
                  setSelectedProvider(item.provider);
                }}
                type="button"
              >
                <div className="v3-subcard-head">
                  <strong>{item.provider}</strong>
                  <span className={`v3-status-pill ${item.enabled ? "is-ok" : "is-muted"}`}>
                    {item.enabled ? "启用" : "停用"}
                  </span>
                </div>
                <p className="v3-muted v3-mono">{item.model || "未设置模型"}</p>
                <p className="v3-muted">timeout: {item.timeout}s</p>
              </button>
            ))}
          </div>

          {providerDraft && selectedProviderRow ? (
            <div className="v3-provider-editor-grid">
              <article className="v3-subcard">
                <h3 className="v3-subcard-title">接口设置</h3>
                <div className="v3-control-grid">
                  <label className="v3-control" htmlFor="providerBaseUrl">
                    <span className="v3-control-label">Base URL</span>
                    <input
                      id="providerBaseUrl"
                      className="v3-input"
                      value={providerDraft.baseUrl}
                      onChange={(event) => {
                        updateProviderDraft({ baseUrl: event.target.value });
                      }}
                      placeholder="https://api.example.com/v1"
                    />
                  </label>

                  <label className="v3-control" htmlFor="providerModel">
                    <span className="v3-control-label">Model</span>
                    <input
                      id="providerModel"
                      className="v3-input"
                      value={providerDraft.model}
                      onChange={(event) => {
                        updateProviderDraft({ model: event.target.value });
                      }}
                    />
                  </label>

                  <label className="v3-control" htmlFor="providerTemperature">
                    <span className="v3-control-label">Temperature</span>
                    <input
                      id="providerTemperature"
                      className="v3-input"
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      value={providerDraft.temperature}
                      onChange={(event) => {
                        updateProviderDraft({ temperature: Number(event.target.value) });
                      }}
                    />
                  </label>

                  <label className="v3-control" htmlFor="providerTimeout">
                    <span className="v3-control-label">Timeout (秒)</span>
                    <input
                      id="providerTimeout"
                      className="v3-input"
                      type="number"
                      step="1"
                      min="10"
                      max="300"
                      value={providerDraft.timeout}
                      onChange={(event) => {
                        updateProviderDraft({ timeout: Number(event.target.value) });
                      }}
                    />
                  </label>
                </div>
              </article>

              <article className="v3-subcard">
                <h3 className="v3-subcard-title">认证与状态</h3>
                <div className="v3-control-grid">
                  <div className="v3-control v3-control-span-2">
                    <span className="v3-control-label">API Key</span>
                    <div className="v3-key-row">
                      <input
                        id="providerApiKey"
                        className="v3-input"
                        type="password"
                        value={providerDraft.apiKey}
                        onChange={(event) => {
                          updateProviderDraft({ apiKey: event.target.value, clearApiKey: false });
                        }}
                        placeholder={selectedProviderRow.api_key_masked || "输入新 API Key"}
                      />
                      <button
                        className="v3-button v3-button-secondary"
                        onClick={() => {
                          updateProviderDraft({ apiKey: "", clearApiKey: true });
                        }}
                        type="button"
                      >
                        清空
                      </button>
                    </div>
                    {selectedProviderRow.api_key_masked ? (
                      <p className="v3-hint">已存在 Key：{selectedProviderRow.api_key_masked}</p>
                    ) : null}
                  </div>

                  <div className="v3-control v3-control-span-2">
                    <span className="v3-control-label">状态</span>
                    <label className="v3-checkbox-line" htmlFor="providerEnabled">
                      <input
                        id="providerEnabled"
                        type="checkbox"
                        checked={providerDraft.enabled}
                        onChange={(event) => {
                          updateProviderDraft({ enabled: event.target.checked });
                        }}
                      />
                      <span>启用该 Provider</span>
                    </label>
                  </div>
                </div>
              </article>
            </div>
          ) : null}

          {providerMessage ? <p className="v3-muted">{providerMessage}</p> : null}

          <div className="v3-actions-row">
            <button
              className="v3-button v3-button-primary"
              onClick={() => {
                void saveProviderMutation.mutateAsync();
              }}
              disabled={!providerDraft || saveProviderMutation.isPending}
            >
              保存 Provider
            </button>
            <button
              className="v3-button v3-button-secondary"
              onClick={() => {
                void testProviderMutation.mutateAsync();
              }}
              disabled={!providerDraft || testProviderMutation.isPending}
            >
              测试连接
            </button>
            <button
              className="v3-button v3-button-secondary"
              onClick={() => {
                void resetProviderMutation.mutateAsync();
              }}
              disabled={resetProviderMutation.isPending}
            >
              恢复默认 Provider
            </button>
          </div>
        </article>
      ) : null}

      {section === "fields" ? (
        <article className="v3-card">
          <h2 className="v3-card-title">字段配置</h2>

          <div className="v3-template-shell">
            <article className="v3-subcard">
              <h3 className="v3-subcard-title">模板库</h3>
              <div className="v3-template-list">
                {(fieldTemplatesQuery.data ?? []).map((template) => (
                  <button
                    key={template.id}
                    className={`v3-template-item ${template.id === selectedFieldTemplateId ? "is-selected" : ""}`}
                    onClick={() => {
                      setSelectedFieldTemplateId(template.id);
                    }}
                    type="button"
                  >
                    <div className="v3-subcard-head">
                      <strong>{template.name}</strong>
                      {template.is_default ? <span className="v3-status-pill is-ok">默认</span> : null}
                    </div>
                    <p className="v3-muted v3-mono">{template.id}</p>
                    <p className="v3-muted">字段数：{template.field_count}</p>
                  </button>
                ))}
              </div>

              <div className="v3-inline-controls">
                <input
                  className="v3-input"
                  value={newFieldTemplateName}
                  onChange={(event) => {
                    setNewFieldTemplateName(event.target.value);
                  }}
                  placeholder="新建模板名称"
                />
                <button
                  className="v3-button v3-button-primary"
                  type="button"
                  onClick={() => {
                    void createFieldTemplateMutation.mutateAsync();
                  }}
                  disabled={createFieldTemplateMutation.isPending}
                >
                  新建模板
                </button>
              </div>
            </article>

            <article className="v3-subcard">
              <h3 className="v3-subcard-title">模板信息</h3>
              {selectedFieldTemplateRow ? (
                <div className="v3-control-grid">
                  <label className="v3-control">
                    <span className="v3-control-label">模板名称</span>
                    <input
                      className="v3-input"
                      value={fieldTemplateNameDraft}
                      onChange={(event) => {
                        setFieldTemplateNameDraft(event.target.value);
                      }}
                    />
                  </label>

                  <label className="v3-control">
                    <span className="v3-control-label">模板 ID</span>
                    <p className="v3-muted v3-mono">{selectedFieldTemplateRow.id}</p>
                  </label>

                  <label className="v3-control v3-control-span-2">
                    <span className="v3-control-label">描述</span>
                    <textarea
                      className="v3-textarea v3-textarea-compact"
                      value={fieldTemplateDescriptionDraft}
                      onChange={(event) => {
                        setFieldTemplateDescriptionDraft(event.target.value);
                      }}
                    />
                  </label>
                </div>
              ) : (
                <p className="v3-muted">暂无可用模板</p>
              )}

              <div className="v3-actions-row">
                <button
                  className="v3-button v3-button-primary"
                  type="button"
                  onClick={() => {
                    void updateFieldTemplateMutation.mutateAsync();
                  }}
                  disabled={!selectedFieldTemplateRow || updateFieldTemplateMutation.isPending}
                >
                  更新模板信息
                </button>
                <button
                  className="v3-button v3-button-secondary"
                  type="button"
                  onClick={() => {
                    void deleteFieldTemplateMutation.mutateAsync();
                  }}
                  disabled={!selectedFieldTemplateRow || selectedFieldTemplateRow.is_default || deleteFieldTemplateMutation.isPending}
                >
                  删除模板
                </button>
              </div>
            </article>
          </div>

          {fieldsQuery.isLoading ? <p className="v3-muted">正在加载字段配置...</p> : null}
          {fieldsQuery.isError ? <p className="v3-error">字段配置加载失败</p> : null}

          <div className="v3-field-card-grid">
            {fieldDrafts.map((item, index) => (
              <article className="v3-subcard v3-field-card" key={`${item.field_key || "new"}-${index}`}>
                <div className="v3-subcard-head">
                  <strong>字段 #{index + 1}</strong>
                  <button
                    className="v3-button v3-button-secondary"
                    onClick={() => {
                      removeField(index);
                    }}
                    type="button"
                  >
                    删除
                  </button>
                </div>

                <div className="v3-field-form-grid">
                  <label className="v3-control">
                    <span className="v3-control-label">Label</span>
                    <input
                      className="v3-input"
                      value={String(item.label)}
                      onChange={(event) => {
                        updateField(index, { label: event.target.value });
                      }}
                    />
                  </label>

                  <label className="v3-control">
                    <span className="v3-control-label">Key</span>
                    <input
                      className="v3-input"
                      value={String(item.field_key)}
                      onChange={(event) => {
                        updateField(index, { field_key: event.target.value });
                      }}
                    />
                  </label>

                  <label className="v3-control">
                    <span className="v3-control-label">Type</span>
                    <select
                      className="v3-input"
                      value={String(item.field_type)}
                      onChange={(event) => {
                        updateField(index, { field_type: event.target.value });
                      }}
                    >
                      <option value="text">text</option>
                      <option value="number">number</option>
                      <option value="list">list</option>
                    </select>
                  </label>

                  <label className="v3-control">
                    <span className="v3-control-label">Flags</span>
                    <div className="v3-inline-checks">
                      <label className="v3-checkbox-line">
                        <input
                          type="checkbox"
                          checked={toBoolean(item.required)}
                          onChange={(event) => {
                            updateField(index, { required: event.target.checked });
                          }}
                        />
                        <span>必填</span>
                      </label>
                      <label className="v3-checkbox-line">
                        <input
                          type="checkbox"
                          checked={toBoolean(item.enabled)}
                          onChange={(event) => {
                            updateField(index, { enabled: event.target.checked });
                          }}
                        />
                        <span>启用</span>
                      </label>
                    </div>
                  </label>

                  <label className="v3-control v3-control-span-2">
                    <span className="v3-control-label">Description</span>
                    <textarea
                      className="v3-textarea v3-textarea-compact"
                      value={String(item.description || "")}
                      onChange={(event) => {
                        updateField(index, { description: event.target.value });
                      }}
                    />
                  </label>
                </div>
              </article>
            ))}
            {fieldDrafts.length === 0 && !fieldsQuery.isLoading ? <p className="v3-muted">当前模板暂无字段</p> : null}
          </div>

          {fieldsMessage ? <p className="v3-muted">{fieldsMessage}</p> : null}

          <div className="v3-actions-row">
            <button className="v3-button v3-button-secondary" onClick={addField} type="button">
              新增字段
            </button>
            <button
              className="v3-button v3-button-primary"
              onClick={() => {
                void saveFieldsMutation.mutateAsync();
              }}
              disabled={saveFieldsMutation.isPending || fieldDrafts.length === 0}
              type="button"
            >
              保存字段配置
            </button>
            <button
              className="v3-button v3-button-secondary"
              onClick={() => {
                void resetFieldsMutation.mutateAsync();
              }}
              disabled={resetFieldsMutation.isPending}
              type="button"
            >
              恢复默认字段
            </button>
          </div>
        </article>
      ) : null}

      {section === "workspaces" ? (
        <div className="v3-grid">
          <article className="v3-card">
            <h2 className="v3-card-title">当前工作区</h2>

            {workspacesQuery.isLoading ? <p className="v3-muted">正在加载工作区...</p> : null}
            {workspacesQuery.isError ? <p className="v3-error">工作区加载失败</p> : null}

            {currentWorkspaceRow ? (
              <div className="v3-form-grid">
                <label className="v3-form-label">ID</label>
                <p className="v3-muted v3-mono">{currentWorkspaceRow.id}</p>

                <label className="v3-form-label" htmlFor="workspaceName">名称</label>
                <input
                  id="workspaceName"
                  className="v3-input"
                  value={workspaceRenameName}
                  onChange={(event) => {
                    setWorkspaceRenameName(event.target.value);
                  }}
                />

                <label className="v3-form-label">文档数量</label>
                <p className="v3-muted">{currentWorkspaceRow.document_count}</p>
              </div>
            ) : null}

            <div className="v3-actions-row">
              <button
                className="v3-button v3-button-primary"
                onClick={() => {
                  void renameWorkspaceMutation.mutateAsync();
                }}
                disabled={!currentWorkspaceRow || renameWorkspaceMutation.isPending}
                type="button"
              >
                重命名工作区
              </button>
              <button
                className="v3-button v3-button-secondary"
                onClick={() => {
                  void deleteWorkspaceMutation.mutateAsync();
                }}
                disabled={!currentWorkspaceRow || workspaceId === DEFAULT_WORKSPACE_ID || deleteWorkspaceMutation.isPending}
                type="button"
              >
                删除当前工作区
              </button>
            </div>
          </article>

          <article className="v3-card">
            <h2 className="v3-card-title">创建与切换</h2>

            <div className="v3-inline-controls">
              <input
                className="v3-input"
                value={newWorkspaceName}
                onChange={(event) => {
                  setNewWorkspaceName(event.target.value);
                }}
                placeholder="输入新工作区名称"
              />
              <button
                className="v3-button v3-button-primary"
                onClick={() => {
                  void createWorkspaceMutation.mutateAsync();
                }}
                disabled={createWorkspaceMutation.isPending}
                type="button"
              >
                新建
              </button>
            </div>

            <div className="v3-card-stack">
              {(workspacesQuery.data ?? []).map((item) => (
                <article className={`v3-subcard ${item.id === workspaceId ? "is-selected" : ""}`} key={item.id}>
                  <div className="v3-subcard-head">
                    <strong>{item.name}</strong>
                    <button
                      className="v3-button v3-button-secondary"
                      type="button"
                      onClick={() => {
                        setWorkspaceId(item.id);
                      }}
                    >
                      设为当前
                    </button>
                  </div>
                  <p className="v3-muted v3-mono">{item.id}</p>
                  <p className="v3-muted">文档数量：{item.document_count}</p>
                </article>
              ))}
            </div>

            {workspaceMessage ? <p className="v3-muted">{workspaceMessage}</p> : null}
          </article>
        </div>
      ) : null}
    </section>
  );
}
