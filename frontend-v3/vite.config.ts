import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const browserEmptyModule = fileURLToPath(new URL("./src/shared/vendor/node-empty.ts", import.meta.url));
const DEFAULT_FRONTEND_PORT = 5173;
const DEFAULT_BACKEND_PORT = 8000;

function readPort(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const frontendPort = readPort("AINDEXER_DEV_FRONTEND_PORT", DEFAULT_FRONTEND_PORT);
const backendPort = readPort("AINDEXER_DEV_BACKEND_PORT", DEFAULT_BACKEND_PORT);

export default defineConfig({
  base: "/v3/",
  plugins: [react()],
  resolve: {
    alias: {
      fs: browserEmptyModule,
      http: browserEmptyModule,
      https: browserEmptyModule,
      url: browserEmptyModule,
    },
  },
  server: {
    host: "127.0.0.1",
    port: frontendPort,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "../backend/frontend/v3",
    emptyOutDir: true,
  },
});
