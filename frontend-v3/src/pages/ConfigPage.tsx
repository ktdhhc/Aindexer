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
  resetFields,
  updateFieldTemplate,
  updateFields,
} from "../shared/api/fields";
import {
  deleteProvider,
  type ProviderSummary,
  listProviders,
  resetProviders,
  testProvider,
  updateProvider,
} from "../shared/api/providers";
import {
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
  updateWorkspace,
} from "../shared/api/workspaces";
import { getModelDefaults, setModelDefaults, type ModelDefaults } from "../shared/lib/modelDefaults";
import { buildAvailableProviderModelEntries, getProviderModels, setProviderModels } from "../shared/lib/providerModels";

type ConfigSection = "providers" | "defaults" | "fields" | "workspaces";

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

function providerStatus(provider: ProviderSummary | null): string {
  if (!provider) {
    return "未选择";
  }
  if (!provider.enabled) {
    return "停用";
  }
  if (!provider.has_api_key) {
    return "缺少 Key";
  }
  return "可用";
}

export function ConfigPage() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceStore((state) => state.workspaceId);
  const setWorkspaceId = useWorkspaceStore((state) => state.setWorkspaceId);

  const [section, setSection] = useState<ConfigSection>("providers");
  const [selectedProvider, setSelectedProvider] = useState("");
  const [newProviderName, setNewProviderName] = useState("");
  const [providerDraft, setProviderDraft] = useState<ProviderDraft | null>(null);
  const [providerModels, setProviderModelRows] = useState<string[]>([]);
  const [newModelName, setNewModelName] = useState("");
  const [providerMessage, setProviderMessage] = useState("准备就绪");

  const [modelDefaultsDraft, setModelDefaultsDraft] = useState<ModelDefaults>(() => getModelDefaults());
  const [defaultsMessage, setDefaultsMessage] = useState("准备就绪");

  const [selectedTemplateId, setSelectedTemplateId] = useState("tpl_default");
  const [newTemplateName, setNewTemplateName] = useState("");
  const [templateNameDraft, setTemplateNameDraft] = useState("");
  const [templateDescriptionDraft, setTemplateDescriptionDraft] = useState("");
  const [fieldDrafts, setFieldDrafts] = useState<FieldDefinition[]>([]);
  const [activeFieldIndex, setActiveFieldIndex] = useState(0);
  const [fieldsMessage, setFieldsMessage] = useState("准备就绪");

  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState("");
  const [workspaceMessage, setWorkspaceMessage] = useState("准备就绪");

  const providersQuery = useQuery({
    queryKey: ["providers"],
    queryFn: listProviders,
  });

  const templatesQuery = useQuery({
    queryKey: ["field-templates"],
    queryFn: listFieldTemplates,
  });

  const fieldsQuery = useQuery({
    queryKey: ["fields", selectedTemplateId],
    queryFn: () => listFields(selectedTemplateId),
    enabled: Boolean(selectedTemplateId),
  });

  const workspacesQuery = useQuery({
    queryKey: ["workspaces"],
    queryFn: listWorkspaces,
  });

  const selectedProviderRow = useMemo(() => {
    return providersQuery.data?.find((item) => item.provider === selectedProvider) ?? null;
  }, [providersQuery.data, selectedProvider]);

  const selectedTemplateRow = useMemo<FieldTemplate | null>(() => {
    return templatesQuery.data?.find((item) => item.id === selectedTemplateId) ?? null;
  }, [selectedTemplateId, templatesQuery.data]);

  const currentWorkspaceRow = useMemo(() => {
    return workspacesQuery.data?.find((item) => item.id === workspaceId) ?? null;
  }, [workspaceId, workspacesQuery.data]);

  const availableModelEntries = useMemo(() => {
    return buildAvailableProviderModelEntries(providersQuery.data ?? []);
  }, [providersQuery.data]);

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
      setProviderDraft(null);
      setProviderModelRows([]);
      return;
    }
    const modelRows = getProviderModels(selectedProviderRow.provider, selectedProviderRow.model);
    setProviderDraft({
      baseUrl: String(selectedProviderRow.base_url || ""),
      model: String(selectedProviderRow.model || ""),
      apiKey: "",
      clearApiKey: false,
      temperature: Number(selectedProviderRow.temperature ?? 0.1),
      timeout: Number(selectedProviderRow.timeout ?? 120),
      enabled: Boolean(selectedProviderRow.enabled),
    });
    setProviderModelRows(modelRows);
  }, [selectedProviderRow]);

  useEffect(() => {
    const templates = templatesQuery.data;
    if (!templates || templates.length === 0) {
      return;
    }
    if (!selectedTemplateId || !templates.some((item) => item.id === selectedTemplateId)) {
      setSelectedTemplateId(templates[0].id);
    }
  }, [selectedTemplateId, templatesQuery.data]);

  useEffect(() => {
    if (!selectedTemplateRow) {
      setTemplateNameDraft("");
      setTemplateDescriptionDraft("");
      return;
    }
    setTemplateNameDraft(selectedTemplateRow.name);
    setTemplateDescriptionDraft(selectedTemplateRow.description || "");
  }, [selectedTemplateRow]);

  useEffect(() => {
    if (fieldsQuery.data) {
      setFieldDrafts(normalizeFieldRows(fieldsQuery.data));
      setActiveFieldIndex(0);
    }
  }, [fieldsQuery.data]);

  useEffect(() => {
    if (activeFieldIndex >= fieldDrafts.length) {
      setActiveFieldIndex(Math.max(0, fieldDrafts.length - 1));
    }
  }, [activeFieldIndex, fieldDrafts.length]);

  useEffect(() => {
    setWorkspaceNameDraft(currentWorkspaceRow?.name || "");
  }, [currentWorkspaceRow]);

  const saveProviderMutation = useMutation({
    mutationFn: async () => {
      const providerName = selectedProvider.trim();
      if (!providerName || !providerDraft) {
        throw new Error("请选择 Provider");
      }
      const selectedModel = providerDraft.model.trim();
      const cleanedModels = providerModels.map((item) => item.trim()).filter(Boolean);
      const modelRows = setProviderModels(providerName, selectedModel ? [selectedModel, ...cleanedModels] : cleanedModels);
      const modelName = selectedModel || modelRows[0] || "";
      if (!modelName) {
        throw new Error("至少需要一个模型名");
      }
      await updateProvider(providerName, {
        base_url: providerDraft.baseUrl.trim(),
        model: modelName,
        api_key: providerDraft.apiKey.trim() || undefined,
        clear_api_key: providerDraft.clearApiKey,
        temperature: Number(providerDraft.temperature),
        timeout: Number(providerDraft.timeout),
        enabled: providerDraft.enabled,
      });
      return providerName;
    },
    onSuccess: async (providerName) => {
      setProviderMessage("Provider 已保存");
      await queryClient.invalidateQueries({ queryKey: ["providers"] });
      setSelectedProvider(providerName);
    },
    onError: (error) => {
      setProviderMessage(error instanceof Error ? error.message : "保存失败");
    },
  });

  const createProviderMutation = useMutation({
    mutationFn: async () => {
      const providerName = newProviderName.trim();
      if (!providerName) {
        throw new Error("Provider 名称不能为空");
      }
      const source = selectedProviderRow ?? providersQuery.data?.[0] ?? null;
      const baseUrl = String(source?.base_url || "https://api.openai.com/v1").trim();
      const model = String(source?.model || "gpt-4o-mini").trim();
      await updateProvider(providerName, {
        base_url: baseUrl,
        model,
        temperature: Number(source?.temperature ?? 0.1),
        timeout: Number(source?.timeout ?? 120),
        enabled: false,
      });
      setProviderModels(providerName, [model]);
      return providerName;
    },
    onSuccess: async (providerName) => {
      setProviderMessage("Provider 已创建");
      setNewProviderName("");
      await queryClient.invalidateQueries({ queryKey: ["providers"] });
      setSelectedProvider(providerName);
    },
    onError: (error) => {
      setProviderMessage(error instanceof Error ? error.message : "创建失败");
    },
  });

  const testProviderMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProvider) {
        throw new Error("请选择 Provider");
      }
      return testProvider(selectedProvider);
    },
    onSuccess: (result) => {
      setProviderMessage(`${result.success ? "连接成功" : "连接失败"} · ${result.elapsed_seconds.toFixed(2)}s · ${result.message}`);
    },
    onError: (error) => {
      setProviderMessage(error instanceof Error ? error.message : "连接测试失败");
    },
  });

  const deleteProviderMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProvider) {
        throw new Error("请选择 Provider");
      }
      return deleteProvider(selectedProvider);
    },
    onSuccess: async () => {
      setProviderMessage("Provider 已删除");
      setProviderModels(selectedProvider, []);
      setSelectedProvider("");
      await queryClient.invalidateQueries({ queryKey: ["providers"] });
    },
    onError: (error) => {
      setProviderMessage(error instanceof Error ? error.message : "删除失败");
    },
  });

  const resetProvidersMutation = useMutation({
    mutationFn: resetProviders,
    onSuccess: async () => {
      setProviderMessage("已恢复默认 Provider");
      await queryClient.invalidateQueries({ queryKey: ["providers"] });
    },
    onError: (error) => {
      setProviderMessage(error instanceof Error ? error.message : "恢复失败");
    },
  });

  const saveDefaultsMutation = useMutation({
    mutationFn: async () => setModelDefaults(modelDefaultsDraft),
    onSuccess: (defaults) => {
      setModelDefaultsDraft(defaults);
      setDefaultsMessage("默认模型已保存");
    },
    onError: (error) => {
      setDefaultsMessage(error instanceof Error ? error.message : "保存失败");
    },
  });

  const createTemplateMutation = useMutation({
    mutationFn: async () => {
      const name = newTemplateName.trim();
      if (!name) {
        throw new Error("模板名称不能为空");
      }
      return createFieldTemplate({ name, source_template_id: selectedTemplateId || "tpl_default" });
    },
    onSuccess: async (template) => {
      setFieldsMessage("模板已创建");
      setNewTemplateName("");
      await queryClient.invalidateQueries({ queryKey: ["field-templates"] });
      setSelectedTemplateId(template.id);
    },
    onError: (error) => {
      setFieldsMessage(error instanceof Error ? error.message : "创建失败");
    },
  });

  const updateTemplateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTemplateId) {
        throw new Error("请选择模板");
      }
      const name = templateNameDraft.trim();
      if (!name) {
        throw new Error("模板名称不能为空");
      }
      return updateFieldTemplate(selectedTemplateId, {
        name,
        description: templateDescriptionDraft.trim(),
      });
    },
    onSuccess: async () => {
      setFieldsMessage("模板信息已更新");
      await queryClient.invalidateQueries({ queryKey: ["field-templates"] });
    },
    onError: (error) => {
      setFieldsMessage(error instanceof Error ? error.message : "更新失败");
    },
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTemplateRow) {
        throw new Error("请选择模板");
      }
      if (selectedTemplateRow.is_default) {
        throw new Error("默认模板不能删除");
      }
      return deleteFieldTemplate(selectedTemplateRow.id);
    },
    onSuccess: async () => {
      setFieldsMessage("模板已删除");
      setSelectedTemplateId("tpl_default");
      await queryClient.invalidateQueries({ queryKey: ["field-templates"] });
    },
    onError: (error) => {
      setFieldsMessage(error instanceof Error ? error.message : "删除失败");
    },
  });

  const saveFieldsMutation = useMutation({
    mutationFn: async () => {
      const seen = new Set<string>();
      const cleaned = fieldDrafts.map((item, index) => {
        const label = String(item.label || "").trim();
        if (!label) {
          throw new Error(`第 ${index + 1} 个字段缺少名称`);
        }
        if (seen.has(label)) {
          throw new Error(`字段名称重复：${label}`);
        }
        seen.add(label);
        return {
          ...item,
          label,
          field_key: String(item.field_key || label).trim() || label,
          description: String(item.description || "").trim(),
          field_type: String(item.field_type || "text"),
          required: toBoolean(item.required),
          enabled: toBoolean(item.enabled),
          is_default: toBoolean(item.is_default),
          sort_order: index + 1,
        };
      });
      return updateFields(cleaned, selectedTemplateId);
    },
    onSuccess: async () => {
      setFieldsMessage("字段已保存");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["fields", selectedTemplateId] }),
        queryClient.invalidateQueries({ queryKey: ["field-templates"] }),
      ]);
    },
    onError: (error) => {
      setFieldsMessage(error instanceof Error ? error.message : "保存字段失败");
    },
  });

  const resetFieldsMutation = useMutation({
    mutationFn: async () => resetFields(selectedTemplateId),
    onSuccess: async () => {
      setFieldsMessage("字段已恢复默认");
      await queryClient.invalidateQueries({ queryKey: ["fields", selectedTemplateId] });
    },
    onError: (error) => {
      setFieldsMessage(error instanceof Error ? error.message : "恢复字段失败");
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
      setWorkspaceMessage("工作区已创建");
      setNewWorkspaceName("");
      setWorkspaceId(workspace.id);
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
    onError: (error) => {
      setWorkspaceMessage(error instanceof Error ? error.message : "创建失败");
    },
  });

  const renameWorkspaceMutation = useMutation({
    mutationFn: async () => {
      const name = workspaceNameDraft.trim();
      if (!workspaceId || !name) {
        throw new Error("工作区名称不能为空");
      }
      return updateWorkspace(workspaceId, { name });
    },
    onSuccess: async () => {
      setWorkspaceMessage("工作区已更新");
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
    onError: (error) => {
      setWorkspaceMessage(error instanceof Error ? error.message : "更新失败");
    },
  });

  const deleteWorkspaceMutation = useMutation({
    mutationFn: async () => {
      if (workspaceId === DEFAULT_WORKSPACE_ID) {
        throw new Error("默认工作区不能删除");
      }
      return deleteWorkspace(workspaceId);
    },
    onSuccess: async () => {
      setWorkspaceMessage("工作区已删除");
      setWorkspaceId(DEFAULT_WORKSPACE_ID);
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
    onError: (error) => {
      setWorkspaceMessage(error instanceof Error ? error.message : "删除失败");
    },
  });

  function updateProviderDraft(patch: Partial<ProviderDraft>) {
    setProviderDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function addProviderModel() {
    const name = newModelName.trim();
    if (!name) {
      return;
    }
    setProviderModelRows((rows) => {
      const nextRows = rows.includes(name) ? rows : [...rows, name];
      updateProviderDraft({ model: name });
      return nextRows;
    });
    setNewModelName("");
  }

  function renameProviderModel(index: number, value: string) {
    const nextValue = value.trim();
    setProviderModelRows((rows) => rows.map((item, currentIndex) => (currentIndex === index ? value : item)));
    if (providerDraft?.model === providerModels[index]) {
      updateProviderDraft({ model: nextValue });
    }
  }

  function removeProviderModel(index: number) {
    setProviderModelRows((rows) => {
      const nextRows = rows.filter((_, currentIndex) => currentIndex !== index);
      if (providerDraft?.model === rows[index]) {
        updateProviderDraft({ model: nextRows[0] || "" });
      }
      return nextRows;
    });
  }

  function updateField(index: number, patch: Partial<FieldDefinition>) {
    setFieldDrafts((rows) => rows.map((item, currentIndex) => (currentIndex === index ? { ...item, ...patch } : item)));
  }

  function addField() {
    const nextIndex = fieldDrafts.length;
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
    setActiveFieldIndex(nextIndex);
  }

  function removeField(index: number) {
    setFieldDrafts((rows) => rows.filter((_, currentIndex) => currentIndex !== index));
  }

  const currentSectionStatus =
    section === "providers"
      ? providerMessage
      : section === "defaults"
        ? defaultsMessage
        : section === "fields"
          ? fieldsMessage
          : workspaceMessage;
  const activeField = fieldDrafts[activeFieldIndex] ?? null;

  return (
    <section className="v35-config-page">
      <header className="v35-config-hero">
        <div>
          <p className="v35-banner-kicker">Settings Atelier</p>
          <h1>配置</h1>
        </div>
        <div className="v35-config-hero-meta">
          <span>{providersQuery.data?.length ?? 0} Providers</span>
          <span>{templatesQuery.data?.length ?? 0} Templates</span>
          <span>{workspacesQuery.data?.length ?? 0} Workspaces</span>
        </div>
      </header>

      <div className="v35-config-shell">
        <aside className="v35-config-nav" aria-label="配置分区">
          <button className={section === "providers" ? "is-active" : ""} type="button" onClick={() => setSection("providers")}>
            <strong>Provider</strong>
            <span>{providerStatus(selectedProviderRow)}</span>
          </button>
          <button className={section === "defaults" ? "is-active" : ""} type="button" onClick={() => setSection("defaults")}>
            <strong>默认配置</strong>
            <span>索引 / 翻译 / 对话</span>
          </button>
          <button className={section === "fields" ? "is-active" : ""} type="button" onClick={() => setSection("fields")}>
            <strong>字段模板</strong>
            <span>{selectedTemplateRow?.name || "未选择"}</span>
          </button>
          <button className={section === "workspaces" ? "is-active" : ""} type="button" onClick={() => setSection("workspaces")}>
            <strong>工作区</strong>
            <span>{currentWorkspaceRow?.name || workspaceId}</span>
          </button>
          <p className="v35-config-status">{currentSectionStatus}</p>
        </aside>

        <main className="v35-config-stage">
          {section === "providers" ? (
            <section className="v35-config-section">
              <div className="v35-config-list">
                {(providersQuery.data ?? []).map((item) => (
                  <button
                    key={item.provider}
                    className={`v35-config-list-item ${item.provider === selectedProvider ? "is-active" : ""}`}
                    type="button"
                    onClick={() => setSelectedProvider(item.provider)}
                  >
                    <strong>{item.provider}</strong>
                    <span>{item.model || "未设置模型"}</span>
                    <em>{item.enabled ? "启用" : "停用"}</em>
                  </button>
                ))}
                <div className="v35-config-create-row">
                  <input className="v35-input" value={newProviderName} onChange={(event) => setNewProviderName(event.target.value)} placeholder="新 Provider 名称" />
                  <button className="v35-button v35-button-primary" type="button" disabled={createProviderMutation.isPending} onClick={() => void createProviderMutation.mutateAsync()}>创建</button>
                </div>
              </div>

              <article className="v35-config-paper">
                <header className="v35-config-paper-head">
                  <div>
                    <p>Provider</p>
                    <h2>{selectedProvider || "未选择"}</h2>
                  </div>
                  <span className={`v35-status ${selectedProviderRow?.enabled ? "is-ok" : "is-muted"}`}>
                    {providerStatus(selectedProviderRow)}
                  </span>
                </header>

                {providerDraft ? (
                  <div className="v35-config-form-grid">
                    <label className="v35-field v35-span-2">
                      <span>Base URL</span>
                      <input className="v35-input" value={providerDraft.baseUrl} onChange={(event) => updateProviderDraft({ baseUrl: event.target.value })} />
                    </label>
                    <div className="v35-model-editor v35-span-2">
                      <div className="v35-model-editor-head">
                        <span>Models</span>
                        <div className="v35-model-add-row">
                          <input className="v35-input" value={newModelName} onChange={(event) => setNewModelName(event.target.value)} placeholder="新增模型名" />
                          <button className="v35-button" type="button" onClick={addProviderModel}>添加</button>
                        </div>
                      </div>
                      <div className="v35-model-list">
                        {providerModels.map((modelName, index) => (
                          <div className={`v35-model-row ${providerDraft.model === modelName ? "is-active" : ""}`} key={`${modelName}_${index}`}>
                            <input className="v35-input" value={modelName} onChange={(event) => renameProviderModel(index, event.target.value)} />
                            <button className="v35-button" type="button" disabled={!modelName.trim()} onClick={() => updateProviderDraft({ model: modelName.trim() })}>设为默认</button>
                            <button className="v35-button" type="button" onClick={() => removeProviderModel(index)}>删除</button>
                          </div>
                        ))}
                        {providerModels.length === 0 ? <p className="v35-muted">先添加一个模型名。</p> : null}
                      </div>
                    </div>
                    <label className="v35-field">
                      <span>Timeout</span>
                      <input className="v35-input" type="number" min="10" max="300" value={providerDraft.timeout} onChange={(event) => updateProviderDraft({ timeout: Number(event.target.value) })} />
                    </label>
                    <label className="v35-field">
                      <span>Temperature</span>
                      <input className="v35-input" type="number" step="0.1" min="0" max="2" value={providerDraft.temperature} onChange={(event) => updateProviderDraft({ temperature: Number(event.target.value) })} />
                    </label>
                    <label className="v35-field v35-span-2">
                      <span>API Key</span>
                      <input className="v35-input" type="password" value={providerDraft.apiKey} placeholder={selectedProviderRow?.api_key_masked || "输入新 API Key"} onChange={(event) => updateProviderDraft({ apiKey: event.target.value, clearApiKey: false })} />
                    </label>
                    <label className="v35-check-line">
                      <input type="checkbox" checked={providerDraft.enabled} onChange={(event) => updateProviderDraft({ enabled: event.target.checked })} />
                      <span>启用</span>
                    </label>
                    <label className="v35-check-line">
                      <input type="checkbox" checked={providerDraft.clearApiKey} onChange={(event) => updateProviderDraft({ apiKey: "", clearApiKey: event.target.checked })} />
                      <span>清空 Key</span>
                    </label>
                  </div>
                ) : (
                  <p className="v35-muted">暂无 Provider</p>
                )}

                <footer className="v35-config-actions">
                  <button className="v35-button v35-button-primary" type="button" disabled={!providerDraft || saveProviderMutation.isPending} onClick={() => void saveProviderMutation.mutateAsync()}>保存</button>
                  <button className="v35-button" type="button" disabled={!providerDraft || testProviderMutation.isPending} onClick={() => void testProviderMutation.mutateAsync()}>测试</button>
                  <button className="v35-button" type="button" disabled={!providerDraft || deleteProviderMutation.isPending} onClick={() => void deleteProviderMutation.mutateAsync()}>删除 Provider</button>
                  <button className="v35-button" type="button" disabled={resetProvidersMutation.isPending} onClick={() => void resetProvidersMutation.mutateAsync()}>恢复默认</button>
                </footer>
              </article>
            </section>
          ) : null}

          {section === "defaults" ? (
            <section className="v35-config-section">
              <div className="v35-config-list">
                <button className="v35-config-list-item is-active" type="button">
                  <strong>默认模型</strong>
                  <span>{availableModelEntries.length} available</span>
                  <em>本地偏好</em>
                </button>
              </div>

              <article className="v35-config-paper">
                <header className="v35-config-paper-head">
                  <div>
                    <p>Defaults</p>
                    <h2>指定三个工作流的默认模型</h2>
                  </div>
                </header>

                <div className="v35-config-form-grid">
                  <label className="v35-field v35-span-2">
                    <span>生成索引</span>
                    <select className="v35-input" value={modelDefaultsDraft.indexing} onChange={(event) => setModelDefaultsDraft((current) => ({ ...current, indexing: event.target.value }))}>
                      <option value="">未指定</option>
                      {availableModelEntries.map((entry) => (
                        <option key={`indexing_${entry.provider}_${entry.model}`} value={`${entry.provider}::${entry.model}`}>{entry.provider} · {entry.model}</option>
                      ))}
                    </select>
                  </label>
                  <label className="v35-field v35-span-2">
                    <span>翻译</span>
                    <select className="v35-input" value={modelDefaultsDraft.translation} onChange={(event) => setModelDefaultsDraft((current) => ({ ...current, translation: event.target.value }))}>
                      <option value="">未指定</option>
                      {availableModelEntries.map((entry) => (
                        <option key={`translation_${entry.provider}_${entry.model}`} value={`${entry.provider}::${entry.model}`}>{entry.provider} · {entry.model}</option>
                      ))}
                    </select>
                  </label>
                  <label className="v35-field v35-span-2">
                    <span>对话</span>
                    <select className="v35-input" value={modelDefaultsDraft.chat} onChange={(event) => setModelDefaultsDraft((current) => ({ ...current, chat: event.target.value }))}>
                      <option value="">未指定</option>
                      {availableModelEntries.map((entry) => (
                        <option key={`chat_${entry.provider}_${entry.model}`} value={`${entry.provider}::${entry.model}`}>{entry.provider} · {entry.model}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <footer className="v35-config-actions">
                  <button className="v35-button v35-button-primary" type="button" disabled={saveDefaultsMutation.isPending} onClick={() => void saveDefaultsMutation.mutateAsync()}>保存默认配置</button>
                </footer>
              </article>
            </section>
          ) : null}

          {section === "fields" ? (
            <section className="v35-config-section">
              <div className="v35-config-list">
                {(templatesQuery.data ?? []).map((template) => (
                  <button
                    key={template.id}
                    className={`v35-config-list-item ${template.id === selectedTemplateId ? "is-active" : ""}`}
                    type="button"
                    onClick={() => setSelectedTemplateId(template.id)}
                  >
                    <strong>{template.name}</strong>
                    <span>{template.field_count} fields</span>
                    {template.is_default ? <em>默认</em> : null}
                  </button>
                ))}
                <div className="v35-config-create-row">
                  <input className="v35-input" value={newTemplateName} onChange={(event) => setNewTemplateName(event.target.value)} placeholder="新模板" />
                  <button className="v35-button v35-button-primary" type="button" disabled={createTemplateMutation.isPending} onClick={() => void createTemplateMutation.mutateAsync()}>创建</button>
                </div>
              </div>

              <article className="v35-config-paper">
                <header className="v35-config-paper-head">
                  <div>
                    <p>Template</p>
                    <h2>{selectedTemplateRow?.name || "未选择"}</h2>
                  </div>
                  <button className="v35-button" type="button" onClick={addField}>新增字段</button>
                </header>

                <div className="v35-config-form-grid">
                  <label className="v35-field">
                    <span>模板名称</span>
                    <input className="v35-input" value={templateNameDraft} onChange={(event) => setTemplateNameDraft(event.target.value)} />
                  </label>
                  <label className="v35-field v35-span-2">
                    <span>描述</span>
                    <textarea className="v35-textarea" value={templateDescriptionDraft} onChange={(event) => setTemplateDescriptionDraft(event.target.value)} />
                  </label>
                </div>

                <div className="v35-template-designer">
                  <div className="v35-field-strip" aria-label="字段目录">
                    {fieldDrafts.map((field, index) => (
                      <button
                        className={`v35-field-token ${index === activeFieldIndex ? "is-active" : ""}`}
                        key={`${field.field_key || "new"}_${index}`}
                        type="button"
                        onClick={() => setActiveFieldIndex(index)}
                      >
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <strong>{String(field.label || "未命名字段")}</strong>
                        <em>{String(field.field_type || "text")}</em>
                      </button>
                    ))}
                    {fieldDrafts.length === 0 ? <p className="v35-muted">点击“新增字段”开始。</p> : null}
                  </div>

                  <article className="v35-field-inspector">
                    {activeField ? (
                      <>
                        <header className="v35-field-inspector-head">
                          <div>
                            <p>Field #{activeFieldIndex + 1}</p>
                            <h3>{String(activeField.label || "未命名字段")}</h3>
                          </div>
                          <button className="v35-button" type="button" onClick={() => removeField(activeFieldIndex)}>删除</button>
                        </header>
                        <div className="v35-config-form-grid">
                          <label className="v35-field">
                            <span>显示名称</span>
                            <input className="v35-input" value={String(activeField.label)} onChange={(event) => updateField(activeFieldIndex, { label: event.target.value })} />
                          </label>
                          <label className="v35-field">
                            <span>字段 Key</span>
                            <input className="v35-input" value={String(activeField.field_key)} onChange={(event) => updateField(activeFieldIndex, { field_key: event.target.value })} />
                          </label>
                          <label className="v35-field">
                            <span>类型</span>
                            <select className="v35-input" value={String(activeField.field_type)} onChange={(event) => updateField(activeFieldIndex, { field_type: event.target.value })}>
                              <option value="text">text</option>
                              <option value="number">number</option>
                              <option value="list">list</option>
                            </select>
                          </label>
                          <div className="v35-field-flags">
                            <label className="v35-check-line"><input type="checkbox" checked={toBoolean(activeField.required)} onChange={(event) => updateField(activeFieldIndex, { required: event.target.checked })} /><span>必填</span></label>
                            <label className="v35-check-line"><input type="checkbox" checked={toBoolean(activeField.enabled)} onChange={(event) => updateField(activeFieldIndex, { enabled: event.target.checked })} /><span>启用</span></label>
                          </div>
                          <label className="v35-field v35-span-2">
                            <span>提取提示</span>
                            <textarea className="v35-textarea" value={String(activeField.description || "")} placeholder="一句话说明这个字段应该如何从文献中提取。" onChange={(event) => updateField(activeFieldIndex, { description: event.target.value })} />
                          </label>
                        </div>
                      </>
                    ) : (
                      <p className="v35-muted">暂无字段。</p>
                    )}
                  </article>
                </div>

                <footer className="v35-config-actions">
                  <button className="v35-button v35-button-primary" type="button" disabled={saveFieldsMutation.isPending} onClick={() => void saveFieldsMutation.mutateAsync()}>保存字段</button>
                  <button className="v35-button" type="button" disabled={updateTemplateMutation.isPending} onClick={() => void updateTemplateMutation.mutateAsync()}>保存模板</button>
                  <button className="v35-button" type="button" disabled={resetFieldsMutation.isPending} onClick={() => void resetFieldsMutation.mutateAsync()}>恢复字段</button>
                  <button className="v35-button" type="button" disabled={!selectedTemplateRow || selectedTemplateRow.is_default || deleteTemplateMutation.isPending} onClick={() => void deleteTemplateMutation.mutateAsync()}>删除模板</button>
                </footer>
              </article>
            </section>
          ) : null}

          {section === "workspaces" ? (
            <section className="v35-config-section">
              <div className="v35-config-list">
                {(workspacesQuery.data ?? []).map((workspace) => (
                  <button
                    key={workspace.id}
                    className={`v35-config-list-item ${workspace.id === workspaceId ? "is-active" : ""}`}
                    type="button"
                    onClick={() => setWorkspaceId(workspace.id)}
                  >
                    <strong>{workspace.name}</strong>
                    <span>{workspace.document_count} docs</span>
                    {workspace.id === DEFAULT_WORKSPACE_ID ? <em>默认</em> : null}
                  </button>
                ))}
                <div className="v35-config-create-row">
                  <input className="v35-input" value={newWorkspaceName} onChange={(event) => setNewWorkspaceName(event.target.value)} placeholder="新工作区" />
                  <button className="v35-button v35-button-primary" type="button" disabled={createWorkspaceMutation.isPending} onClick={() => void createWorkspaceMutation.mutateAsync()}>创建</button>
                </div>
              </div>

              <article className="v35-config-paper">
                <header className="v35-config-paper-head">
                  <div>
                    <p>Workspace</p>
                    <h2>{currentWorkspaceRow?.name || workspaceId}</h2>
                  </div>
                  <span className="v35-status is-ok">{currentWorkspaceRow?.document_count ?? 0} docs</span>
                </header>

                <div className="v35-config-form-grid">
                  <label className="v35-field">
                    <span>名称</span>
                    <input className="v35-input" value={workspaceNameDraft} onChange={(event) => setWorkspaceNameDraft(event.target.value)} />
                  </label>
                  <label className="v35-field">
                    <span>ID</span>
                    <input className="v35-input" value={currentWorkspaceRow?.id || ""} readOnly />
                  </label>
                  <label className="v35-field">
                    <span>文档数量</span>
                    <input className="v35-input" value={currentWorkspaceRow?.document_count ?? 0} readOnly />
                  </label>
                </div>

                <footer className="v35-config-actions">
                  <button className="v35-button v35-button-primary" type="button" disabled={!currentWorkspaceRow || renameWorkspaceMutation.isPending} onClick={() => void renameWorkspaceMutation.mutateAsync()}>保存名称</button>
                  <button className="v35-button" type="button" disabled={!currentWorkspaceRow || workspaceId === DEFAULT_WORKSPACE_ID || deleteWorkspaceMutation.isPending} onClick={() => void deleteWorkspaceMutation.mutateAsync()}>删除工作区</button>
                </footer>
              </article>
            </section>
          ) : null}
        </main>
      </div>
    </section>
  );
}
