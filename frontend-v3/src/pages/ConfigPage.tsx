import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getDefaultConfigPageSession, usePageSessionStore, type ConfigPageSection } from "../app/pageSessionStore";
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
  type ModelRegistryResolution,
  type ProviderRegistryModelOption,
  type ProviderRegistryResolvedModel,
  type ProviderSummary,
  listProviders,
  resolveModelRegistryEntries,
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
import {
  type UsageBreakdownBy,
  type UsageBucket,
  type UsagePeriod,
  getUsageSummary,
  listPricingRules,
  savePricingRule,
} from "../shared/api/usage";
import { UI_LAYOUT_SIZE_OPTIONS, useShellStore, type UiLayoutSize } from "../app/shellStore";
import { getModelDefaults, setModelDefaults, type ModelDefaults } from "../shared/lib/modelDefaults";
import { setProviderModels, useAvailableProviderModelEntries, useProviderModels } from "../shared/lib/providerModels";
import { isDesktopShell } from "../shared/lib/runtime";

type ConfigSection = ConfigPageSection;

interface ProviderDraft {
  baseUrl: string;
  model: string;
  apiKey: string;
  clearApiKey: boolean;
  temperature: number;
  timeout: number;
  enabled: boolean;
}

interface PricingDraft {
  inputPrice: string;
  outputPrice: string;
}

function uniqueTrimmed(values: string[]): string[] {
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))];
}

function normalizeModelLookupKey(value: string): string {
  return String(value || "").trim().toLowerCase();
}

