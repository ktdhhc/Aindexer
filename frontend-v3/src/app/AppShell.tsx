import { Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useShellStore } from "./shellStore";
import { DEFAULT_WORKSPACE_ID, useWorkspaceStore } from "./workspaceStore";
import { listWorkspaces } from "../shared/api/workspaces";
import { isDesktopShell } from "../shared/lib/runtime";

const navItems = [
  { to: "/workbench", label: "文库", icon: "library" },
  { to: "/translator", label: "翻译", icon: "translate" },
  { to: "/chat", label: "问答", icon: "chat" },
  { to: "/config", label: "配置", icon: "config" },
] as const;

function NavIcon({ icon }: { icon: "library" | "translate" | "chat" | "config" }) {
  if (icon === "library") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 5.5A1.5 1.5 0 0 1 6 4h8a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 14 16H6a1.5 1.5 0 0 1-1.5-1.5Z" /><path d="M7 4v12" /><path d="M9.5 7h3.5" /><path d="M9.5 10h3.5" /></svg>;
  }
  if (icon === "translate") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 5.5h7" /><path d="M8 4v2.2" /><path d="M6.2 12.8a11.8 11.8 0 0 0 3.6-6.4" /><path d="M5.8 9.5c.7 1.1 1.7 2.2 3 3.2" /><path d="M12.5 8.5l3 7" /><path d="M11.2 13h5.6" /></svg>;
  }
  if (icon === "chat") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5.8A2.8 2.8 0 0 1 6.8 3h6.4A2.8 2.8 0 0 1 16 5.8v4.8a2.8 2.8 0 0 1-2.8 2.8H9.5L6 16v-2.6H6.8A2.8 2.8 0 0 1 4 10.6Z" /></svg>;
  }
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.2v2.2" /><path d="M10 13.6v2.2" /><path d="m5.9 5.9 1.6 1.6" /><path d="m12.5 12.5 1.6 1.6" /><path d="M4.2 10h2.2" /><path d="M13.6 10h2.2" /><path d="m5.9 14.1 1.6-1.6" /><path d="m12.5 7.5 1.6-1.6" /><circle cx="10" cy="10" r="2.6" /></svg>;
}

function WorkspaceIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.8 6.2A1.2 1.2 0 0 1 5 5h10a1.2 1.2 0 0 1 1.2 1.2v7.6A1.2 1.2 0 0 1 15 15H5a1.2 1.2 0 0 1-1.2-1.2Z" /><path d="M6.5 5V3.8h7V5" /></svg>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const desktopShell = isDesktopShell();
  const uiLayoutSize = useShellStore((state) => state.uiLayoutSize);
  const workspaceId = useWorkspaceStore((state) => state.workspaceId);
  const setWorkspaceId = useWorkspaceStore((state) => state.setWorkspaceId);

  const workspacesQuery = useQuery({
    queryKey: ["workspaces"],
    queryFn: listWorkspaces,
    staleTime: 30_000,
  });

  useEffect(() => {
    const rows = workspacesQuery.data;
    if (!rows || rows.length === 0) {
      return;
    }
    if (!rows.some((item) => item.id === workspaceId)) {
      setWorkspaceId(rows[0].id);
    }
  }, [setWorkspaceId, workspaceId, workspacesQuery.data]);

  useEffect(() => {
    document.documentElement.dataset.v35UiSize = uiLayoutSize;
    document.body.dataset.v35UiSize = uiLayoutSize;
  }, [uiLayoutSize]);

  return (
    <div className="v35-shell-root">
      <header className="v35-topbar">
        <div className="v35-topbar-brand-wrap">
          <div className="v35-topbar-brand">Aindexer</div>
          <span className="v35-topbar-badge">Editorial Lab</span>
        </div>
        <div className="v35-topbar-actions">
          <label className="v35-workspace-select-wrap" htmlFor="workspaceSelect">
            <span className="v35-workspace-label" aria-hidden="true">
              {desktopShell ? <WorkspaceIcon /> : "Workspace"}
            </span>
            <select
              id="workspaceSelect"
              className="v35-input v35-input-compact"
              value={workspaceId}
              onChange={(event) => {
                setWorkspaceId(event.target.value || DEFAULT_WORKSPACE_ID);
              }}
              disabled={workspacesQuery.isLoading || !workspacesQuery.data?.length}
            >
              {workspacesQuery.data?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <div className="v35-shell-frame">
        <aside className="v35-sidebar">
          <nav className="v35-nav">
            {navItems.map((item) => (
              <Link
                key={item.to}
                className="v35-nav-link"
                activeProps={{ className: "v35-nav-link is-active" }}
                to={item.to}
                title={item.label}
              >
                <span className="v35-nav-icon" aria-hidden="true"><NavIcon icon={item.icon} /></span>
                <span className="v35-nav-label">{item.label}</span>
              </Link>
            ))}
          </nav>
        </aside>

        <main className="v35-main">{children}</main>
      </div>
    </div>
  );
}
