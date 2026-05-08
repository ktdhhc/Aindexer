import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const browserEmptyModule = fileURLToPath(new URL("./src/shared/vendor/node-empty.ts", import.meta.url));

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
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "../backend/frontend/v3",
    emptyOutDir: true,
  },
});
