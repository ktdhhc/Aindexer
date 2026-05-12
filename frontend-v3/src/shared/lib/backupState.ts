import {
  CLIENT_LOCAL_STORAGE_KEYS,
  CLIENT_SESSION_STORAGE_KEYS,
  applyClientStateSnapshot,
  collectClientStateSnapshot,
  queuePersistClientState,
} from "./clientState";

export interface BackupFrontendState {
  schema_version: 1;
  local_storage: Record<string, string>;
  session_storage?: Record<string, string>;
}

export function collectChatBackupState(): BackupFrontendState {
  return collectClientStateSnapshot();
}

export function applyChatBackupState(payload: unknown): void {
  if (!payload || typeof payload !== "object") {
    return;
  }
  const state = payload as Partial<BackupFrontendState>;
  applyClientStateSnapshot({
    schema_version: 1,
    local_storage: Object.fromEntries(
      CLIENT_LOCAL_STORAGE_KEYS.map((key) => [key, state.local_storage?.[key] ?? ""]),
    ),
    session_storage: Object.fromEntries(
      CLIENT_SESSION_STORAGE_KEYS.map((key) => [key, state.session_storage?.[key] ?? ""]),
    ),
  });
  queuePersistClientState(0);
}
