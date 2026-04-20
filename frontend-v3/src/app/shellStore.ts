import { create } from "zustand";

interface ShellState {
  navExpanded: boolean;
  setNavExpanded: (next: boolean) => void;
}

export const useShellStore = create<ShellState>((set) => ({
  navExpanded: false,
  setNavExpanded: (next) => {
    set({ navExpanded: next });
  },
}));
