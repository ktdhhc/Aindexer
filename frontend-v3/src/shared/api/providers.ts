import { fetchJson } from "./http";

export interface ProviderSummary {
  provider: string;
  base_url: string | null;
  model: string | null;
  has_api_key: boolean;
  api_key_masked?: string;
  temperature: number;
  timeout: number;
  enabled: boolean;
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
