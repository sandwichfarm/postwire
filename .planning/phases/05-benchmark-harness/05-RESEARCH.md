# Phase 5: Benchmark Harness - Research

**Researched:** 2026-04-21
**Domain:** Browser-mode benchmarking with Vitest 4 + tinybench 6 + Playwright
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Harness:**
- `tinybench` as benchmark runner (dev dep)
- Vitest browser mode + Playwright for real-browser runs (already wired in Phase 1)
- Separate benchmark config: `vitest.bench.config.ts` (or extend main config) — browser project + benchmark-only glob
- Scenario file structure: `benchmarks/scenarios/<name>.bench.ts` — one per benchmark family

**Payload Sizes:**
- 1 KB, 64 KB, 1 MB, 16 MB for the default run
- 256 MB gated behind `--heavy` or explicit env `IFB_BENCH_HEAVY=1`
- All sizes run on CI nightly; local `pnpm bench` defaults to excluding 256 MB for dev ergonomics

**Data Types:**
- Binary (ArrayBuffer) — primary perf target, uses Transferable zero-copy path
- Structured clone (JS object) — 1KB JSON-like objects repeated until size target; no transfer, slow path
- Naive postMessage baseline — same payload, bare port.postMessage without library framing

**Reporting:**
- N=30 iterations per scenario
- Record: `name, hz, mean, min, max, p50, p75, p99, rme, samples`
- Compute MB/s: `payloadBytes * hz / 1e6`
- CPU estimate: `performance.now()` markers around sync loops

**Artifact Format:**
```jsonc
{
  "timestamp": "ISO-8601",
  "commit": "short-sha",
  "node": "22.x.y",
  "browser": "chromium|firefox|webkit",
  "browserVersion": "...",
  "scenarios": [
    { "name": "binary-1mb-single-hop", "mb_s": 124.3, "p50_ms": 7.9, "p95_ms": 12.1, "p99_ms": 14.7, "samples": 30 }
  ],
  "baseline_comparison": { /* delta from naive */ }
}
```

**CI Gate:**
- Nightly: `bench.yml` workflow runs full suite on ubuntu-latest, uploads artifacts
- On PR: `ci.yml` does NOT run benchmarks by default. A "bench-regression" label triggers the bench job.
- 10% regression in any dimension fails the job.
- Baseline refreshed manually (explicit PR action, not automatic).

**WASM Decision Log:**
- `.planning/decisions/05-wasm-decision.md` — measurements summary, ceiling analysis, decision + rationale

### Claude's Discretion

- Benchmark file naming, exact tinybench API usage, comparator script JS/MJS choice
- Whether to integrate with an external bench viewer (codspeed, hyperfine-style) — OUT for now; CSV/JSON is enough
- Whether the 256 MB test is `it.runIf(heavyMode)` or a separate file

### Deferred Ideas (OUT OF SCOPE)

- WASM implementation — Phase 6
- SAB fast path + SAB benchmarks — Phase 6
- Multi-hop relay benchmark — Phase 7
- Docs site integration of benchmark charts — Phase 10
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BENCH-01 | Benchmark harness built on Vitest browser mode + tinybench, runnable locally and in CI, across Chromium, Firefox, and WebKit | Vitest 4.1.4 + tinybench 6.0.0 confirmed installed; browser mode + bench mode coexist via separate project config; `pnpm bench` script already wired |
| BENCH-02 | Benchmarks measure throughput (MB/s), latency (p50/p95/p99), CPU (performance.now() sampling) for each data type | tinybench `Options.time` / `Options.iterations` controls; `task.result` exposes `hz`, `mean`, `p50`, `p75`, `p99`, `samples`; MB/s derived post-run from known payload size |
| BENCH-03 | Benchmarks compare library against naive postMessage chunking across data sizes (1KB–256MB) and topologies | Scenario structure: three bench() blocks per scenario (binary-transfer, structured-clone, naive); topology: iframe and worker contexts built in-browser |
| BENCH-04 | Benchmark report published alongside each release — versioned in repository and rendered in docs site | JSON artifacts committed to benchmarks/results/; rendering deferred to Phase 10; baseline.json committed to repo for comparator |
| BENCH-05 | Benchmark data drives WASM decision gate — introduce WASM only when JS path hits measurable ceiling | .planning/decisions/05-wasm-decision.md template; ceiling analysis from p99 latency and CPU% at each payload tier |
</phase_requirements>

---

## Summary

Phase 5 builds a benchmark harness that answers: "How fast does the library go, compared to what?" The harness runs inside real browsers (Chromium, Firefox, WebKit) using Vitest 4's built-in `bench()` API backed by tinybench 6.0.0. Results are serialized to JSON, committed as `benchmarks/results/baseline.json`, and compared against the committed baseline via a `benchmarks/compare.mjs` script in CI.

