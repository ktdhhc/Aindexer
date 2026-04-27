import { create } from "zustand";

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
    } catch {
      // ignore storage errors
    }
    set({ workspaceId: nextId });
  },
}));

export { DEFAULT_WORKSPACE_ID };
