import { defineConfig, type Options } from "tsup";

type EsbuildPlugin = NonNullable<Options["esbuildPlugins"]>[number];

const PACKAGE_NAME = "browser-agent-guard";

const libraryEntries = {
  index: "src/index.ts",
  "server/index": "src/server/index.ts",
};

const libraryBuild: Options = {
  entry: libraryEntries,
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  target: "es2022",
  external: ["react", "react-dom"],
};

const importGuardFromPackageRoot: EsbuildPlugin = {
  name: "import-guard-from-package-root",
  setup(build) {
    build.onResolve({ filter: /^\.\.\/browser\/guard$/ }, () => ({ path: PACKAGE_NAME, external: true }));
  },
};

const reactBuild: Options = {
  entry: { "react/index": "src/react/index.tsx" },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  target: "es2022",
  external: ["react", "react-dom", PACKAGE_NAME],
  esbuildPlugins: [importGuardFromPackageRoot],
};

const browserBuild: Options = {
  entry: { "browser/auto": "src/browser/auto.ts" },
  format: ["iife"],
  minify: true,
  target: "es2020",
  platform: "browser",
};

export default defineConfig([libraryBuild, reactBuild, browserBuild]);
