import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/v3/",
  plugins: [react()],
  build: {
    outDir: "../backend/frontend/v3",
    emptyOutDir: true,
  },
});