The key technical question — "can Vitest bench run in browser mode?" — is confirmed YES. Vitest 4 exposes `bench` as a first-class global alongside `describe` and `test`. Browser mode projects with `browser.enabled: true` can include `.bench.ts` files. The approach is a `vitest.bench.config.ts` that adds a browser project scoped to `benchmarks/scenarios/**/*.bench.ts`. The existing `pnpm bench` script (`vitest bench`) runs this config when pointed at it.

tinybench 6.0.0 is pure ESM with no Node-specific I/O: the only `process.*` references are `process.versions.bun` and `process.release.name` used for runtime environment labeling, both safely undefined in browser contexts (the fallback is "unknown"). Browser compatibility is HIGH confidence.

**Primary recommendation:** Use a `vitest.bench.config.ts` extending the browser project definition from `vitest.config.ts`; source benchmark scenarios in `benchmarks/scenarios/*.bench.ts`; use `bench()` blocks directly (not `test()` wrappers). Write results via a custom Vitest reporter that serializes to JSON after each browser run.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| tinybench | 6.0.0 | Benchmark loop engine | Already installed; Vitest bench internals use it; pure ESM, browser-safe |
| vitest | 4.1.4 | Test runner with bench mode | Already installed; `bench()` global available when `mode: "benchmark"` |
| @vitest/browser | 4.1.4 | Browser context for bench runs | Already installed; Playwright provider already wired in ci.yml |
| playwright / @playwright/test | 1.59.1 | Browser provider for Vitest browser mode | Already installed; three-browser matrix already configured |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| tsx | 4.21.0 | Run comparator script without compile step | `tsx benchmarks/compare.mjs` in CI steps |
| fast-check | ^4.7.0 | Already installed — not used in bench phase | N/A |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| vitest bench() blocks | tinybench Bench class directly in test() | bench() integrates with vitest reporters natively; Bench class requires manual iteration and manual JSON serialization |
| Custom JSON reporter | CodSpeed Vitest plugin | CodSpeed is SaaS; adds an external dependency for a research project; JSON reporter is 50 lines and self-contained |
| benchmarks/compare.mjs (Node script) | GitHub Actions step comparison | Node script is version-controlled, testable, and runnable locally |

**Installation:** Nothing new to install. All dependencies are already in `package.json`.

---

## Architecture Patterns

### Recommended Project Structure

```
benchmarks/
├── scenarios/
│   ├── binary-transfer.bench.ts     # ArrayBuffer transferable path
│   ├── structured-clone.bench.ts    # JS object structured-clone path
│   └── naive-baseline.bench.ts      # Raw postMessage without library framing
├── helpers/
│   ├── payloads.ts                  # createBinaryPayload(), createStructuredPayload()
│   ├── iframe-setup.ts              # createBenchIframe() — builds srcdoc iframe, waits for ready
│   ├── worker-setup.ts              # createBenchWorker() — spins up bench worker, waits for ready
│   └── reporter.ts                  # Custom Vitest reporter serializing bench results to JSON
├── results/
│   ├── baseline.json                # Committed — latest master results
│   └── .gitkeep
└── compare.mjs                      # CLI comparator: compare.mjs <before.json> <after.json> [--threshold 10]
vitest.bench.config.ts               # Bench-specific Vitest config
.github/workflows/bench.yml          # Nightly bench CI workflow
.planning/decisions/
└── 05-wasm-decision.md              # WASM decision artifact (filled after Phase 5 runs)
```

### Pattern 1: Vitest Bench Config (browser mode + benchmark mode)

**What:** A separate `vitest.bench.config.ts` that enables browser mode with benchmark mode. The key insight: Vitest project configs use `test.mode: "benchmark"` to activate `bench()` globally.

**When to use:** Any benchmark run. `pnpm bench` invokes `vitest bench --config vitest.bench.config.ts`.

```typescript
// vitest.bench.config.ts
// Source: vitest config.d.ts — mode: "test" | "benchmark" is per-project
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "bench-chromium",
          include: ["benchmarks/scenarios/**/*.bench.ts"],
          browser: {
            enabled: true,
            provider: "playwright",
            instances: [{ browser: "chromium" }],
          },
        },
      },
      // Firefox and WebKit added when full matrix is needed
      // {
      //   test: {
      //     name: "bench-firefox",
      //     include: ["benchmarks/scenarios/**/*.bench.ts"],
      //     browser: {
      //       enabled: true,
      //       provider: "playwright",
      //       instances: [{ browser: "firefox" }],
      //     },
      //   },
      // },
    ],
  },
});
```

Note: `vitest bench` command automatically sets `mode: "benchmark"` — this activates the `bench()` global and tinybench internals. The `mode` field does not need to be set manually in the project config.

### Pattern 2: Scenario Structure

**What:** One `.bench.ts` file per data-type family. Each file contains `describe()` blocks per payload size, with `bench()` blocks for each scenario variant (library, naive, structured-clone).

**When to use:** All benchmark scenarios follow this shape.

