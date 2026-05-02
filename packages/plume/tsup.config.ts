import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  // Explicit match for `three` + every subpath (`three/tsl`, `three/webgpu`,
  // `three/examples/jsm/**`, `three/src/nodes/**`). Without the regex, bare `"three"` only
  // matches the top-level module and deeper imports would silently get bundled.
  external: [/^three($|\/)/],
  treeshake: true,
  splitting: false,
  minify: false,
});
