import { create } from "zustand";

export type UiLayoutSize = "small" | "medium" | "large";

const UI_LAYOUT_SIZE_STORAGE_KEY = "aindexer_v35_ui_layout_size";

export const UI_LAYOUT_SIZE_OPTIONS: { value: UiLayoutSize; label: string; description: string }[] = [
  { value: "small", label: "小", description: "更紧凑，适合小屏和高信息密度" },
  { value: "medium", label: "中", description: "平衡阅读空间和操作密度" },
  { value: "large", label: "大", description: "当前默认布局，保留最大阅读与操作尺寸" },
];

function normalizeUiLayoutSize(value: string | null | undefined): UiLayoutSize {
  if (value === "small" || value === "medium" || value === "large") {
    return value;
  }
  return "large";
}

export function getStoredUiLayoutSize(): UiLayoutSize {
  try {
    return normalizeUiLayoutSize(window.localStorage.getItem(UI_LAYOUT_SIZE_STORAGE_KEY));
  } catch {
    return "large";
  }
}

function persistUiLayoutSize(value: UiLayoutSize) {
  try {
    window.localStorage.setItem(UI_LAYOUT_SIZE_STORAGE_KEY, value);
  } catch {
    // ignore storage failures
  }
}

interface ShellState {
  navExpanded: boolean;
  uiLayoutSize: UiLayoutSize;
  setNavExpanded: (next: boolean) => void;
  setUiLayoutSize: (next: UiLayoutSize) => void;
}

export const useShellStore = create<ShellState>((set) => ({
  navExpanded: false,
  uiLayoutSize: getStoredUiLayoutSize(),
  setNavExpanded: (next) => {
    set({ navExpanded: next });
  },
  setUiLayoutSize: (next) => {
    const normalized = normalizeUiLayoutSize(next);
    persistUiLayoutSize(normalized);
    set({ uiLayoutSize: normalized });
  },
}));
