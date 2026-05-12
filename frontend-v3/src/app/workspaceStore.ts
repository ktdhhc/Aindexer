import { create } from "zustand";

import { queuePersistClientState } from "../shared/lib/clientState";

const STORAGE_KEY = "aindexer_v3_workspace_id";
const DEFAULT_WORKSPACE_ID = "ws_default";

function readWorkspaceId(): string {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && saved.trim()) {
      return saved.trim();
    }
  } catch {
    // ignore storage errors
  }
  return DEFAULT_WORKSPACE_ID;
}

interface WorkspaceState {
  workspaceId: string;
  setWorkspaceId: (workspaceId: string) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  workspaceId: readWorkspaceId(),
  setWorkspaceId: (workspaceId) => {
    const nextId = String(workspaceId || "").trim() || DEFAULT_WORKSPACE_ID;
    try {
      window.localStorage.setItem(STORAGE_KEY, nextId);
      queuePersistClientState();
    } catch {
      // ignore storage errors
    }
    set({ workspaceId: nextId });
  },
}));

export function hydrateWorkspaceIdFromStorage(): void {
  useWorkspaceStore.setState({
    workspaceId: readWorkspaceId(),
  });
}

export { DEFAULT_WORKSPACE_ID };
