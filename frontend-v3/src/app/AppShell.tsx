import { Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useShellStore } from "./shellStore";
import { DEFAULT_WORKSPACE_ID, useWorkspaceStore } from "./workspaceStore";
import { listWorkspaces } from "../shared/api/workspaces";

const navItems = [
  { to: "/workbench", label: "工作台" },
  { to: "/config", label: "配置" },
  { to: "/chat", label: "Chat" },
  { to: "/translator", label: "翻译工作区" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const navCollapsed = useShellStore((state) => state.navCollapsed);
  const toggleNav = useShellStore((state) => state.toggleNav);
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

  return (
    <div className="v3-shell-root">
      <header className="v3-topbar">
        <div className="v3-topbar-brand">Aindexer V3</div>
        <div className="v3-topbar-actions">
          <label className="v3-workspace-select-wrap" htmlFor="workspaceSelect">
            <span>工作区</span>
            <select
              id="workspaceSelect"
              className="v3-input v3-input-compact"
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
          <button className="v3-button v3-button-secondary" onClick={toggleNav}>
            {navCollapsed ? "展开导航" : "收起导航"}
          </button>
        </div>
      </header>

      <div className="v3-layout">
        <aside className={`v3-sidebar ${navCollapsed ? "is-collapsed" : ""}`}>
          <nav className="v3-nav">
            {navItems.map((item) => (
              <Link
                key={item.to}
                className="v3-nav-link"
                activeProps={{ className: "v3-nav-link is-active" }}
                to={item.to}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>

        <main className="v3-main">{children}</main>
      </div>
    </div>
  );
}
