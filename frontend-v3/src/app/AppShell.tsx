import { Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useShellStore } from "./shellStore";
import { DEFAULT_WORKSPACE_ID, useWorkspaceStore } from "./workspaceStore";
import { listWorkspaces } from "../shared/api/workspaces";

const navItems = [
  { to: "/workbench", label: "工作台", icon: "WB" },
  { to: "/config", label: "配置", icon: "CF" },
  { to: "/chat", label: "高级 Chat", icon: "CH" },
  { to: "/translator", label: "翻译工作区", icon: "TR" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const navExpanded = useShellStore((state) => state.navExpanded);
  const setNavExpanded = useShellStore((state) => state.setNavExpanded);
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
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNavExpanded(false);
      }
    };
    window.addEventListener("keydown", onKeydown);
    return () => {
      window.removeEventListener("keydown", onKeydown);
    };
  }, [setNavExpanded]);

  return (
    <div className="v3-shell-root">
      <header className="v3-topbar">
        <div className="v3-topbar-brand-wrap">
          <span className="v3-topbar-brand-dot" />
          <div className="v3-topbar-brand">Aindexer</div>
          <span className="v3-topbar-badge">V3</span>
        </div>
        <div className="v3-topbar-actions">
          <label className="v3-workspace-select-wrap" htmlFor="workspaceSelect">
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
        </div>
      </header>

      <div className="v3-shell-frame">
        <div
          className="v3-side-hover-zone"
          onMouseEnter={() => {
            setNavExpanded(true);
          }}
        />
        <aside
          className={`v3-sidebar ${navExpanded ? "is-expanded" : ""}`}
          onMouseEnter={() => {
            setNavExpanded(true);
          }}
          onMouseLeave={() => {
            setNavExpanded(false);
          }}
        >
          <nav className="v3-nav">
            {navItems.map((item) => (
              <Link
                key={item.to}
                className="v3-nav-link"
                activeProps={{ className: "v3-nav-link is-active" }}
                to={item.to}
              >
                <span className="v3-nav-icon" aria-hidden="true">{item.icon}</span>
                <span className="v3-nav-label">{item.label}</span>
              </Link>
            ))}
          </nav>
        </aside>

        <main className="v3-main">{children}</main>
      </div>
    </div>
  );
}