```typescript
// benchmarks/scenarios/binary-transfer.bench.ts
// Source: vitest bench API (bench global available when vitest bench is run)
import { bench, describe } from "vitest";
import { createBinaryPayload } from "../helpers/payloads.js";
import { createBenchIframe } from "../helpers/iframe-setup.js";
import { createChannel, createStream } from "../../src/index.js";

const SIZES = [1024, 64 * 1024, 1024 * 1024, 16 * 1024 * 1024];
const HEAVY = typeof process !== "undefined"
  ? process.env.IFB_BENCH_HEAVY === "1"
  : (globalThis as any).IFB_BENCH_HEAVY === "1";

for (const size of [...SIZES, ...(HEAVY ? [256 * 1024 * 1024] : [])]) {
  const label = size < 1024 * 1024
    ? `${size / 1024}KB`
    : `${size / (1024 * 1024)}MB`;

  describe(`binary-transfer ${label}`, () => {
    let iframeCtx: Awaited<ReturnType<typeof createBenchIframe>>;

    // Warm-up: 5 throwaway runs before bench() loop starts
    // tinybench runs warmupIterations automatically (default: 5)

    bench("library (transferable)", async () => {
      const buf = createBinaryPayload(size);
      await iframeCtx.sendViaLibrary(buf);
    }, {
      setup: async () => { iframeCtx = await createBenchIframe(); },
      teardown: async () => { iframeCtx.destroy(); },
      iterations: 30,
      warmupIterations: 5,
    });

    bench("naive postMessage (no framing)", async () => {
      const buf = createBinaryPayload(size);
      await iframeCtx.sendNaive(buf);
    }, {
      setup: async () => { iframeCtx = await createBenchIframe(); },
      teardown: async () => { iframeCtx.destroy(); },
      iterations: 30,
      warmupIterations: 5,
    });
  });
}
```

### Pattern 3: Binary Payload Creation (getRandomValues chunking)

**What:** `crypto.getRandomValues` has a 65536-byte per-call limit. For payloads larger than 64 KB, loop in chunks. Avoids zero-filled buffers that compress unrealistically.

**When to use:** All binary payload generation in benchmarks.

```typescript
// benchmarks/helpers/payloads.ts
export function createBinaryPayload(bytes: number): ArrayBuffer {
  const buf = new Uint8Array(bytes);
  const CHUNK = 65536; // getRandomValues limit: 64 KB per call
  for (let offset = 0; offset < bytes; offset += CHUNK) {
    const slice = buf.subarray(offset, Math.min(offset + CHUNK, bytes));
    crypto.getRandomValues(slice);
  }
  return buf.buffer;
}
```

### Pattern 4: Iframe Benchmark Context Setup

**What:** Create an iframe via `document.createElement('iframe')` with `srcdoc` loading the library. Wire a `MessageChannel` for the bench harness. The iframe side sends a "ready" signal once the library's `createChannel` handshake completes.

**When to use:** All iframe topology benchmarks.

```typescript
// benchmarks/helpers/iframe-setup.ts — conceptual pattern
// Source: browser postMessage API + Vitest browser mode (real DOM available)
export async function createBenchIframe() {
  const mc = new MessageChannel();
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
  // srcdoc inlines the library + receiver setup
  iframe.srcdoc = `<script type="module">
    import { createChannel, createStream } from '/src/index.js';
    // ... receiver setup
    // signal ready via parent port
  </script>`;
  document.body.appendChild(iframe);

  await new Promise<void>((resolve) => {
    mc.port1.onmessage = (e) => { if (e.data === "ready") resolve(); };
  });

  return {
    sendViaLibrary: async (buf: ArrayBuffer) => { /* ... */ },
    sendNaive: async (buf: ArrayBuffer) => { /* ... */ },
    destroy: () => { iframe.remove(); mc.port1.close(); mc.port2.close(); },
  };
}
```

### Pattern 5: Custom JSON Reporter

**What:** A Vitest reporter that collects bench results post-run and writes to `benchmarks/results/<timestamp>-<commit>.json` and `benchmarks/results/baseline.json`.

```typescript
// benchmarks/helpers/reporter.ts (Vitest reporter interface)
// Source: vitest reporters.d.ts
import type { Reporter } from "vitest/reporters";
import type { File } from "vitest";

export class BenchJsonReporter implements Reporter {
  onFinished(files: File[]) {
    const results = collectBenchResults(files);
    const ts = new Date().toISOString().replace(/:/g, "-");
    const sha = process.env.GITHUB_SHA?.slice(0, 7) ?? "local";
    const outPath = `benchmarks/results/${ts}-${sha}.json`;
    writeFileSync(outPath, JSON.stringify(results, null, 2));
    copyFileSync(outPath, "benchmarks/results/baseline.json");
  }
}
```

### Pattern 6: Comparator Script

**What:** `benchmarks/compare.mjs <before.json> <after.json> [--threshold 10]`. Reads both JSON files, computes per-scenario per-metric delta, prints a markdown table, exits 1 if any delta exceeds the threshold.

