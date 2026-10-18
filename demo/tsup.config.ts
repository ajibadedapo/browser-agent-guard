import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    demo: "demo/demo.ts",
    contribute: "demo/contribute.ts",
  },
  outDir: "demo/dist",
  format: ["esm"],
  splitting: false,
  clean: true,
  minify: true,
  sourcemap: true,
  target: "es2020",
  platform: "browser",
});
