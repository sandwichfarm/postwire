import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    wasm: "src/wasm.ts",
  },
  format: ["esm"],
  dts: true,
  platform: "browser",
  outDir: "dist",
  clean: true,
  sourcemap: false,
  treeshake: true,
});