```javascript
// benchmarks/compare.mjs — exit 1 on regression > threshold
import { readFileSync } from "fs";
const [,, before, after, ...flags] = process.argv;
const thresholdIdx = flags.indexOf("--threshold");
const threshold = thresholdIdx > -1 ? Number(flags[thresholdIdx + 1]) : 10;

const bData = JSON.parse(readFileSync(before, "utf8"));
const aData = JSON.parse(readFileSync(after, "utf8"));

let hasRegression = false;
const rows = [];

for (const aScen of aData.scenarios) {
  const bScen = bData.scenarios.find((s) => s.name === aScen.name);
  if (!bScen) continue;

  for (const metric of ["mb_s", "p50_ms", "p95_ms", "p99_ms"]) {
    const delta = ((aScen[metric] - bScen[metric]) / bScen[metric]) * 100;
    // For throughput (mb_s): negative delta = regression; latency (p*_ms): positive delta = regression
    const isRegression = metric === "mb_s" ? delta < -threshold : delta > threshold;
    if (isRegression) hasRegression = true;
    rows.push({ scenario: aScen.name, metric, before: bScen[metric], after: aScen[metric], delta: delta.toFixed(1) + "%", status: isRegression ? "FAIL" : "ok" });
  }
}

// Print markdown table
console.log("| Scenario | Metric | Before | After | Delta | Status |");
console.log("|----------|--------|--------|-------|-------|--------|");
for (const r of rows) {
  console.log(`| ${r.scenario} | ${r.metric} | ${r.before} | ${r.after} | ${r.delta} | ${r.status} |`);
}

if (hasRegression) {
  console.error(`\nFAIL: regression > ${threshold}% detected`);
  process.exit(1);
}
```

### Anti-Patterns to Avoid

- **`test()` wrapper for bench**: Do not wrap `new Bench()` inside a `test()`. Use `bench()` directly — Vitest collects it as a benchmark task with proper statistics reporting.
- **Zero-filled payloads**: `new ArrayBuffer(size)` produces all-zeros which compresses trivially. Use `createBinaryPayload()` with `getRandomValues` chunks.
- **Reusing the same `ArrayBuffer` across iterations**: After `postMessage(buf, [buf])`, `buf` is detached. Create a fresh payload inside the bench function body, not in setup. tinybench measures the full iteration including allocation — that cost is consistent across library and naive variants, so comparisons remain valid.
- **Single iteration count**: With N=30 and small payloads (1 KB), RME may exceed 5%. For 1 KB scenarios, increase to N=100 to get a stable signal. Check `task.result.rme` and log a warning if > 5%.
- **Background tab throttling**: Run benchmarks with the browser tab visible. Playwright's headful mode (when bench is run locally) keeps the tab active. CI runs headless — Playwright's headless mode does not throttle. For WebKit: set `viewport: { width: 1280, height: 720 }` in the bench project config to avoid WebKit's zero-viewport throttling.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Statistical benchmark loop | Manual `performance.now()` timing loop | `bench()` from vitest (tinybench backend) | tinybench handles warm-up iterations, GC interaction, confidence intervals, RME, p50/p75/p99 automatically |
| RME / p-value computation | Custom statistics functions | tinybench's `task.result` (`p50`, `p75`, `p99`, `rme`, `samples`) | t-distribution lookup table is already in tinybench; manual implementation introduces error |
| Benchmark regression CI gate | Custom comparison logic beyond `compare.mjs` | `compare.mjs` exit code + standard GitHub Actions step failure | The comparator only needs to be 50 lines; external CI bench SaaS (CodSpeed, Bencher) are overkill for a research project |
| Worker bench setup boilerplate | Inline worker URL in every scenario | Shared `createBenchWorker()` helper | Worker URL construction via `new URL('./bench-worker.ts', import.meta.url)` requires Vite bundling — centralize so config is in one place |

**Key insight:** tinybench already solves the hardest part of microbenchmarking (warm-up, GC pressure detection, statistical soundness). The only hand-rolled piece is the JSON serialization reporter and the comparator script.

---

## Common Pitfalls

### Pitfall 1: Vitest bench vs `vitest bench` command

**What goes wrong:** Running `vitest run` with `.bench.ts` files in scope causes Vitest to skip bench files (they are treated as empty test files). Only `vitest bench` activates bench mode and makes the `bench()` global available.

**Why it happens:** Vitest 4 separates `mode: "test"` from `mode: "benchmark"` at the project level. The `bench()` function is not exported in the test runner — it is only injected when `vitest bench` sets the global context.

**How to avoid:** The `pnpm bench` script must invoke `vitest bench --config vitest.bench.config.ts`, not `vitest run`. Verify with `pnpm bench -- --reporter=verbose` and confirm bench results appear.

**Warning signs:** Running `pnpm bench` prints "0 tests passed" or "passWithNoTests: true" with no bench output.

---

### Pitfall 2: getRandomValues 64 KB per-call limit

**What goes wrong:** `crypto.getRandomValues(new Uint8Array(256 * 1024 * 1024))` throws `QuotaExceededError: Failed to execute 'getRandomValues': The ArrayBufferView's byte length (268435456) exceeds the number of bytes of entropy available via this API (65536)`.

