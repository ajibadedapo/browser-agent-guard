import { defineConfig } from "vitest/config";

const domTests = "test/browser/!(ssr).test.ts";
const reactTests = "test/react/**/*.test.tsx";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
          exclude: [domTests, reactTests],
          environment: "node",
        },
      },
      {
        test: {
          name: "dom",
          include: [domTests, reactTests],
          environment: "happy-dom",
          environmentOptions: { happyDOM: { url: "https://shop.example/checkout" } },
        },
      },
    ],
  },
});
