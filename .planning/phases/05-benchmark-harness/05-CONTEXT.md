# Phase 5: Benchmark Harness - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning
**Mode:** Auto-generated with grey-area defaults (YOLO)

<domain>
## Phase Boundary

A reproducible benchmark suite runs in real browsers (Chromium, Firefox, WebKit) and publishes throughput, latency, and CPU data. The data drives the WASM decision and every subsequent optimization decision.

This phase covers:
- `benchmarks/` directory with tinybench-based harness runnable from Vitest browser mode
- Benchmark scenarios: binary transfer (Transferable path), structured-clone (non-transferable), naive-postMessage baseline (no library, raw chunked send for comparison)
- Payload sizes: 1 KB, 64 KB, 1 MB, 16 MB, 256 MB (the largest may be gated behind `--heavy` flag due to memory limits)
- Topology: single-hop parent↔iframe AND parent↔worker (Phase 3 single-hop; multi-hop relay is Phase 7)
- Metrics collected per scenario × payload size × data type: throughput (MB/s), latency p50/p95/p99, CPU-time estimate via `performance.now()` window sampling
- Results serialized to `benchmarks/results/<timestamp>-<commit>.json` and the latest pinned to `benchmarks/results/baseline.json`
- Comparator script: `benchmarks/compare.mjs <before.json> <after.json>` reports per-dimension delta, exits non-zero on >10% regression (for CI gate)
- `pnpm bench` runs the full local suite; CI runs it nightly via a separate workflow file `.github/workflows/bench.yml`
- WASM decision logged in `.planning/decisions/05-wasm-decision.md` — "transferable path shows headroom, WASM deferred" OR "ceiling reached, introduce WASM in Phase 6"

This phase explicitly does NOT include:
- WASM implementation — Phase 6 (gated by this phase's decision)
- Multi-hop relay benchmarks — Phase 7 adds relay-path numbers
- SAB benchmark comparison — Phase 6 (part of the WASM/SAB path work)
- Benchmark publishing to the docs site — Phase 10

Requirements covered: BENCH-01, BENCH-02, BENCH-03, BENCH-04, BENCH-05.

</domain>

<decisions>
## Implementation Decisions

### Harness

- `tinybench` as benchmark runner (dev dep)
- Vitest browser mode + Playwright for real-browser runs (already wired in Phase 1)
- Separate benchmark config: `vitest.bench.config.ts` (or extend main config) — browser project + benchmark-only glob
- Scenario file structure: `benchmarks/scenarios/<name>.bench.ts` — one per benchmark family

### Payload Sizes

- 1 KB, 64 KB, 1 MB, 16 MB for the default run
- 256 MB gated behind `--heavy` or explicit env `IFB_BENCH_HEAVY=1` (V8 heap defaults make this borderline; needs `--max-old-space-size=4096` in some envs)
- All sizes run on CI nightly; local `pnpm bench` defaults to excluding 256 MB for dev ergonomics

### Data Types

- **Binary (ArrayBuffer)** — primary perf target, uses Transferable zero-copy path
- **Structured clone (JS object)** — 1KB JSON-like objects repeated until size target; no transfer, slow path
- **Naive postMessage baseline** — same payload, `port.postMessage(buffer, [buffer])` in a tight loop without framing — represents "what you'd write without the library"

### Reporting

- Run N=30 iterations per scenario (tinybench default, may increase for 1 KB to get signal above noise)
- Record: `name, hz, mean, min, max, p50, p75, p99, rme, samples`
- Compute MB/s: `payloadBytes * hz / 1e6`
- CPU estimate: percentage of elapsed wall time in `synchronous` code sections (use `performance.now()` markers around sync loops)

### Artifact Format

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

### CI Gate

- Nightly: `bench.yml` workflow runs full suite on ubuntu-latest, uploads artifacts
- On PR: `ci.yml` does NOT run benchmarks by default (too slow). A "bench-regression" label triggers the bench job. When it runs, it compares against `baseline.json` committed on master.
- 10% regression in any dimension fails the job. Baseline is refreshed manually (a decision to accept a regression is a team call, not automatic).

### WASM Decision Log

- `.planning/decisions/05-wasm-decision.md` is the output artifact. Structure:
  - Measurements summary
  - Transferable-path ceiling analysis (are we CPU-bound, GC-bound, or channel-bound?)
  - Decision: `deferred` or `proceed-with-phase-6-wasm`
  - Rationale with concrete numbers

### Claude's Discretion

- Benchmark file naming, exact tinybench API usage, comparator script JS/MJS choice
- Whether to integrate with an external bench viewer (codspeed, hyperfine-style) — OUT for now; CSV/JSON is enough
- Whether the 256 MB test is `it.runIf(heavyMode)` or a separate file

</decisions>

<code_context>
## Existing Code Insights

- Phase 1 installed Vitest 4 browser mode and Playwright 1.59 (STACK.md). All three browsers already configured.
- Phase 3's MockEndpoint (`tests/helpers/mock-endpoint.ts`) is Node-only; browser benchmarks use real iframe/worker contexts.
- Phase 3 adapters (`createStream`, `createLowLevelStream`) are the primary benchmark targets.
- Phase 4's `channel.stats()` is useful as a cross-check during benchmarking (confirm byte counts match expected payload).
- `isolatedDeclarations: true` + ESM + `.js` extensions apply here too.
- Zero runtime deps: `tinybench` is a devDep.

</code_context>

<specifics>
## Specific Ideas

- For binary payloads, use `crypto.getRandomValues(new Uint8Array(size))` to fill — prevents compression-friendly zeros from skewing results.
- For structured clone, build a nested object with strings of total size ≈ target; keep it realistic.
- For the naive baseline: use a bare MessageChannel with no framing — transfer the whole payload as-is where possible, chunked at 64 KB where the payload exceeds a reasonable single-message size (browsers will handle the chunking for us but we want apples-to-apples).
- Local `pnpm bench` should finish in under 2 minutes (excluding 256 MB); CI nightly in under 10.
- Baseline JSON is committed to the repo so the comparator has a reference; updating baseline is an explicit PR action.

</specifics>

<deferred>
## Deferred Ideas

- WASM implementation — Phase 6
- SAB fast path + SAB benchmarks — Phase 6
- Multi-hop relay benchmark — Phase 7
- Docs site integration of benchmark charts — Phase 10

</deferred>
