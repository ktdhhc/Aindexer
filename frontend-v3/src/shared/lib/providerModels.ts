import type { ProviderSummary } from "../api/providers";

const STORAGE_KEY = "aindexer_v35_provider_models";

type ProviderModelMap = Record<string, string[]>;

function normalizeProvider(provider: string): string {
  return String(provider || "").trim().toLowerCase();
}

function uniqueModels(models: string[]): string[] {
  return [...new Set(models.map((item) => String(item || "").trim()).filter(Boolean))];
}

function readModelMap(): ProviderModelMap {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as ProviderModelMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeModelMap(map: ProviderModelMap): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore storage failures
  }
}

export function getProviderModels(provider: string, configuredModel?: string | null): string[] {
  const key = normalizeProvider(provider);
  const map = readModelMap();
  return uniqueModels([String(configuredModel || ""), ...(map[key] || [])]);
}

export function setProviderModels(provider: string, models: string[]): string[] {
  const key = normalizeProvider(provider);
  const nextModels = uniqueModels(models);
  const map = readModelMap();
  if (nextModels.length === 0) {
    delete map[key];
  } else {
    map[key] = nextModels;
  }
  writeModelMap(map);
  return nextModels;
}

export interface ProviderModelEntry {
  provider: string;
  model: string;
}

export function getAllProviderModels(): ProviderModelEntry[] {
  const map = readModelMap();
  const result: ProviderModelEntry[] = [];
  for (const [provider, models] of Object.entries(map)) {
    for (const model of models) {
      result.push({ provider, model });
    }
  }
  return result;
}

export function buildAvailableProviderModelEntries(providers: ProviderSummary[]): ProviderModelEntry[] {
  const storedEntries = getAllProviderModels();
  const seen = new Set<string>();
  const result: ProviderModelEntry[] = [];

  for (const provider of providers) {
    if (!provider.enabled) {
      continue;
    }

    const configuredModel = String(provider.model || "").trim();
    if (configuredModel) {
      const key = `${provider.provider}::${configuredModel}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ provider: provider.provider, model: configuredModel });
      }
    }

    for (const entry of storedEntries) {
      if (entry.provider.toLowerCase() !== provider.provider.toLowerCase()) {
        continue;
      }
      const key = `${provider.provider}::${entry.model}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ provider: provider.provider, model: entry.model });
      }
    }
  }

  return result;
}
