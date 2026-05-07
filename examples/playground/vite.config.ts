import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "three-plume": fileURLToPath(new URL("../../packages/plume/src/index.ts", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