function compactTokenLabel(value?: number | null): string {
  if (!value || value <= 0) return "-";
  if (value >= 1_000_000) {
    return `${Math.round((value / 1_000_000) * 10) / 10}M`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}K`;
  }
  return String(value);
}

function modelCapabilitySummary(model: Pick<ProviderRegistryModelOption, "supports_streaming" | "supports_multimodal_input" | "supports_tool_calls" | "supports_thinking" | "context_window_tokens" | "max_output_tokens"> | Pick<ProviderRegistryResolvedModel, "supports_streaming" | "supports_multimodal_input" | "supports_tool_calls" | "supports_thinking" | "context_window_tokens" | "max_output_tokens"> | null): string {
  if (!model) return "";
  const flags = [
    model.supports_streaming ? "流式" : null,
    model.supports_multimodal_input ? "多模态" : null,
    model.supports_tool_calls ? "工具" : null,
    model.supports_thinking ? "推理" : null,
  ].filter(Boolean);
  const context = compactTokenLabel(model.context_window_tokens);
  const output = compactTokenLabel(model.max_output_tokens);
  const meta = [`上下文 ${context}`, output !== "-" ? `输出 ${output}` : null].filter(Boolean);
  return [...flags, ...meta].join(" · ");
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

function compactNumber(value?: number | null): string {
  const numberValue = Number(value || 0);
  if (numberValue >= 1_000_000) return `${(numberValue / 1_000_000).toFixed(1)}M`;
  if (numberValue >= 1_000) return `${Math.round(numberValue / 1_000)}K`;
  return new Intl.NumberFormat("zh-CN").format(numberValue);
}

function formatCost(value?: number | null): string {
  return `￥${Number(value || 0).toFixed(4)}`;
}

function usageFeatureLabel(value: string): string {
  if (value === "indexing") return "索引";
  if (value === "translation") return "翻译";
  if (value === "chat") return "问答";
  return value || "全部";
}

function usageBreakdownLabel(value: UsageBreakdownBy): string {
  if (value === "provider") return "Provider";
  if (value === "model") return "模型";
  if (value === "feature") return "功能";
  return "API Key";
}

function usageDimensionValueLabel(dimension: UsageBreakdownBy, value: string): string {
  if (dimension === "feature") {
    return usageFeatureLabel(value);
  }
  if (dimension === "api_key_fingerprint") {
    return value || "无 Key";
  }
  return value || "未设置";
}

function usageDimensionButtonLabel(value: UsageBreakdownBy): string {
  if (value === "api_key_fingerprint") return "apikey";
  return value;
}

const GLOBAL_PRICING_PROVIDER = "__global__";

function pricingPayloadFromDraft(draft: PricingDraft) {
  return {
    provider: GLOBAL_PRICING_PROVIDER,
    model: null,
    api_key_fingerprint: null,
    input_price_per_1m: Number(draft.inputPrice || 0),
    output_price_per_1m: Number(draft.outputPrice || 0),
    currency: "RMB",
  };
}

const USAGE_BREAKDOWN_ORDER: UsageBreakdownBy[] = ["provider", "model", "feature", "api_key_fingerprint"];
const USAGE_STACK_COLORS = [
  "is-sand",
  "is-copper",
  "is-olive",
  "is-slate",
  "is-rosewood",
  "is-ink",
] as const;

function ConfigSectionIcon({ section }: { section: ConfigSection }) {
  if (section === "providers") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12" /><path d="M4 10h12" /><path d="M4 14h8" /><circle cx="14.5" cy="14" r="1.5" fill="currentColor" stroke="none" /></svg>;
  }
  if (section === "defaults") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.2v2.2" /><path d="M10 13.6v2.2" /><path d="m5.9 5.9 1.6 1.6" /><path d="m12.5 12.5 1.6 1.6" /><path d="M4.2 10h2.2" /><path d="M13.6 10h2.2" /><path d="m5.9 14.1 1.6-1.6" /><path d="m12.5 7.5 1.6-1.6" /><circle cx="10" cy="10" r="2.6" /></svg>;
  }
  if (section === "fields") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5h10" /><path d="M5 10h10" /><path d="M5 15h6" /><path d="M13 13.5h2.5V16" /></svg>;
  }
  if (section === "workspaces") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.8 6.2A1.2 1.2 0 0 1 5 5h10a1.2 1.2 0 0 1 1.2 1.2v7.6A1.2 1.2 0 0 1 15 15H5a1.2 1.2 0 0 1-1.2-1.2Z" /><path d="M6.5 5V3.8h7V5" /></svg>;
  }
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 14h2.8" /><path d="M8.8 14h2.4" /><path d="M12.2 14H15" /><path d="M6.2 10.5h1.6v3H6.2z" /><path d="M9.2 8.5h1.6V14H9.2z" /><path d="M12.2 6.5h1.6V14h-1.6z" /></svg>;
}

export function ConfigPage() {
  const desktopShell = isDesktopShell();
  const queryClient = useQueryClient();
  const uiLayoutSize = useShellStore((state) => state.uiLayoutSize);
  const setUiLayoutSize = useShellStore((state) => state.setUiLayoutSize);
  const workspaceId = useWorkspaceStore((state) => state.workspaceId);
  const setWorkspaceId = useWorkspaceStore((state) => state.setWorkspaceId);
  const configSession = usePageSessionStore((state) => state.configByWorkspace[workspaceId] ?? getDefaultConfigPageSession());
  const ensureConfigSession = usePageSessionStore((state) => state.ensureConfigSession);
  const updateConfigSession = usePageSessionStore((state) => state.updateConfigSession);

  const section = configSession.section;
  const selectedProvider = configSession.selectedProvider;
  const selectedTemplateId = configSession.selectedTemplateId;
  const activeFieldIndex = configSession.activeFieldIndex;
  const usagePeriod = configSession.usagePeriod;
  const usageBreakdownBy = configSession.usageBreakdownBy;
  const selectedUsageLegend = configSession.selectedUsageLegend;
  const setSection = useCallback((next: ConfigSection) => {
    updateConfigSession(workspaceId, { section: next });
  }, [updateConfigSession, workspaceId]);
  const setSelectedProvider = useCallback((next: string) => {
    updateConfigSession(workspaceId, { selectedProvider: next });
  }, [updateConfigSession, workspaceId]);
  const setSelectedTemplateId = useCallback((next: string) => {
    updateConfigSession(workspaceId, { selectedTemplateId: next });
  }, [updateConfigSession, workspaceId]);
  const setActiveFieldIndex = useCallback((next: number) => {
    updateConfigSession(workspaceId, { activeFieldIndex: next });
  }, [updateConfigSession, workspaceId]);
  const setUsagePeriod = useCallback((next: UsagePeriod) => {
    updateConfigSession(workspaceId, { usagePeriod: next, selectedUsageLegend: "" });
  }, [updateConfigSession, workspaceId]);
  const setUsageBreakdownBy = useCallback((next: UsageBreakdownBy) => {
    updateConfigSession(workspaceId, { usageBreakdownBy: next, selectedUsageLegend: "" });
  }, [updateConfigSession, workspaceId]);
  const setSelectedUsageLegend = useCallback((next: string | ((current: string) => string)) => {
    updateConfigSession(workspaceId, (current) => ({
      selectedUsageLegend: typeof next === "function" ? next(current.selectedUsageLegend) : next,
    }));
  }, [updateConfigSession, workspaceId]);

  const [newProviderName, setNewProviderName] = useState("");
  const [providerDraft, setProviderDraft] = useState<ProviderDraft | null>(null);
  const [providerModels, setProviderModelRows] = useState<string[]>([]);
  const [newModelName, setNewModelName] = useState("");
  const [providerMessage, setProviderMessage] = useState("准备就绪");

  const [modelDefaultsDraft, setModelDefaultsDraft] = useState<ModelDefaults>(() => getModelDefaults());
  const [defaultsMessage, setDefaultsMessage] = useState("准备就绪");

  const [newTemplateName, setNewTemplateName] = useState("");
  const [templateNameDraft, setTemplateNameDraft] = useState("");
  const [templateDescriptionDraft, setTemplateDescriptionDraft] = useState("");
  const [fieldDrafts, setFieldDrafts] = useState<FieldDefinition[]>([]);
  const [fieldsMessage, setFieldsMessage] = useState("准备就绪");

  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState("");
  const [workspaceMessage, setWorkspaceMessage] = useState("准备就绪");

  const [usageMessage, setUsageMessage] = useState("准备就绪");
  const [pricingDraft, setPricingDraft] = useState<PricingDraft>({
    inputPrice: "",
    outputPrice: "",
  });

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

  const modelRegistryQuery = useQuery({
    queryKey: ["provider-model-registry-resolve", providerModels],
    queryFn: () => resolveModelRegistryEntries(providerModels),
    enabled: providerModels.length > 0,
  });

  const usageSummaryQuery = useQuery({
    queryKey: ["usage-summary", workspaceId, usagePeriod, usageBreakdownBy],
    queryFn: () => getUsageSummary({
      workspaceId,
      period: usagePeriod,
      breakdownBy: usageBreakdownBy,
    }),
  });

  const pricingQuery = useQuery({
    queryKey: ["usage-pricing"],
    queryFn: listPricingRules,
  });

  const selectedProviderRow = useMemo(() => {
    return providersQuery.data?.find((item) => item.provider === selectedProvider) ?? null;
  }, [providersQuery.data, selectedProvider]);
  const storedProviderModels = useProviderModels(selectedProviderRow?.provider ?? "", selectedProviderRow?.model);

  const baseUrlSuggestions = useMemo(() => {
    return uniqueTrimmed([
      String(selectedProviderRow?.base_url || ""),
      String(selectedProviderRow?.registry?.provider.recommended_base_url || ""),
      ...((selectedProviderRow?.registry?.provider.base_urls ?? []).map((item) => item.url)),
    ]);
  }, [selectedProviderRow]);

  const modelSuggestions = useMemo(() => {
    return uniqueTrimmed([
      String(selectedProviderRow?.model || ""),
      ...providerModels,
      ...((selectedProviderRow?.registry?.provider.models ?? []).map((item) => item.id)),
    ]);
  }, [providerModels, selectedProviderRow]);

  const addableModelSuggestions = useMemo(() => {
    return modelSuggestions.filter((item) => !providerModels.includes(item));
  }, [modelSuggestions, providerModels]);

  const resolvedModelMap = useMemo(() => {
    const map = new Map<string, ModelRegistryResolution>();
    for (const item of modelRegistryQuery.data ?? []) {
      const key = normalizeModelLookupKey(item.input_name);
      if (key) {
        map.set(key, item);
      }
    }
    return map;
  }, [modelRegistryQuery.data]);

  const selectedTemplateRow = useMemo<FieldTemplate | null>(() => {
    return templatesQuery.data?.find((item) => item.id === selectedTemplateId) ?? null;
  }, [selectedTemplateId, templatesQuery.data]);

  const currentWorkspaceRow = useMemo(() => {
    return workspacesQuery.data?.find((item) => item.id === workspaceId) ?? null;
  }, [workspaceId, workspacesQuery.data]);

  const availableModelEntries = useAvailableProviderModelEntries(providersQuery.data ?? []);

  const usageBuckets = usageSummaryQuery.data?.buckets ?? [];
  const usageTotals = usageSummaryQuery.data?.totals ?? {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    request_count: 0,
    estimated_cost: 0,
    dimension_breakdown: {},
    dimension_metrics: {},
  };
  const maxBucketTokens = Math.max(1, ...usageBuckets.map((item) => item.total_tokens));
  const usageAxisTicks = [1, 0.75, 0.5, 0.25, 0].map((ratio) => ({
    ratio,
    value: Math.round(maxBucketTokens * ratio),
  }));
  const usageLegendItems = Object.entries(usageTotals.dimension_breakdown)
    .sort((left, right) => right[1] - left[1])
    .map(([value, tokens], index) => ({
      value,
      label: usageDimensionValueLabel(usageBreakdownBy, value),
      tokens,
      share: usageTotals.total_tokens > 0 ? tokens / usageTotals.total_tokens : 0,
      colorClass: USAGE_STACK_COLORS[index % USAGE_STACK_COLORS.length],
    }));
  const activeUsageMetrics = selectedUsageLegend
    ? usageTotals.dimension_metrics[selectedUsageLegend] ?? {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        request_count: 0,
        estimated_cost: 0,
      }
    : usageTotals;

  useEffect(() => {
    ensureConfigSession(workspaceId);
  }, [ensureConfigSession, workspaceId]);

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
    setProviderDraft({
      baseUrl: String(selectedProviderRow.base_url || ""),
      model: String(selectedProviderRow.model || ""),
      apiKey: "",
      clearApiKey: false,
      temperature: Number(selectedProviderRow.temperature ?? 0.1),
      timeout: Number(selectedProviderRow.timeout ?? 120),
      enabled: Boolean(selectedProviderRow.enabled),
    });
    setProviderModelRows(storedProviderModels);
  }, [selectedProviderRow, storedProviderModels]);

  useEffect(() => {
    if (selectedUsageLegend && !usageLegendItems.some((item) => item.value === selectedUsageLegend)) {
      setSelectedUsageLegend("");
    }
  }, [selectedUsageLegend, usageLegendItems]);

  useEffect(() => {
    const globalRule = pricingQuery.data?.find(
      (rule) => rule.provider === GLOBAL_PRICING_PROVIDER && !rule.model && !rule.api_key_fingerprint,
    );
    if (!globalRule) {
      return;
    }
    setPricingDraft({
      inputPrice: String(globalRule.input_price_per_1m || ""),
      outputPrice: String(globalRule.output_price_per_1m || ""),
    });
  }, [pricingQuery.data]);

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
      const baseUrl = String(source?.registry?.provider.recommended_base_url || source?.base_url || "https://api.openai.com/v1").trim();
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

  const savePricingMutation = useMutation({
    mutationFn: async () => {
      return savePricingRule(pricingPayloadFromDraft(pricingDraft));
    },
    onSuccess: async () => {
      setUsageMessage("价格已保存");
      await queryClient.invalidateQueries({ queryKey: ["usage-pricing"] });
      await queryClient.invalidateQueries({ queryKey: ["usage-summary"] });
    },
    onError: (error) => {
      setUsageMessage(error instanceof Error ? error.message : "保存失败");
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
          : section === "workspaces"
            ? workspaceMessage
            : usageMessage;
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
            <span className="v35-config-nav-icon" aria-hidden="true"><ConfigSectionIcon section="providers" /></span>
            <span className="v35-config-nav-copy">
              <strong>Provider</strong>
              <span>{providerStatus(selectedProviderRow)}</span>
            </span>
          </button>
          <button className={section === "defaults" ? "is-active" : ""} type="button" onClick={() => setSection("defaults")}>
            <span className="v35-config-nav-icon" aria-hidden="true"><ConfigSectionIcon section="defaults" /></span>
            <span className="v35-config-nav-copy">
              <strong>默认配置</strong>
              <span>{desktopShell ? "3 workflows" : "索引 / 翻译 / 对话"}</span>
            </span>
          </button>
          <button className={section === "fields" ? "is-active" : ""} type="button" onClick={() => setSection("fields")}>
            <span className="v35-config-nav-icon" aria-hidden="true"><ConfigSectionIcon section="fields" /></span>
            <span className="v35-config-nav-copy">
              <strong>字段模板</strong>
              <span>{selectedTemplateRow?.name || "未选择"}</span>
            </span>
          </button>
          <button className={section === "workspaces" ? "is-active" : ""} type="button" onClick={() => setSection("workspaces")}>
            <span className="v35-config-nav-icon" aria-hidden="true"><ConfigSectionIcon section="workspaces" /></span>
            <span className="v35-config-nav-copy">
              <strong>工作区</strong>
              <span>{currentWorkspaceRow?.name || workspaceId}</span>
            </span>
          </button>
          <button className={section === "usage" ? "is-active" : ""} type="button" onClick={() => setSection("usage")}>
            <span className="v35-config-nav-icon" aria-hidden="true"><ConfigSectionIcon section="usage" /></span>
            <span className="v35-config-nav-copy">
              <strong>用量</strong>
              <span>{compactNumber(usageTotals.total_tokens)} tokens</span>
            </span>
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
                    <em>{providerStatus(item)}</em>
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
                  <div className="v35-provider-head-actions">
                    <span className={`v35-status ${selectedProviderRow?.enabled ? "is-ok" : "is-muted"}`}>{providerStatus(selectedProviderRow)}</span>
                    <button className="v35-button" type="button" disabled={!providerDraft || testProviderMutation.isPending} onClick={() => void testProviderMutation.mutateAsync()}>测试</button>
                    <button className="v35-button v35-button-primary" type="button" disabled={!providerDraft || saveProviderMutation.isPending} onClick={() => void saveProviderMutation.mutateAsync()}>保存</button>
                  </div>
                </header>

                {providerDraft ? (
                  <>
                    <datalist id="v35-provider-base-urls">
                      {baseUrlSuggestions.map((url) => {
                        const match = selectedProviderRow?.registry?.provider.base_urls.find((item) => item.url === url);
                        return <option key={url} value={url} label={match?.label || url} />;
                      })}
                    </datalist>
                    <datalist id="v35-provider-addable-models">
                      {addableModelSuggestions.map((modelName) => {
                        const match = selectedProviderRow?.registry?.provider.models.find((item) => item.id === modelName);
                        return <option key={modelName} value={modelName} label={match?.display_name || modelName} />;
                      })}
                    </datalist>

                    <div className="v35-provider-editor">
                      <section className="v35-provider-block">
                        <div className="v35-provider-block-head">
                          <span>连接</span>
                          {selectedProviderRow?.registry?.provider.recommended_api_style ? <em>{selectedProviderRow.registry.provider.recommended_api_style}</em> : null}
                        </div>
                        <label className="v35-field">
                          <span>Base URL</span>
                          <input className="v35-input" list="v35-provider-base-urls" value={providerDraft.baseUrl} placeholder={selectedProviderRow?.registry?.provider.recommended_base_url || "输入 Base URL"} onChange={(event) => updateProviderDraft({ baseUrl: event.target.value })} />
                        </label>
                        <label className="v35-field">
                          <span>API Key</span>
                          <input className="v35-input" type="password" value={providerDraft.apiKey} placeholder={selectedProviderRow?.api_key_masked || "输入新 API Key"} onChange={(event) => updateProviderDraft({ apiKey: event.target.value, clearApiKey: false })} />
                        </label>
                        <div className="v35-provider-flags">
                          <label className="v35-check-line">
                            <input type="checkbox" checked={providerDraft.enabled} onChange={(event) => updateProviderDraft({ enabled: event.target.checked })} />
                            <span>启用</span>
                          </label>
                          <label className="v35-check-line">
                            <input type="checkbox" checked={providerDraft.clearApiKey} onChange={(event) => updateProviderDraft({ apiKey: "", clearApiKey: event.target.checked })} />
                            <span>清空 Key</span>
                          </label>
                        </div>
                      </section>

                      <section className="v35-provider-block">
                        <div className="v35-provider-block-head">
                          <span>模型</span>
                        </div>
                        <div className="v35-model-add-row">
                          <input className="v35-input" list="v35-provider-addable-models" value={newModelName} onChange={(event) => setNewModelName(event.target.value)} placeholder="添加模型并设为默认" />
                          <button className="v35-button" type="button" onClick={addProviderModel}>添加</button>
                        </div>
                        <div className="v35-provider-model-list">
                          {providerModels.map((modelName, index) => {
                            const resolution = resolvedModelMap.get(normalizeModelLookupKey(modelName));
                            const summary = modelCapabilitySummary(resolution?.resolved ?? null);
                            return (
                              <div className={`v35-provider-model-option ${providerDraft.model === modelName ? "is-active" : ""}`} key={`${modelName}_${index}`}>
                                <button type="button" onClick={() => updateProviderDraft({ model: modelName.trim() })}>
                                  <strong>{modelName}</strong>
                                  {summary ? <span>{summary}</span> : null}
                                </button>
                                <button type="button" onClick={() => removeProviderModel(index)}>删除</button>
                              </div>
                            );
                          })}
                          {providerModels.length === 0 ? <p className="v35-muted">暂无模型。</p> : null}
                        </div>
                        <div className="v35-provider-number-row">
                          <label className="v35-field">
                            <span>Timeout</span>
                            <input className="v35-input" type="number" min="10" max="300" value={providerDraft.timeout} onChange={(event) => updateProviderDraft({ timeout: Number(event.target.value) })} />
                          </label>
                          <label className="v35-field">
                            <span>Temperature</span>
                            <input className="v35-input" type="number" step="0.1" min="0" max="2" value={providerDraft.temperature} onChange={(event) => updateProviderDraft({ temperature: Number(event.target.value) })} />
                          </label>
                        </div>
                      </section>
                    </div>
                  </>
                ) : (
                  <p className="v35-muted">暂无 Provider</p>
                )}

                <footer className="v35-config-actions">
                  <button className="v35-button" type="button" disabled={!providerDraft || deleteProviderMutation.isPending} onClick={() => void deleteProviderMutation.mutateAsync()}>删除 Provider</button>
                  <button className="v35-button" type="button" disabled={resetProvidersMutation.isPending} onClick={() => void resetProvidersMutation.mutateAsync()}>恢复默认</button>
                </footer>
              </article>
            </section>
          ) : null}

          {section === "defaults" ? (
            <section className="v35-config-section">
              <div className="v35-config-list">
                <div className="v35-config-list-item is-active">
                  <strong>界面尺寸</strong>
                  <span>{UI_LAYOUT_SIZE_OPTIONS.find((option) => option.value === uiLayoutSize)?.label ?? "大"}</span>
                  <em>当前布局</em>
                </div>
                <div className="v35-config-list-item">
                  <strong>默认模型</strong>
                  <span>{availableModelEntries.length} available</span>
                  <em>本地偏好</em>
                </div>
              </div>

              <article className="v35-config-paper v35-config-paper-defaults">
                <header className="v35-config-paper-head">
                  <div>
                    <p>Defaults</p>
                    <h2>指定默认模型与界面尺寸</h2>
                  </div>
                </header>

                <div className="v35-config-form-grid">
                  <div className="v35-field v35-span-2">
                    <span>字体布局大小</span>
                    <div className="v35-ui-size-switch" role="radiogroup" aria-label="字体布局大小">
                      {UI_LAYOUT_SIZE_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          className={uiLayoutSize === option.value ? "is-active" : ""}
                          type="button"
                          role="radio"
                          aria-checked={uiLayoutSize === option.value}
                          onClick={() => {
                            setUiLayoutSize(option.value as UiLayoutSize);
                            setDefaultsMessage(`界面尺寸已切换为${option.label}`);
                          }}
                        >
                          <strong>{option.label}</strong>
                          <span>{option.description}</span>
                        </button>
                      ))}
                    </div>
                  </div>
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

              <article className="v35-config-paper v35-config-paper-fields">
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

          {section === "usage" ? (
            <section className="v35-config-section v35-usage-section">
              <div className="v35-config-list v35-usage-filters">
                <div className="v35-usage-period-switch" aria-label="统计周期">
                  <button className={usagePeriod === "day" ? "is-active" : ""} type="button" onClick={() => setUsagePeriod("day")}>日</button>
                  <button className={usagePeriod === "month" ? "is-active" : ""} type="button" onClick={() => setUsagePeriod("month")}>月</button>
                </div>
                <div className="v35-usage-dimension-switch" aria-label="统计维度">
                  {USAGE_BREAKDOWN_ORDER.map((dimension) => (
                    <button className={usageBreakdownBy === dimension ? "is-active" : ""} key={dimension} type="button" onClick={() => setUsageBreakdownBy(dimension)}>
                      {usageDimensionButtonLabel(dimension)}
                    </button>
                  ))}
                </div>
              </div>

              <article className="v35-config-paper v35-usage-paper">
                <header className="v35-config-paper-head">
                  <div>
                    <p>Usage & Budget</p>
                    <h2>用量与预算（估计值）</h2>
                  </div>
                  <span className="v35-status is-ok">{usageBreakdownLabel(usageBreakdownBy)}</span>
                </header>

                <div className="v35-usage-metrics">
                  <div><span>输入</span><strong>{compactNumber(activeUsageMetrics.input_tokens)}</strong></div>
                  <div><span>输出</span><strong>{compactNumber(activeUsageMetrics.output_tokens)}</strong></div>
                  <div><span>请求</span><strong>{compactNumber(activeUsageMetrics.request_count)}</strong></div>
                  <div><span>预算</span><strong>{formatCost(activeUsageMetrics.estimated_cost)}</strong></div>
                </div>

                <div className="v35-usage-legend" aria-label="维度图例">
                  {usageLegendItems.map((item) => (
                    <button className={`v35-usage-legend-item ${selectedUsageLegend === item.value ? "is-active" : ""}`} key={item.value} type="button" onClick={() => setSelectedUsageLegend((current) => current === item.value ? "" : item.value)}>
                      <i className={`v35-usage-swatch ${item.colorClass}`} />
                      <em>{item.label}</em>
                      <strong>{Math.round(item.share * 100)}%</strong>
                    </button>
                  ))}
                  {usageLegendItems.length === 0 ? <span className="v35-muted">暂无图例</span> : null}
                </div>

                <div className="v35-usage-chart-frame" onClick={(event) => {
                  const target = event.target as HTMLElement;
                  if (!target.closest(".v35-usage-bar-item")) {
                    setSelectedUsageLegend("");
                  }
                }}>
                  <div className="v35-usage-axis" aria-hidden="true">
                    {usageAxisTicks.map((tick) => <span key={`${tick.ratio}_${tick.value}`}>{compactNumber(tick.value)}</span>)}
                  </div>
                  <div className="v35-usage-chart" aria-label="token 用量柱状图">
                    {usageBuckets.map((bucket: UsageBucket) => {
                      const totalHeight = Math.max(6, Math.round((bucket.total_tokens / maxBucketTokens) * 100));
                      return (
                        <div className="v35-usage-bar-item" key={bucket.bucket} title={`${bucket.bucket} · ${compactNumber(bucket.total_tokens)} tokens`}>
                          <div className="v35-usage-bar-track">
                            <div className="v35-usage-bar" style={{ height: `${totalHeight}%` }}>
                              {usageLegendItems.filter((item) => Number(bucket.dimension_breakdown[item.value] || 0) > 0).map((item) => {
                                const share = bucket.total_tokens > 0 ? Math.max(8, Math.round((Number(bucket.dimension_breakdown[item.value] || 0) / bucket.total_tokens) * 100)) : 0;
                                const segmentClass = selectedUsageLegend
                                  ? selectedUsageLegend === item.value
                                    ? `${item.colorClass} is-highlighted`
                                    : `${item.colorClass} is-dimmed`
                                  : item.colorClass;
                                return <span className={segmentClass} key={`${bucket.bucket}_${item.value}`} style={{ height: `${share}%` }} />;
                              })}
                            </div>
                          </div>
                          <strong>{usagePeriod === "month" ? bucket.bucket.slice(5) : bucket.bucket.slice(5).replace("-", "/")}</strong>
                          <em>{compactNumber(bucket.total_tokens)}</em>
                        </div>
                      );
                    })}
                    {usageBuckets.length === 0 ? <p className="v35-muted">暂无记录。</p> : null}
                  </div>
                </div>

                <section className="v35-usage-pricing">
                  <div className="v35-usage-pricing-form">
                    <input className="v35-input" type="number" min="0" step="0.0001" value={pricingDraft.inputPrice} onChange={(event) => setPricingDraft((current) => ({ ...current, inputPrice: event.target.value }))} placeholder="输入 / 1M" />
                    <input className="v35-input" type="number" min="0" step="0.0001" value={pricingDraft.outputPrice} onChange={(event) => setPricingDraft((current) => ({ ...current, outputPrice: event.target.value }))} placeholder="输出 / 1M" />
                    <button className="v35-button v35-button-primary" type="button" disabled={savePricingMutation.isPending} onClick={() => void savePricingMutation.mutateAsync()}>保存</button>
                  </div>
                </section>
              </article>
            </section>
          ) : null}
        </main>
      </div>
    </section>
  );
}
