export type ModelDefaultKind = "indexing" | "translation" | "chat";

export interface ModelDefaults {
  indexing: string;
  translation: string;
  chat: string;
}

const STORAGE_KEY = "aindexer_v35_model_defaults";

const EMPTY_DEFAULTS: ModelDefaults = {
  indexing: "",
  translation: "",
  chat: "",
};

export function getModelDefaults(): ModelDefaults {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...EMPTY_DEFAULTS };
    }
    const parsed = JSON.parse(raw) as Partial<ModelDefaults>;
    return {
      indexing: String(parsed.indexing || ""),
      translation: String(parsed.translation || ""),
      chat: String(parsed.chat || ""),
    };
  } catch {
    return { ...EMPTY_DEFAULTS };
  }
}

export function setModelDefaults(defaults: ModelDefaults): ModelDefaults {
  const next = {
    indexing: String(defaults.indexing || ""),
    translation: String(defaults.translation || ""),
    chat: String(defaults.chat || ""),
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage failures
  }
  return next;
}

export function getModelDefault(kind: ModelDefaultKind): string {
  return getModelDefaults()[kind];
}

export function parseModelDefaultKey(value: string): { provider: string; model: string } | null {
  const [provider, ...modelParts] = String(value || "").split("::");
  const model = modelParts.join("::").trim();
  if (!provider.trim() || !model) {
    return null;
  }
  return { provider: provider.trim(), model };
}
