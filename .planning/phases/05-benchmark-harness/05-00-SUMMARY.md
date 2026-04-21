---
phase: 05-benchmark-harness
plan: "00"
subsystem: testing
tags: [vitest, tinybench, playwright, benchmarks, browser-mode, ci, node-mode-pivot]

requires:
  - phase: 01-scaffold-wire-protocol-foundation
    provides: Vitest 4 + Playwright browser mode infrastructure already wired
  - phase: 03-api-adapters-single-hop-integration
    provides: createChannel, createLowLevelStream public API used in harness helpers
  - phase: 04-lifecycle-safety-observability
    provides: channel.stats() for byte-count cross-check

provides:
  - vitest.bench.config.ts — bench project config (Node env after Plan 01 pivot; see 05-01-SUMMARY.md)
  - benchmarks/helpers/payloads.ts — chunked crypto.getRandomValues payload factories
  - benchmarks/helpers/iframe-harness.browser.archived.ts — srcdoc iframe factory (ARCHIVED — hung in browser mode)
  - benchmarks/helpers/worker-harness.browser.archived.ts — Blob URL module worker factory (ARCHIVED)
  - benchmarks/helpers/node-harness.ts — Node MessageChannel harness (replaces archived browser-mode helpers)
  - benchmarks/helpers/reporter.ts — BenchJsonReporter writing timestamped JSON artifacts
  - benchmarks/compare.mjs — CLI regression comparator with configurable threshold
  - .github/workflows/bench.yml — nightly+dispatch+label-triggered CI workflow (Node-only, no Playwright install)
  - .planning/decisions/ — directory for WASM decision artifact

affects:
  - 05-01 through 05-03 (scenario plans depend on this harness config)
  - Phase 06 (WASM decision depends on bench results from this harness)

tech-stack:
  added:
    - "@vitest/browser-playwright@4.1.4 — Vitest 4.1.4 browser provider factory API"
  patterns:
    - "Blob URL pattern for workers avoids Vite bundling config complexity"
    - "Chunked getRandomValues (64KB limit) for realistic non-compressible payloads"
    - "tinybench 6 result shape: latency.p50/p75/p99, throughput.mean (not hz directly)"

key-files:
  created:
    - vitest.bench.config.ts
    - benchmarks/helpers/payloads.ts
    - benchmarks/helpers/iframe-harness.ts
    - benchmarks/helpers/worker-harness.ts
    - benchmarks/helpers/reporter.ts
    - benchmarks/compare.mjs
    - benchmarks/results/.gitkeep
    - .github/workflows/bench.yml
    - .planning/decisions/.gitkeep
  modified:
    - package.json (bench, bench:heavy, bench:local scripts + @vitest/browser-playwright devDep)
    - pnpm-lock.yaml

key-decisions:
  - "Installed @vitest/browser-playwright@4.1.4 — Vitest 4.1.4 changed provider API from string to factory (breaking change vs plan's template)"
  - "Reporter uses tinybench 6 Statistics shape: latency.p50/p75/p99 and throughput.mean for ops/sec"
  - "bench:local excludes WebKit (Arch Linux ICU ABI mismatch) — CI covers all three browsers"
  - "Worker harness uses Blob URL to avoid Vite worker bundling config (RESEARCH.md Pitfall 5)"

patterns-established:
  - "Bench config: @vitest/browser-playwright factory required for Vitest 4.1.x browser provider"
  - "Payload creation inside bench iteration body, not in setup (prevents ArrayBuffer detach on transfer)"
  - "compare.mjs: mb_s negative delta = regression; p*_ms positive delta = regression"

requirements-completed:
  - BENCH-01
  - BENCH-04
  - BENCH-05

duration: 6min
completed: 2026-04-21
---

# Phase 05 Plan 00: Benchmark Harness Scaffold Summary

**Vitest 4 browser-mode bench harness with three-browser config, chunked-getRandomValues payload factories, iframe/worker context harnesses, JSON reporter, regression comparator, and nightly CI workflow**

## Performance

- **Duration:** 6 min
- **Started:** 2026-04-21T14:03:30Z
- **Completed:** 2026-04-21T14:09:50Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments

- `vitest.bench.config.ts` with three browser projects (chromium, firefox, webkit) using correct Vitest 4.1.4 factory API; webkit sets viewport 1280x720 for throttle prevention
- Full `benchmarks/` directory tree with all helper modules, results directory, and comparator script; `pnpm bench:local` exits 0 (passWithNoTests, no scenarios yet)
- `.github/workflows/bench.yml` with nightly schedule, workflow_dispatch, and bench-regression PR label triggers; baseline commit step for nightly runs
- Added `@vitest/browser-playwright@4.1.4` devDep (Vitest 4.1.4 requires provider factory, not string)

## Task Commits

Each task was committed atomically:

1. **Task 1: vitest.bench.config.ts + package.json bench scripts** - `6feacb2` (feat)
2. **Task 2: benchmarks/ scaffold — helpers, compare.mjs, CI workflow, decisions dir** - `2d5201e` (feat)

**Plan metadata:** (final commit — see state updates below)

## Files Created/Modified

