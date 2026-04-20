import { create } from "zustand";

interface ShellState {
  navCollapsed: boolean;
  toggleNav: () => void;
}

export const useShellStore = create<ShellState>((set) => ({
  navCollapsed: false,
  toggleNav: () => {
    set((state) => ({ navCollapsed: !state.navCollapsed }));
  },
}));
