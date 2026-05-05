import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";

import { router } from "./app/router";
import { getStoredUiLayoutSize } from "./app/shellStore";
import { isDesktopShell } from "./shared/lib/runtime";
import "./styles.css";
import "./shared/styles/v35.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

const desktopShell = isDesktopShell();
const uiLayoutSize = getStoredUiLayoutSize();
document.documentElement.classList.toggle("v35-runtime-desktop", desktopShell);
document.body.classList.toggle("v35-runtime-desktop", desktopShell);
document.documentElement.dataset.v35UiSize = uiLayoutSize;
document.body.dataset.v35UiSize = uiLayoutSize;

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
