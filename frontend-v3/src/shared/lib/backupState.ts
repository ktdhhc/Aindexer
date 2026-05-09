const CHAT_SESSION_STORAGE_KEYS = [
  "aindexer_v35_chat_sessions",
  "aindexer_v35_workbench_chat",
] as const;

export interface BackupFrontendState {
  schema_version: 1;
  local_storage: Record<string, string>;
}

export function collectChatBackupState(): BackupFrontendState {
  const localStorageState: Record<string, string> = {};
  for (const key of CHAT_SESSION_STORAGE_KEYS) {
    localStorageState[key] = window.localStorage.getItem(key) ?? "";
  }
  return {
    schema_version: 1,
    local_storage: localStorageState,
  };
}

export function applyChatBackupState(payload: unknown): void {
  if (!payload || typeof payload !== "object") {
    return;
  }
  const state = payload as Partial<BackupFrontendState>;
  const localStorageState = state.local_storage;
  if (!localStorageState || typeof localStorageState !== "object") {
    return;
  }
  for (const key of CHAT_SESSION_STORAGE_KEYS) {
    const value = localStorageState[key];
    if (typeof value !== "string" || !value) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, value);
    }
  }
}
