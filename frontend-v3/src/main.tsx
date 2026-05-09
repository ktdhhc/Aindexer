import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";

import { router } from "./app/router";
import { getStoredUiLayoutSize } from "./app/shellStore";
import { recordFrontendLog } from "./shared/api/backup";
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

function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function errorStack(value: unknown): string {
  return value instanceof Error && value.stack ? value.stack : "";
}

window.addEventListener("error", (event) => {
  recordFrontendLog({
    level: "error",
    source: "window.error",
    message: event.message || errorMessage(event.error),
    stack: errorStack(event.error),
    url: window.location.href,
    user_agent: navigator.userAgent,
  });
});

window.addEventListener("unhandledrejection", (event) => {
  recordFrontendLog({
    level: "error",
    source: "window.unhandledrejection",
    message: errorMessage(event.reason),
    stack: errorStack(event.reason),
    url: window.location.href,
    user_agent: navigator.userAgent,
  });
});

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