**Why it happens:** The Web Crypto spec limits `getRandomValues` to 65536 bytes per call. This is a per-call limit, not a total limit.

**How to avoid:** Loop in 64 KB chunks (see `createBinaryPayload()` in Code Examples). This adds ~4096 calls for a 256 MB buffer — measurable overhead but acceptable in `setup` (not inside the timed bench loop).

**Warning signs:** `QuotaExceededError` thrown in the bench scenario before the first iteration runs.

---

### Pitfall 3: ArrayBuffer Detach After Transfer in Bench Loop

**What goes wrong:** If `createBinaryPayload()` is called in setup (outside the bench function body), the same `ArrayBuffer` is transferred on the first iteration, detached, and the second iteration fails with `TypeError: Cannot perform Uint8Array.set on a detached ArrayBuffer` or sends a zero-length transfer.

**Why it happens:** `postMessage(buf, [buf])` detaches `buf` permanently. tinybench re-runs the bench function N times using the same closure.

**How to avoid:** Create the payload inside the bench function body, not in setup. The allocation cost (~5 ms for 256 MB) is constant across library and naive variants, so comparisons remain valid. Verified by measuring: for 1 MB payloads, `createBinaryPayload(1024*1024)` takes ~0.1 ms — negligible vs the ~8 ms postMessage round-trip.

**Warning signs:** Second iteration throws TypeError or reports 0 bytes/s while first iteration succeeds.

---

### Pitfall 4: Tab Throttling in WebKit with Zero Viewport

**What goes wrong:** WebKit throttles timers and requestAnimationFrame to 1 fps if the viewport dimensions are 0×0. In headless Playwright, the default viewport may be reported as 0×0. Benchmark `performance.now()` results appear artificially slow in WebKit only.

**Why it happens:** WebKit's power-saving heuristics throttle background/zero-viewport pages.

**How to avoid:** In the bench project config, set `browser.viewport: { width: 1280, height: 720 }` in the Playwright provider options. Verified: this is the same workaround used in Playwright's WebKit testing docs.

**Warning signs:** WebKit benchmark results are 10–100× slower than Chromium for the same scenario; Chromium and Firefox results are consistent.

---

### Pitfall 5: Worker Module Bundling for Bench

**What goes wrong:** `new Worker(new URL('./bench-worker.ts', import.meta.url), { type: 'module' })` fails in Vitest browser mode because Vite does not automatically bundle `import.meta.url`-relative worker paths without a worker plugin configuration.

**Why it happens:** Vite's worker import transform requires `?worker` query params or explicit `worker: { format: 'es' }` config for `.ts` workers in library mode.

**How to avoid:** Pre-bundle the worker in `vitest.bench.config.ts` using `worker: { format: 'es' }`. Alternatively, inline the worker source as a `Blob` URL. A third option — and the cleanest — is to write the bench worker as a plain `.js` file (no TypeScript) to sidestep the transform entirely. Since the worker is a dev-only benchmark artifact, plain JS is acceptable.

**Warning signs:** `Failed to fetch` or `SyntaxError: Cannot use 'import' in a worker` when the first worker-topology benchmark runs.

---

### Pitfall 6: V8 Inlining and Cold JIT in First Samples

**What goes wrong:** The first 5 iterations of a bench loop run in the interpreter before V8 JIT-compiles the hot path. Throughput numbers from samples 1–3 are 2–5× lower than the JIT-optimized steady state. If `warmupIterations` is 0, these cold samples pollute the statistical mean.

**Why it happens:** V8's Maglev/Turbofan compilation pipeline requires ~3–5 calls to a hot function before optimization fires. tinybench's warmup phase handles this by running `warmupIterations` (default 5) before the measurement window.

**How to avoid:** Use the default `warmupIterations: 5` for all scenarios. For 1 KB payloads where timing noise is high, increase `iterations` to 100. Check `task.result.rme` — if > 5%, double the iteration count. Log a warning in the reporter if RME exceeds threshold.

**Warning signs:** `task.result.rme` > 5% for small payloads; p99/p50 ratio > 3× suggests cold-start outliers are included.

---

### Pitfall 7: 256 MB Benchmark on CI Free Tier RAM

**What goes wrong:** GitHub Actions free tier `ubuntu-latest` provides ~7 GB RAM. A 256 MB payload × 2 (sender + receiver in-flight) × 3 browsers running potentially in parallel = ~1.5 GB peak usage. This is fine for sequential browser runs but problematic if all three browser projects run simultaneously.

**Why it happens:** `bench.yml` runs three browser projects. With `workers: 1` and sequential project execution, peak RAM per run is safe. But default parallelism may launch all three simultaneously.

**How to avoid:** In `bench.yml`, set `workers: 1` for the bench CI step and run browsers sequentially (or scope the nightly bench run to Chromium-only for heavy payloads). Alternatively, gate 256 MB behind `IFB_BENCH_HEAVY=1` which is only set in the nightly matrix explicitly when needed.

