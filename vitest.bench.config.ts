import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: "bench-chromium",
          include: ["benchmarks/scenarios/**/*.bench.ts"],
          browser: {
            enabled: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
      {
        test: {
          name: "bench-firefox",
          include: ["benchmarks/scenarios/**/*.bench.ts"],
          browser: {
            enabled: true,
            provider: playwright(),
            instances: [{ browser: "firefox" }],
          },
        },
      },
      {
        test: {
          name: "bench-webkit",
          include: ["benchmarks/scenarios/**/*.bench.ts"],
          browser: {
            enabled: true,
            provider: playwright(),
            instances: [{ browser: "webkit" }],
            viewport: { width: 1280, height: 720 },
          },
        },
      },
    ],
  },
});
