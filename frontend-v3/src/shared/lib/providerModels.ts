import { useMemo, useSyncExternalStore } from "react";

import type { ProviderSummary } from "../api/providers";
import { CLIENT_STATE_HYDRATED_EVENT, queuePersistClientState } from "./clientState";

const STORAGE_KEY = "aindexer_v35_provider_models";
const CHANGE_EVENT = "aindexer_v35_provider_models_changed";

type ProviderModelMap = Record<string, string[]>;

const DEFAULT_PROVIDER_MODELS: ProviderModelMap = {
  openai: ["gpt-5.4"],
  deepseek: ["deepseek-v4-flash", "deepseek-v4-pro"],
  ali: ["deepseek-v4-flash", "kimi-k2.5", "qwen3.6-flash", "MiniMax-M2.5"],
};

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
      return { ...DEFAULT_PROVIDER_MODELS };
    }
    const parsed = JSON.parse(raw) as ProviderModelMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return { ...DEFAULT_PROVIDER_MODELS };
  }
}

function writeModelMap(map: ProviderModelMap): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
    queuePersistClientState();
  } catch {
    // ignore storage failures
  }
}

function subscribeProviderModelMap(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (!event.key || event.key === STORAGE_KEY) {
      onStoreChange();
    }
  };
  const handleChange = () => {
    onStoreChange();
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(CHANGE_EVENT, handleChange);
  window.addEventListener(CLIENT_STATE_HYDRATED_EVENT, handleChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(CHANGE_EVENT, handleChange);
    window.removeEventListener(CLIENT_STATE_HYDRATED_EVENT, handleChange);
  };
}

function getProviderModelMapSnapshot(): string {
  return JSON.stringify(readModelMap());
}

function useProviderModelMap(): ProviderModelMap {
  const snapshot = useSyncExternalStore(
    subscribeProviderModelMap,
    getProviderModelMapSnapshot,
    () => "{}",
  );
  return useMemo(() => {
    try {
      const parsed = JSON.parse(snapshot) as ProviderModelMap;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }, [snapshot]);
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

export function useProviderModels(provider: string, configuredModel?: string | null): string[] {
  const key = normalizeProvider(provider);
  const map = useProviderModelMap();
  return useMemo(() => uniqueModels([String(configuredModel || ""), ...(map[key] || [])]), [configuredModel, key, map]);
}

export function useAvailableProviderModelEntries(providers: ProviderSummary[]): ProviderModelEntry[] {
  const map = useProviderModelMap();

  return useMemo(() => {
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

      for (const storedModel of map[normalizeProvider(provider.provider)] || []) {
        const key = `${provider.provider}::${storedModel}`;
        if (!seen.has(key)) {
          seen.add(key);
          result.push({ provider: provider.provider, model: storedModel });
        }
      }
    }

    return result;
  }, [map, providers]);
}
