import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";

import { AppShell } from "./AppShell";
import { ChatPage } from "../pages/ChatPage";
import { ConfigPage } from "../pages/ConfigPage";
import { ConsolePage } from "../pages/ConsolePage";
import { WorkbenchPage } from "../pages/WorkbenchPage";

function EmptyRoute() {
  return null;
}

function RootLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

const rootRoute = createRootRoute({
  component: RootLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/workbench" });
  },
});

const workbenchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workbench",
  component: WorkbenchPage,
});

const legacyConsoleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/console",
  component: ConsolePage,
});

const configRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/config",
  component: ConfigPage,
});

const legacyProvidersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/config/providers",
  beforeLoad: () => {
    throw redirect({ to: "/config" });
  },
});

const legacyFieldsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/config/fields",
  beforeLoad: () => {
    throw redirect({ to: "/config" });
  },
});

const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chat",
  component: ChatPage,
});

const translatorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/translator",
  component: EmptyRoute,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  workbenchRoute,
  legacyConsoleRoute,
  configRoute,
  legacyProvidersRoute,
  legacyFieldsRoute,
  chatRoute,
  translatorRoute,
]);

export const router = createRouter({
  routeTree,
  basepath: "/v3",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
