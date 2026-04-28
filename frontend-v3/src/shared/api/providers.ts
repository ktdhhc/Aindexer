import { fetchJson } from "./http";

export interface ProviderRegistryBaseUrlOption {
  label: string;
  url: string;
  api_style: string;
}

export interface ProviderRegistryModelOption {
  id: string;
  display_name: string;
  family?: string | null;
  category?: string | null;
  supports_streaming?: boolean | null;
  supports_multimodal_input?: boolean | null;
  supports_tool_calls?: boolean | null;
  supports_thinking?: boolean | null;
  context_window_tokens?: number | null;
  max_output_tokens?: number | null;
}

export interface ProviderRegistryResolvedModel {
  name: string;
  aliases: string[];
  provider_id: string;
  provider_display_name?: string | null;
  provider_model_id: string;
  display_name?: string | null;
  primary_api_style?: string | null;
  base_urls: ProviderRegistryBaseUrlOption[];
  family?: string | null;
  category?: string | null;
  input_modalities?: string[] | null;
  output_modalities?: string[] | null;
  supports_streaming?: boolean | null;
  supports_multimodal_input?: boolean | null;
  supports_tool_calls?: boolean | null;
  supports_thinking?: boolean | null;
  context_window_tokens?: number | null;
  max_output_tokens?: number | null;
  resolution_notes?: string | null;
  model_notes?: string | null;
  provider_notes?: string | null;
}

export interface ProviderRegistryPayload {
  provider: {
    found: boolean;
    primary_api_style?: string | null;
    directly_supported: boolean;
    recommended_base_url?: string | null;
    recommended_api_style?: string | null;
    base_urls: ProviderRegistryBaseUrlOption[];
    models: ProviderRegistryModelOption[];
    supported_model_count: number;
  };
  model: {
    input_name?: string | null;
    found: boolean;
    provider_matches_current: boolean;
    resolved?: ProviderRegistryResolvedModel | null;
  };
}

export interface ProviderSummary {
  provider: string;
  base_url: string | null;
  model: string | null;
  has_api_key: boolean;
  api_key_masked?: string;
  temperature: number;
  timeout: number;
  enabled: boolean;
  registry?: ProviderRegistryPayload;
}

export interface ModelRegistryResolution {
  input_name: string;
  found: boolean;
  resolved: ProviderRegistryResolvedModel | null;
}

export interface ProviderUpdatePayload {
  base_url: string;
  model: string;
  api_key?: string;
  clear_api_key?: boolean;
  temperature: number;
  timeout: number;
  enabled: boolean;
}

export interface ProviderTestResult {
  success: boolean;
  message: string;
  elapsed_seconds: number;
}

export function listProviders(): Promise<ProviderSummary[]> {
  return fetchJson<ProviderSummary[]>("/api/providers");
}

export function updateProvider(provider: string, payload: ProviderUpdatePayload): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>(`/api/providers/${encodeURIComponent(provider)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function testProvider(provider: string): Promise<ProviderTestResult> {
  return fetchJson<ProviderTestResult>(`/api/providers/${encodeURIComponent(provider)}/test`, {
    method: "POST",
  });
}

export function resetProviders(): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>("/api/providers/reset_defaults", {
    method: "POST",
  });
}

export function deleteProvider(provider: string): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>(`/api/providers/${encodeURIComponent(provider)}`, {
    method: "DELETE",
  });
}

export function resolveModelRegistryEntries(names: string[]): Promise<ModelRegistryResolution[]> {
  return fetchJson<ModelRegistryResolution[]>('/api/providers/model_registry/resolve', {
    method: 'POST',
    body: JSON.stringify({ names }),
  });
}