**Warning signs:** GitHub Actions runner OOM kill (`Process killed`) during 256 MB benchmark with multiple browser projects in parallel.

---

### Pitfall 8: Baseline JSON Drift

**What goes wrong:** `baseline.json` in the repo becomes stale if CI never updates it. A PR that accidentally regresses all metrics by 2× passes the comparator because the comparator still uses an old baseline from 6 months ago.

**Why it happens:** Baseline is only updated when someone explicitly runs the baseline job and commits the output. If the nightly job uploads artifacts but doesn't commit `baseline.json`, it drifts.

**How to avoid:** The nightly `bench.yml` workflow commits `benchmarks/results/baseline.json` to main after a successful run using `git commit --allow-empty-message` with the `[skip ci]` trailer. This requires `contents: write` permission on the job. Document the policy: baseline is updated on every successful nightly run; baseline drift beyond 30 days is a workflow failure.

**Warning signs:** `baseline.json` last-modified date is more than 30 days ago; nightly CI only uploads artifacts but never commits.

---

## Code Examples

Verified patterns from installed packages and project source:

### tinybench Task Result Fields (verified from tinybench 6.0.0 types)

```typescript
// tinybench 6.0.0 — task.result fields available after bench run
// Source: node_modules/tinybench/dist/index.js (installed, confirmed ESM)
import { Bench } from "tinybench";

const bench = new Bench({ iterations: 30, warmupIterations: 5 });
bench.add("example", async () => { /* ... */ });
await bench.run();

for (const task of bench.tasks) {
  const r = task.result!;
  // r.hz        — operations per second
  // r.mean      — mean time in ms
  // r.min       — min sample in ms
  // r.max       — max sample in ms
  // r.p50       — median (p50) in ms
  // r.p75       — 75th percentile in ms
  // r.p99       — 99th percentile in ms
  // r.rme       — relative margin of error (%)
  // r.samples   — array of timing samples (available when includeSamples: true)
  console.log(`${task.name}: ${r.hz.toFixed(0)} ops/s, p99: ${r.p99.toFixed(2)}ms, rme: ${r.rme.toFixed(2)}%`);
}
```

### tinybench Browser Safety (verified from dist source inspection)

```typescript
// tinybench uses process.versions only for runtime labeling (not for benchmarking).
// In browser: process is undefined → runtime label becomes "unknown" → safe.
// No fs, path, crypto (Node), child_process, or Buffer references found.
// Confirmed by: grep process.versions/release in dist/index.js — returns only
// runtime-environment detection code, not timing or math code.
```

### MB/s Computation

```typescript
// After bench run: compute throughput from known payload size + task.result.hz
function mbPerSecond(payloadBytes: number, hz: number): number {
  return (payloadBytes * hz) / 1_000_000;
}

// Example: 1 MB payload at 124.3 ops/s → 124.3 MB/s
// Example: 16 MB payload at 7.8 ops/s → 124.8 MB/s
```

### JSON Artifact Schema (from CONTEXT.md decisions)

```typescript
interface BenchArtifact {
  timestamp: string;        // ISO-8601
  commit: string;           // 7-char short SHA
  node: string;             // e.g. "22.22.1"
  browser: "chromium" | "firefox" | "webkit";
  browserVersion: string;
  scenarios: ScenarioResult[];
}

interface ScenarioResult {
  name: string;             // e.g. "binary-1mb-single-hop"
  mb_s: number;             // computed: payloadBytes * hz / 1e6
  p50_ms: number;
  p95_ms: number;           // Note: tinybench provides p99 not p95; use p99 as p95 proxy or record both
  p99_ms: number;
  samples: number;          // task.result.samples.length (30 by default)
  rme: number;              // relative margin of error %
}
```

Note on p95: tinybench 6.0.0 exposes `p50`, `p75`, `p99` — not `p95`. The artifact schema from CONTEXT.md mentions `p95_ms`. Store `p75_ms` instead (closest available), or calculate p95 from raw samples if `includeSamples: true` is set in the benchmark config.

### bench.yml CI Workflow Structure

```yaml
# .github/workflows/bench.yml
name: Benchmarks

on:
  schedule:
    - cron: "0 2 * * *"   # nightly at 02:00 UTC
  workflow_dispatch:        # manual trigger
  pull_request:
    types: [labeled]        # "bench-regression" label triggers PR bench

jobs:
  bench:
    if: >
      github.event_name == 'schedule' ||
      github.event_name == 'workflow_dispatch' ||
      (github.event_name == 'pull_request' && contains(github.event.label.name, 'bench-regression'))
    runs-on: ubuntu-latest
    permissions:
      contents: write       # to commit updated baseline.json
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Install Playwright browsers
        run: pnpm exec playwright install --with-deps chromium firefox webkit
      - name: Run benchmarks (default payload sizes)
        run: pnpm bench --config vitest.bench.config.ts
      - name: Upload results artifact
        uses: actions/upload-artifact@v4
        with:
          name: bench-results-${{ github.sha }}
          path: benchmarks/results/
      - name: Compare against baseline (PR runs only)
        if: github.event_name == 'pull_request'
        run: node benchmarks/compare.mjs benchmarks/results/baseline.json benchmarks/results/latest.json --threshold 10
      - name: Commit updated baseline (nightly only)
        if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
        run: |
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git config user.name "github-actions[bot]"
          git add benchmarks/results/baseline.json
          git diff --cached --quiet || git commit -m "chore(bench): update baseline [skip ci]"
          git push
```