- `vitest.bench.config.ts` — Three-browser bench project config; bench-webkit viewport fix
- `package.json` — Added bench, bench:heavy, bench:local scripts; @vitest/browser-playwright devDep
- `benchmarks/helpers/payloads.ts` — `createBinaryPayload` (64KB chunked getRandomValues), `createStructuredPayload`
- `benchmarks/helpers/iframe-harness.ts` — `createBenchIframe` factory: srcdoc iframe + MessageChannel handshake
- `benchmarks/helpers/worker-harness.ts` — `createBenchWorker` factory: Blob URL module worker
- `benchmarks/helpers/reporter.ts` — `BenchJsonReporter`: tinybench 6 Statistics shape, writes timestamped JSON + baseline.json
- `benchmarks/compare.mjs` — CLI comparator: exits 1 on >10% regression (mb_s or p*_ms), prints Markdown table
- `benchmarks/results/.gitkeep` — Tracked results directory
- `.github/workflows/bench.yml` — Nightly+dispatch+label CI; VITEST_MAX_WORKERS=1 prevents OOM
- `.planning/decisions/.gitkeep` — WASM decision artifact directory

## Decisions Made

1. **@vitest/browser-playwright required as devDep** — Vitest 4.1.4 changed `browser.provider` from accepting a string `"playwright"` to requiring a factory function from `@vitest/browser-playwright`. Plan template used old API — installed matching 4.1.4 version.

2. **tinybench 6 Statistics shape** — Reporter uses `task.result.latency.p50/p75/p99` and `task.result.throughput.mean` (ops/sec). The plan's code example referenced `r.hz` and `r.p50` directly, which was the tinybench 5 flat result shape. tinybench 6 moved to nested `latency` and `throughput` Statistics objects.

3. **bench:local excludes WebKit** — Arch Linux has ICU 74/78 ABI mismatch preventing WebKit locally. CI covers all three browsers on ubuntu-latest with `--with-deps`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed @vitest/browser-playwright@4.1.4**
- **Found during:** Task 1 (vitest.bench.config.ts)
- **Issue:** Vitest 4.1.4 changed `browser.provider` API — no longer accepts string `"playwright"`. Requires `playwright()` factory imported from `@vitest/browser-playwright`.
- **Fix:** Installed `@vitest/browser-playwright@4.1.4` as devDep; updated `vitest.bench.config.ts` to use `playwright()` factory.
- **Files modified:** `vitest.bench.config.ts`, `package.json`, `pnpm-lock.yaml`
- **Verification:** `pnpm bench:local` exits 0
- **Committed in:** `6feacb2` (Task 1 commit)

**2. [Rule 1 - Bug] Reporter adapted to tinybench 6 Statistics shape**
- **Found during:** Task 2 (reporter.ts)
- **Issue:** Plan's reporter template used `r.hz` and `r.p50` (tinybench 5 flat shape). tinybench 6.0.0 uses nested `{ latency: Statistics, throughput: Statistics }` — `r.hz` does not exist; `r.p50` does not exist.
- **Fix:** Reporter uses `result.throughput.mean` for ops/sec and `result.latency.p50/p75/p99/rme/samplesCount`. Added discriminated union type guard checking `state === 'completed'`.
- **Files modified:** `benchmarks/helpers/reporter.ts`
- **Verification:** `pnpm exec tsc --noEmit` exits 0
- **Committed in:** `2d5201e` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both fixes necessary for the harness to work. No scope creep.

## Issues Encountered

**Pre-existing test failure (out of scope):** `tests/integration/heap-flat.test.ts` fails with timing-sensitive assertion (`23.99 > 20 MB`). Confirmed pre-existing — present before any Phase 05 changes. Documented in `deferred-items.md`. Not caused by benchmark harness.

## Known Stubs

None. Harness helpers are scaffolding files — they contain no hardcoded placeholder data that would flow to UI. The reporter's `scenarios.length === 0` early-return means no empty JSON is written until scenarios run. No Plan 00 deliverable promises populated scenario results.

## Next Phase Readiness

- Plan 01 can now write bench scenarios in `benchmarks/scenarios/**/*.bench.ts` — config already points there
- All helper factories (`createBenchIframe`, `createBenchWorker`, `createBinaryPayload`) are importable
- `BenchJsonReporter` is ready to register in `vitest.bench.config.ts` reporters array when scenarios exist
- `.planning/decisions/05-wasm-decision.md` directory is ready for the WASM decision artifact

## Post-Plan Scope Adjustment (Plan 01 pivot)

The browser-mode harness (iframe-harness.ts, worker-harness.ts) created in this plan was subsequently discovered to hang indefinitely when Plan 01 scenarios ran. See `05-01-SUMMARY.md` for full details. The harness was pivoted to Node env in the same commit as Plan 01's scenario work (`b17e8a8`):

- `iframe-harness.ts` → renamed to `iframe-harness.browser.archived.ts` (kept for reference/future revival)
- `worker-harness.ts` → renamed to `worker-harness.browser.archived.ts` (kept for reference/future revival)
- `benchmarks/helpers/node-harness.ts` created (replacement)
- `vitest.bench.config.ts` rewritten to Node env
- `bench.yml` updated (no Playwright install needed)

The `@vitest/browser-playwright` devDep is kept installed — not worth uninstalling; available for Phase 9 browser-mode revival.

---
*Phase: 05-benchmark-harness*
*Completed: 2026-04-21*
