import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      plume: fileURLToPath(new URL("../plume/src/index.ts", import.meta.url)),
    },
  },
  server: {
    port: 5174,
  },
});