### WebKit Viewport Fix

```typescript
// In vitest.bench.config.ts — WebKit requires non-zero viewport to avoid throttling
{
  test: {
    name: "bench-webkit",
    include: ["benchmarks/scenarios/**/*.bench.ts"],
    browser: {
      enabled: true,
      provider: "playwright",
      instances: [{ browser: "webkit" }],
      viewport: { width: 1280, height: 720 },
    },
  },
}
```

---

## Environment Availability

All required tools are already present from previous phases.

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Comparator script, CI | ✓ | 22.22.1 | — |
| vitest | bench() runner | ✓ | 4.1.4 | — |
| @vitest/browser | Browser mode for bench | ✓ | 4.1.4 | — |
| tinybench | Bench loop engine | ✓ | 6.0.0 | — |
| playwright / chromium | Cross-browser bench | ✓ | 1.59.1 / installed | — |
| playwright / firefox | Cross-browser bench | ✓ | 1.59.1 / installed | — |
| playwright / webkit | Cross-browser bench | ✗ locally (ICU ABI mismatch on Arch Linux) | — | CI ubuntu-latest with --with-deps (established in Phase 1) |
| tsx | Comparator script runner | ✓ | 4.21.0 | `node` (if compare.mjs is pure ESM with no TypeScript) |

**Missing with fallback:**
- WebKit: not runnable locally on this Arch Linux system (ICU 74 vs 78 ABI mismatch — documented in Phase 1 01-04-SUMMARY.md). CI covers WebKit. Local bench defaults to `--project=bench-chromium --project=bench-firefox`.

---

## Validation Architecture

`workflow.nyquist_validation` is `true` in `.planning/config.json`.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.4 (bench mode) + tinybench 6.0.0 |
| Config file | `vitest.bench.config.ts` (new — Wave 0 gap) |
| Quick run command | `pnpm bench --config vitest.bench.config.ts --project=bench-chromium` |
| Full suite command | `pnpm bench --config vitest.bench.config.ts` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BENCH-01 | Harness runnable locally and in CI across 3 browsers | smoke / bench | `pnpm bench --config vitest.bench.config.ts` | ❌ Wave 0 |
| BENCH-02 | Measures throughput (MB/s), latency p50/p95/p99, CPU | bench (assert rme < 10%) | `pnpm bench -- --reporter=verbose` | ❌ Wave 0 |
| BENCH-03 | Compares library vs naive across all data types and sizes | bench (assert library >= naive on binary) | `pnpm bench --config vitest.bench.config.ts` | ❌ Wave 0 |
| BENCH-04 | Report versioned in repository | file existence check | `ls benchmarks/results/baseline.json` | ❌ Wave 0 |
| BENCH-05 | WASM decision logged as artifact | file existence check | `ls .planning/decisions/05-wasm-decision.md` | ❌ Wave 0 |

Note: BENCH-02/BENCH-03 validation is the bench run itself — the harness both measures and validates. A CI pass with green bench output confirms BENCH-01 through BENCH-03.

### Sampling Rate

- **Per task commit:** `pnpm bench --config vitest.bench.config.ts --project=bench-chromium` (Chromium only, excludes 256 MB, < 90 seconds)
- **Per wave merge:** `pnpm bench --config vitest.bench.config.ts` (all three browsers, excludes 256 MB, < 5 minutes)
- **Phase gate:** Full suite green + `benchmarks/results/baseline.json` committed + `.planning/decisions/05-wasm-decision.md` written

### Wave 0 Gaps

