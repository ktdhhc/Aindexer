import { fetchJson } from "./http";

export const ALL_WORKSPACES_USAGE_SCOPE = "__all__";
export type UsagePeriod = "day" | "month";
export type UsageFeature = "indexing" | "translation" | "chat";
export type UsageBreakdownBy = "provider" | "model" | "feature" | "api_key_fingerprint";

export interface UsageFilters {
  providers: string[];
  models: string[];
  features: string[];
  api_keys: string[];
}

export interface UsageBucket {
  bucket: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  request_count: number;
  estimated_count: number;
  estimated_cost: number;
  dimension_breakdown: Record<string, number>;
}

export interface UsageTotals {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  request_count: number;
  estimated_cost: number;
  dimension_breakdown: Record<string, number>;
  dimension_metrics: Record<string, {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    request_count: number;
    estimated_cost: number;
  }>;
}

export interface UsageSummary {
  period: UsagePeriod;
  breakdown_by: UsageBreakdownBy;
  available_range: {
    first_bucket: string;
    last_bucket: string;
  };
  buckets: UsageBucket[];
  totals: UsageTotals;
}

export interface PricingRule {
  id: string;
  provider: string;
  model?: string | null;
  api_key_fingerprint?: string | null;
  input_price_per_1m: number;
  output_price_per_1m: number;
  currency: string;
  created_at: string;
  updated_at: string;
}

export interface PricingRulePayload {
  provider: string;
  model?: string | null;
  api_key_fingerprint?: string | null;
  input_price_per_1m: number;
  output_price_per_1m: number;
  currency: string;
}

export async function listUsageFilters(workspaceId: string): Promise<UsageFilters> {
  const params = new URLSearchParams({ workspace_id: workspaceId });
  return fetchJson<UsageFilters>(`/api/usage/filters?${params.toString()}`);
}

export async function getUsageSummary(params: {
  workspaceId: string;
  period: UsagePeriod;
  breakdownBy: UsageBreakdownBy;
  startBucket?: string;
  endBucket?: string;
  provider?: string;
  model?: string;
  feature?: string;
  apiKey?: string;
}): Promise<UsageSummary> {
  const query = new URLSearchParams({ workspace_id: params.workspaceId, period: params.period, breakdown_by: params.breakdownBy });
  if (params.startBucket) query.set("start_bucket", params.startBucket);
  if (params.endBucket) query.set("end_bucket", params.endBucket);
  if (params.provider) query.set("provider", params.provider);
  if (params.model) query.set("model", params.model);
  if (params.feature) query.set("feature", params.feature);
  if (params.apiKey) query.set("api_key", params.apiKey);
  return fetchJson<UsageSummary>(`/api/usage/summary?${query.toString()}`);
}

export async function listPricingRules(): Promise<PricingRule[]> {
  return fetchJson<PricingRule[]>("/api/usage/pricing");
}

export async function savePricingRule(payload: PricingRulePayload): Promise<PricingRule> {
  return fetchJson<PricingRule>("/api/usage/pricing", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deletePricingRule(ruleId: string): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>(`/api/usage/pricing/${encodeURIComponent(ruleId)}`, { method: "DELETE" });
}
