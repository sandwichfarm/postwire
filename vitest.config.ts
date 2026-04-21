import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: "unit",
          include: [
            "tests/unit/**/*.{test,spec}.ts",
            "tests/integration/**/*.{test,spec}.ts",
          ],
          environment: "node",
          globals: false,
        },
      },
      // Browser mode project — configured now, populated in Phase 3
      // {
      //   test: {
      //     name: 'browser',
      //     include: ['tests/browser/**/*.{test,spec}.ts'],
      //     browser: {
      //       enabled: true,
      //       provider: 'playwright',
      //       instances: [
      //         { browser: 'chromium' },
      //         { browser: 'firefox' },
      //         { browser: 'webkit' },
      //       ],
      //     },
      //   },
      // },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/wasm.ts"],
    },
  },
});
