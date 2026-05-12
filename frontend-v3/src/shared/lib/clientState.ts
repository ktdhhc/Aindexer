import { fetchJson } from "../api/http";

export const CLIENT_LOCAL_STORAGE_KEYS = [
  "aindexer_v35_chat_sessions",
  "aindexer_v35_workbench_chat",
  "aindexer_v35_model_defaults",
  "aindexer_v35_provider_models",
  "aindexer_v3_workspace_id",
  "aindexer_v35_ui_layout_size",
] as const;

export const CLIENT_SESSION_STORAGE_KEYS = [
  "aindexer_v35_page_sessions",
  "aindexer_v35_translator_state",
] as const;

export const CLIENT_STATE_HYDRATED_EVENT = "aindexer_v35_client_state_hydrated";

export interface ClientStateSnapshot {
  schema_version: 1;
  updated_at?: string;
  local_storage: Record<string, string>;
  session_storage: Record<string, string>;
}

let persistTimer: number | null = null;
let isHydrating = false;
let clientStateReady = false;

function readStorage(storage: Storage, keys: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of keys) {
    result[key] = storage.getItem(key) ?? "";
  }
  return result;
}

function parseJsonRecord(value: string): unknown {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function countChatMessages(value: string): number {
  const parsed = parseJsonRecord(value);
  if (!parsed || typeof parsed !== "object") return 0;
  let count = 0;
  for (const raw of Object.values(parsed as Record<string, unknown>)) {
    if (Array.isArray(raw)) {
      for (const session of raw) {
        if (session && typeof session === "object" && Array.isArray((session as { messages?: unknown[] }).messages)) {
          count += ((session as { messages: unknown[] }).messages).length;
        }
      }
      continue;
    }
    if (raw && typeof raw === "object" && Array.isArray((raw as { messages?: unknown[] }).messages)) {
      count += ((raw as { messages: unknown[] }).messages).length;
    }
  }
  return count;
}

function countObjectEntries(value: string): number {
  const parsed = parseJsonRecord(value);
  return parsed && typeof parsed === "object" ? Object.keys(parsed as Record<string, unknown>).length : 0;
}

function countNonEmptyModelDefaults(value: string): number {
  const parsed = parseJsonRecord(value);
  if (!parsed || typeof parsed !== "object") {
    return 0;
  }
  return ["indexing", "translation", "chat"].filter((key) => {
    const raw = (parsed as Record<string, unknown>)[key];
    return typeof raw === "string" && raw.trim();
  }).length;
}

function chooseBetterValue(key: string, current: string, incoming: string): string {
  if (!incoming) return current;
  if (!current) return incoming;
  if (key === "aindexer_v35_chat_sessions" || key === "aindexer_v35_workbench_chat") {
    return countChatMessages(incoming) > countChatMessages(current) ? incoming : current;
  }
  if (key === "aindexer_v35_page_sessions" || key === "aindexer_v35_translator_state") {
    return countObjectEntries(incoming) > countObjectEntries(current) ? incoming : current;
  }
  if (key === "aindexer_v35_model_defaults") {
    return countNonEmptyModelDefaults(incoming) >= countNonEmptyModelDefaults(current) ? incoming : current;
  }
  if (key === "aindexer_v35_provider_models") {
    return countObjectEntries(incoming) >= countObjectEntries(current) ? incoming : current;
  }
  if (key === "aindexer_v3_workspace_id" || key === "aindexer_v35_ui_layout_size") {
    return incoming;
  }
  return current;
}

function writeStorage(storage: Storage, values: Record<string, string>, keys: readonly string[]): boolean {
  let changed = false;
  for (const key of keys) {
    const current = storage.getItem(key) ?? "";
    const incoming = values[key] ?? "";
    const next = chooseBetterValue(key, current, incoming);
    if (next !== current) {
      if (next) {
        storage.setItem(key, next);
      } else {
        storage.removeItem(key);
      }
      changed = true;
    }
  }
  return changed;
}

export function collectClientStateSnapshot(): ClientStateSnapshot {
  return {
    schema_version: 1,
    local_storage: readStorage(window.localStorage, CLIENT_LOCAL_STORAGE_KEYS),
    session_storage: readStorage(window.sessionStorage, CLIENT_SESSION_STORAGE_KEYS),
  };
}

export function applyClientStateSnapshot(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const state = payload as Partial<ClientStateSnapshot>;
  const localChanged = writeStorage(
    window.localStorage,
    state.local_storage && typeof state.local_storage === "object" ? state.local_storage : {},
    CLIENT_LOCAL_STORAGE_KEYS,
  );
  const sessionChanged = writeStorage(
    window.sessionStorage,
    state.session_storage && typeof state.session_storage === "object" ? state.session_storage : {},
    CLIENT_SESSION_STORAGE_KEYS,
  );
  if (localChanged || sessionChanged) {
    window.dispatchEvent(new CustomEvent(CLIENT_STATE_HYDRATED_EVENT));
  }
  return localChanged || sessionChanged;
}

export async function fetchClientStateSnapshot(): Promise<ClientStateSnapshot> {
  return fetchJson<ClientStateSnapshot>("/api/system/client_state");
}

export async function persistClientStateSnapshot(): Promise<void> {
  await fetchJson<ClientStateSnapshot>("/api/system/client_state", {
    method: "PUT",
    body: JSON.stringify(collectClientStateSnapshot()),
  });
}

export function queuePersistClientState(delayMs = 500): void {
  if (!clientStateReady || isHydrating) {
    return;
  }
  if (persistTimer !== null) {
    window.clearTimeout(persistTimer);
  }
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    void persistClientStateSnapshot().catch(() => undefined);
  }, delayMs);
}

export async function hydrateClientStateFromServer(): Promise<boolean> {
  isHydrating = true;
  try {
    const serverState = await fetchClientStateSnapshot();
    const changed = applyClientStateSnapshot(serverState);
    await persistClientStateSnapshot().catch(() => undefined);
    return changed;
  } finally {
    isHydrating = false;
    clientStateReady = true;
  }
}
