---
phase: "05"
plan: "02"
slug: baseline-and-compare
completed: 2026-04-21
autonomous: yes
---

# Plan 05-02: Baseline + Comparator

## Objective

Run the Node-mode benchmark harness, produce a committed `benchmarks/results/baseline.json`, verify the 10% regression comparator works.

## What was done

1. Ran `pnpm exec vitest bench --outputJson benchmarks/results/latest.json` — completes in ~28 s, 12 scenarios.
2. Added `benchmarks/normalize.mjs` to convert Vitest's per-benchmark JSON (`files[].groups[].benchmarks[]`) into our simplified schema (`scenarios[] = { name, payloadBytes, mb_s, hz, p50_ms, p75_ms, p99_ms, samples, rme, ... }`).
3. Updated `package.json` scripts:
   - `pnpm bench` — runs vitest bench + normalizes to `baseline.json`
   - `pnpm bench:raw` — raw vitest output, skip normalization
   - `pnpm bench:compare` — delegates to `benchmarks/compare.mjs`
4. Committed `benchmarks/results/baseline.json` as the first reference baseline.
5. Tested the comparator:
   - `compare.mjs baseline.json baseline.json` → exit 0 (self-compare passes)
   - `compare.mjs baseline.json <mb_s regressed 20%>` → exit 1 (regression detected)

## Baseline numbers (local, Node 22.22.1)

| Scenario | Size | MB/s | p50 (ms) | p99 (ms) | hz | samples |
|---|---|---:|---:|---:|---:|---:|
| library (transferable) | 1 KB | 13.2 | 0.07 | 0.14 | 12,930 | 25,861 |
| library (transferable) | 64 KB | 530.4 | 0.11 | 0.26 | 8,093 | 16,187 |
| library (transferable) | 1 MB | 1,315.4 | 0.61 | 2.11 | 1,254 | 2,509 |
| library (transferable) | 16 MB | 1,842.1 | 8.99 | 12.93 | 109 | 220 |
| naive postMessage | 1 KB | 62.1 | 0.02 | 0.03 | 60,633 | 121,268 |
| naive postMessage | 64 KB | 1,364.5 | 0.04 | 0.12 | 20,820 | 41,641 |
| naive postMessage | 1 MB | 2,528.2 | 0.38 | 1.76 | 2,411 | 4,823 |
| naive postMessage | 16 MB | 2,873.7 | 5.85 | 9.21 | 171 | 344 |
| library (structured-clone) | 1 KB | 14.5 | 0.06 | 0.14 | 14,126 | 28,254 |
| library (structured-clone) | 64 KB | 139.5 | 0.44 | 0.77 | 2,128 | 4,257 |
| library (structured-clone) | 1 MB | 117.1 | 8.57 | 11.93 | 111 | 224 |
| library (structured-clone) | 16 MB | 61.9 | 258.03 | 317.32 | 3.7 | 10 |

## BENCH-03 finding (important)

The ROADMAP criterion BENCH-03 states:

> Library throughput measurably beats naive single postMessage for binary payloads of 1 MB and above.

**The current numbers do not support that claim.** For binary-transfer across the whole range, naive is roughly 1.5–5× faster than the library in Node:

- 1 MB: naive 2,528 MB/s vs library 1,315 MB/s — naive is 1.92× faster
- 16 MB: naive 2,873 MB/s vs library 1,842 MB/s — naive is 1.56× faster

This is expected and honest: the library pays a framing + credit-accounting + FSM + EventEmitter tax per send. The library's **value proposition is not "beat naive on single transfers"** — it is:

1. Reliable, ordered, multi-chunk delivery with backpressure (naive has none)
2. Credit-gated slow-consumer safety (naive blows up under the heap-flat test from Phase 3, library stays flat — already proven)
3. Three ergonomic API surfaces over the same primitive
4. End-to-end semantics across proxy hops (Phase 7)
5. Feature-detected fast-path selection (Phase 6)

**Action:** BENCH-03 as literally worded is not met. I am flagging this in the Plan 05-03 WASM decision document as the central interpretation question — should we narrow BENCH-03 to "library is within 2× naive throughput for 1 MB+" (which we do meet) and let Phase 6 SAB revisit the ceiling? Or reject the criterion as mis-scoped and remove it?

The raw numbers are committed and don't change. The interpretation is a scope call for the WASM decision in Plan 05-03.

## Comparator verification

Self-compare green:
```
PASS: all metrics within 10% threshold
exit: 0
```

Artificial 20% regression detected correctly:
```
FAIL: one or more metrics regressed >10%
exit: 1
```

## Files changed

- Added: `benchmarks/normalize.mjs`
- Added: `benchmarks/results/baseline.json`
- Added: `benchmarks/results/latest.json`
- Modified: `package.json` — bench scripts now produce baseline + raw variants

## Requirements status

- **BENCH-01** — `pnpm bench` runs and writes results artifact. Partially: runs in Node, not the three-browser matrix. Browser-mode deferred to Phase 9 (documented in 05-01-SUMMARY.md).
- **BENCH-03** — Naive comparison data is committed, BUT the library does not beat naive on throughput. Interpretation deferred to 05-03 WASM decision.
- **BENCH-05** — 10% regression comparator verified working end-to-end.

## Next

Plan 05-03 — write `.planning/decisions/05-wasm-decision.md` interpreting these numbers and deciding whether to proceed with WASM in Phase 6.