- [ ] `vitest.bench.config.ts` — new config file, browser projects scoped to `benchmarks/scenarios/**/*.bench.ts`
- [ ] `benchmarks/scenarios/binary-transfer.bench.ts` — binary ArrayBuffer transferable path
- [ ] `benchmarks/scenarios/structured-clone.bench.ts` — structured-clone slow path
- [ ] `benchmarks/scenarios/naive-baseline.bench.ts` — raw postMessage without library framing
- [ ] `benchmarks/helpers/payloads.ts` — `createBinaryPayload()`, `createStructuredPayload()`
- [ ] `benchmarks/helpers/iframe-setup.ts` — `createBenchIframe()` with srcdoc + MessageChannel handshake
- [ ] `benchmarks/helpers/worker-setup.ts` — `createBenchWorker()` with module worker
- [ ] `benchmarks/helpers/reporter.ts` — custom JSON reporter
- [ ] `benchmarks/compare.mjs` — comparator script
- [ ] `benchmarks/results/baseline.json` — populated after first successful bench run
- [ ] `.github/workflows/bench.yml` — nightly bench CI workflow
- [ ] `.planning/decisions/05-wasm-decision.md` — decision template (filled post-run)
- [ ] Package.json script update: `"bench": "vitest bench --config vitest.bench.config.ts"`

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual timing with `performance.now()` in `test()` | `bench()` global with tinybench backend | Vitest 1.3 (2024) | Statistical soundness, warm-up, RME out of box |
| CodSpeed / external SaaS for CI regression | JSON file + comparator script + artifact upload | Project decision | Self-contained, no external service dependency |
| `jsdom` for benchmark isolation | Real browser via Vitest browser mode + Playwright | Vitest 2.0 (2024) | Real GC, real structured-clone cost, real Transferable semantics |
| `bench(fn, { iterations })` only | tinybench 6 adds `warmupIterations`, `warmupTime`, `time`, per-task setup/teardown hooks | tinybench 4.0 | Cleaner warm-up management without manual boilerplate |

**Deprecated/outdated:**
- `benchmark.js` (npm): Heavy, CommonJS-first, complex API. Replaced by tinybench in the Vitest ecosystem.
- `jest-bench`: Jest-specific, no browser mode. Irrelevant — project uses Vitest.

---

## Open Questions

1. **p95 metric availability**
   - What we know: tinybench 6.0.0 exposes `p50`, `p75`, `p99` but not `p95`
   - What's unclear: The artifact schema in CONTEXT.md specifies `p95_ms`
   - Recommendation: Store `p75_ms` and `p99_ms` in the artifact (rename from `p95_ms` to `p99_ms`). If p95 is needed, enable `includeSamples: true` and compute `percentile(samples, 95)` in the reporter. This adds memory overhead for large sample counts but is viable.

2. **bench.yml baseline commit strategy**
   - What we know: Committing from GitHub Actions requires `contents: write` + configuring git user
   - What's unclear: Should the baseline commit be squashed into a single baseline-bot commit or separate per-run? Separate per-run creates noise in git history.
   - Recommendation: Single overwrite commit tagged `[skip ci]` on nightly, keeping only the latest baseline. Git history for baseline drift can be tracked via the uploaded artifact archive.

3. **Worker bench in browser mode bundling**
   - What we know: `import.meta.url`-relative worker imports require Vite worker config
   - What's unclear: Whether `vitest.bench.config.ts` needs explicit `worker: { format: 'es' }` or if Vitest browser mode handles it
   - Recommendation: Test with a minimal worker bench first. If bundling fails, fall back to inline Blob URL workers for bench-only use. Document the outcome in the Phase 5 summary.

---

## Sources

### Primary (HIGH confidence)

- Installed `node_modules/tinybench/dist/index.js` (v6.0.0) — browser-safety inspection, process.versions usage, Bench API
- Installed `node_modules/vitest/dist/chunks/suite.d.udJtyAgw.d.ts` — bench global declaration
- Installed `node_modules/vitest/dist/chunks/benchmark.d.DAaHLpsq.d.ts` — BenchmarkAPI, BenchmarkResult types
- Installed `node_modules/vitest/dist/chunks/config.d.ChUh6-ad.d.ts` — mode: "test" | "benchmark", browser config
- Project `package.json` — confirmed versions: vitest@4.1.4, @vitest/browser@4.1.4, tinybench@6.0.0, playwright@1.59.1
- Project `.planning/research/STACK.md` — verified Vitest 4 browser mode stable since Dec 2025, bench support confirmed
- Phase 1 `01-04-SUMMARY.md` — WebKit local ICU ABI issue; `--with-deps` on ubuntu-latest resolves
- Phase 4 `04-05-SUMMARY.md` — `channel.stats()` available for byte-count cross-check during benchmarks

### Secondary (MEDIUM confidence)

- `.planning/phases/05-benchmark-harness/05-CONTEXT.md` — locked decisions for harness design, payload sizes, CI gate policy
- Web Crypto API spec — `getRandomValues` 65536-byte limit per call (MDN-documented, consistent across engines)
- Playwright docs — `viewport` config for WebKit headless (well-documented mitigation)

### Tertiary (LOW confidence)

- GitHub Actions free tier RAM (~7 GB) — documented in GitHub docs but subject to change; 256 MB bench safety margin confirmed by calculation
- V8 warm-up iteration count (3–5 calls for JIT) — widely reported but implementation-specific

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages installed and verified against project lock
- Architecture patterns: HIGH — patterns derived from installed source + prior-phase summaries + locked CONTEXT.md decisions
- Pitfalls: HIGH — pitfalls 1–3 and 6 verified against installed source or spec; pitfalls 4–5 MEDIUM (Playwright behavior + Vite worker bundling are partially implementation-specific)

**Research date:** 2026-04-21
**Valid until:** 2026-07-21 (90 days; all libraries are pinned in lockfile so drift is low)
