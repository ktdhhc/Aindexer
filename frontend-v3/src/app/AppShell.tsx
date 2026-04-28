import { Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { DEFAULT_WORKSPACE_ID, useWorkspaceStore } from "./workspaceStore";
import { listWorkspaces } from "../shared/api/workspaces";

const navItems = [
  { to: "/workbench", label: "文库"},
  { to: "/translator", label: "翻译" },
  { to: "/chat", label: "问答" },
  { to: "/config", label: "配置" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
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
    <div className="v35-shell-root">
      <header className="v35-topbar">
        <div className="v35-topbar-brand-wrap">
          <div className="v35-topbar-brand">Aindexer</div>
          <span className="v35-topbar-badge">Editorial Lab</span>
        </div>
        <div className="v35-topbar-actions">
          <label className="v35-workspace-select-wrap" htmlFor="workspaceSelect">
            <span>Workspace</span>
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
              >

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
