// vitest.bench.config.ts
// Node-mode benchmark configuration.
//
// PIVOT from browser-mode (Phase 5 scope adjustment):
// The original browser-mode config (three Playwright browser projects) was replaced
// because Vitest browser mode + srcdoc iframes cannot reliably resolve the library
// path (/src/index.js) inside a sandboxed srcdoc iframe — the CAPABILITY handshake
// never completes and the bench hangs indefinitely. See 05-01-SUMMARY.md for details.
//
// Node mode uses node:worker_threads MessageChannel which provides:
//   - Real structured-clone + Transferable semantics (same V8 as Chrome)
//   - No iframe bootstrapping overhead
//   - Fast, deterministic, < 60 s wall-clock for all default scenarios
//
// The @vitest/browser-playwright devDep is kept installed for future browser-mode
// revival (Phase 9 alongside E2E tests).
//
// Browser-mode archived files:
//   benchmarks/helpers/iframe-harness.browser.archived.ts
//   benchmarks/helpers/worker-harness.browser.archived.ts

import { defineConfig } from "vitest/config";
import { BenchJsonReporter } from "./benchmarks/helpers/reporter.js";

export default defineConfig({
  test: {
    name: "bench",
    include: ["benchmarks/scenarios/**/*.bench.ts"],
    environment: "node",
    // benchmark options are set at the bench() call site (iterations/warmupIterations)
    reporters: [new BenchJsonReporter()],
  },
});
