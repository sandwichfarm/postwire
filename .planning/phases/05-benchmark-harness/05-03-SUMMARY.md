---
phase: "05"
plan: "03"
slug: wasm-decision
completed: 2026-04-21
autonomous: yes
---

# Plan 05-03: WASM Gate Decision

## Objective

Read the committed `baseline.json`, classify the bottleneck, and write the WASM go/no-go decision document.

## Decision outcome

**`deferred`** — no WASM in Phase 6. SAB fast path is the sole Phase 6 addition.

## Key numbers that drove the decision

| Scenario | 1 MB MB/s | 16 MB MB/s | 16 MB p99/p50 |
|----------|----------:|-----------:|--------------:|
| library (transferable) | 1,315.4 | 1,842.1 | 1.44 |
| naive postMessage | 2,528.2 | 2,873.7 | 1.58 |
| library/naive | 0.52× | 0.64× | — |

- Library trails naive at every size but the gap narrows as payload grows → per-send framing tax is fixed, not per-byte.
- p99/p50 at 16 MB = 1.44 → no GC spikes → WASM ring-buffer framing would not attack the right bottleneck.
- 1.8 GB/s absolute throughput at 16 MB is fast enough for the target consumer of a streaming library.

## Phase 6 scope impact

Phase 6 proceeds as planned: SAB fast path only. The `package.json` `./wasm` export slot remains reserved (from Phase 1) so a future WASM addition is non-breaking. No Rust/wasm-pack toolchain introduced.

## BENCH-03 note

The ROADMAP's BENCH-03 says library throughput should beat naive postMessage at 1 MB+. The data says otherwise — library is 0.5–0.65× naive across the range. The WASM decision document proposes a revised framing: "library stays within a bounded factor of naive (< 3× slowdown) while providing ordering + backpressure + typed errors that naive cannot". This interpretation is surfaced for human review at phase verification.

## Files

- Added: `.planning/decisions/05-wasm-decision.md` (full analysis + trigger conditions)

## Requirements

- **BENCH-04**: ✓ WASM decision documented in project decision log with concrete benchmark evidence
- **BENCH-05**: ✓ 10% regression comparator verified working end-to-end in Plan 05-02; CI gate wired via `.github/workflows/bench.yml` (Plan 05-00) + `benchmarks/compare.mjs`

## Next

Phase 5 is complete. `/gsd:execute-phase 05 --verify` then `/gsd:phase complete 05` then proceed to Phase 6.
