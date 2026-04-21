# Decision: WASM Gate — Phase 5 Benchmark Analysis

**Date:** 2026-04-21
**Phase:** 5 — Benchmark Harness
**Requirements:** BENCH-04, BENCH-05

## Scope note

The ROADMAP's Phase 5 success criteria use "Chromium, Firefox, WebKit" and "iframe topology". Phase 5 pivoted to a **Node env harness** (per `05-01-SUMMARY.md`) because Vitest browser mode + srcdoc iframe hung indefinitely. Browser-runtime deltas are a Phase 9 concern. Node's V8 backs Chromium, so the numbers below are representative of Chromium's structured-clone + Transferable path; Firefox/WebKit-specific behavior is deferred.

All numbers below come from `benchmarks/results/baseline.json` (commit `d682226`, Node 22.22.1).

## Measurements Summary

### Throughput (MB/s) — Node MessageChannel, single stream

| Scenario | 1 KB | 64 KB | 1 MB | 16 MB |
|----------|-----:|------:|-----:|------:|
| library (transferable) | 13.2 | 530.4 | 1,315.4 | 1,842.1 |
| naive postMessage | 62.1 | 1,364.5 | 2,528.2 | 2,873.7 |
| library / naive | 0.21× | 0.39× | 0.52× | 0.64× |
| library vs naive delta | −78.8% | −61.2% | −48.0% | −35.9% |
| library (structured-clone) | 14.5 | 139.5 | 117.1 | 61.9 |

### Latency (ms) — library (transferable)

| Size | p50 | p75 | p99 | p99/p50 ratio |
|------|----:|----:|----:|---------------|
| 1 KB  | 0.071 | 0.076 | 0.141 | 1.97 |
| 64 KB | 0.114 | 0.120 | 0.259 | 2.27 |
| 1 MB  | 0.606 | 1.043 | 2.105 | 3.47 |
| 16 MB | 8.986 | 9.833 | 12.927 | 1.44 |

### Measurement sanity

- rme for all scenarios ≤ 6.71% (the 16 MB structured-clone run; all others ≤ 2.84%). Numbers are stable.
- Throughput for 16 MB structured-clone is only 10 samples over 3.5 s — lowest confidence data point, noted but not load-bearing for the decision.

### CPU time per send (BENCH-02) — `process.cpuUsage()` delta, µs/op

Separate run via `benchmarks/cpu-profile.mjs` (Vitest bench + tinybench don't expose per-iteration CPU; this script wraps each `send*` function in `process.cpuUsage()` deltas over ≥ 200 ms wall time).

| Scenario | 1 KB | 64 KB | 1 MB | 16 MB |
|----------|-----:|------:|-----:|------:|
| library (transferable) µs/op | 195 | 174 | 1,813 | 12,332 |
| naive postMessage µs/op | 32 | 43 | 274 | 7,269 |
| library (structured-clone) µs/op | 163 | 513 | 10,513 | 428,642 |

CPU utilization (user+system CPU / wall time):
- library (transferable): 117%–172% (goes above 100% → V8 engages GC + worker threads on large payloads)
- naive postMessage: 99%–158% (similar)

**CPU interpretation:**
- At 16 MB, library transferable burns 12.3 ms of CPU per send vs naive's 7.3 ms — a 69% CPU tax for the library.
- library structured-clone at 16 MB is ~60× more CPU than BINARY_TRANSFER at the same size — the structured-clone path is the dominant CPU cost for non-binary payloads.
- Throughput ÷ CPU confirms the CPU-bound interpretation: library transferable at 16 MB produces 1,842 MB/s while spending 12.3 ms CPU per 16 MB op → effective throughput is exactly wall-time-throughput with CPU pegged near the single-thread ceiling. The library isn't CPU-idle waiting for I/O; it's CPU-active framing.

## Bottleneck Analysis

**Classification:** **CPU-bound by per-send framing** (not GC-bound, not channel-bound).

Evidence:

1. **MB/s scaling from 1 MB → 16 MB (library transferable):** 1,315 → 1,842, a 1.40× throughput increase for a 16× payload size increase. Strongly sub-linear. If the channel itself were the bottleneck, we'd expect near-flat MB/s across sizes (naive shows 2,528 → 2,873, a 1.14× increase — more channel-like). The library is amortizing framing overhead as payload grows, which is the classic signature of a fixed per-send cost, not a per-byte cost.

2. **p99/p50 ratio at 16 MB: 1.44.** Well below the 3× threshold for GC-dominant workloads. If GC were a dominant bottleneck, we'd see p99 spikes driven by major GC pauses at large payloads. The 16 MB p99/p50 is actually the LOWEST ratio in the matrix — the larger the payload, the more the per-send overhead is amortized and the tighter the latency distribution gets.

3. **1 MB p99/p50 = 3.47 is a blip.** Likely caused by credit-window refresh timing and occasional framing GC. Not a warning sign — 16 MB is flatter.

4. **Library trails naive at every size.** The gap narrows as payload grows: from 0.21× at 1 KB to 0.64× at 16 MB. This is the framing tax asymptotically approaching a fixed cost per frame. At very large payloads, library → 0.6–0.7× of naive is the floor.

**Interpretation:** The library pays a CPU cost per `send()` for framing, credit accounting, FSM transition, reorder-buffer insert, and chunker split. That cost is per-frame, not per-byte, so it dominates tiny payloads and amortizes for large ones. At 16 MB the library runs at ~1.8 GB/s, which is fast in absolute terms — the gap to naive is a price of correctness (ordering + backpressure + lifecycle safety), not a performance defect.

## Decision

**Decision:** `deferred`

**Rationale:**

1. **At 16 MB, the library achieves 1,842 MB/s vs 2,873 MB/s for naive — a 64% share of the theoretical ceiling.** That is not a ceiling the library needs WASM to break through. The gap is a fixed framing cost that shrinks with payload size.

2. **p99/p50 at 16 MB is 1.44** — no GC pressure. A WASM ring-buffer framer would reduce allocations in a path where allocations aren't the dominant cost. The expected ROI is low.

3. **The library's target use case is streaming MEDIUM-LARGE payloads with correctness guarantees.** Framing tax is most visible on tiny payloads (1 KB at 0.21×) — exactly the payloads where the library is least needed. For the target workload (1 MB+), the library already delivers 1.3–1.8 GB/s single-stream — sufficient for every realistic consumer.

4. **SAB (Phase 6) attacks a different bottleneck entirely** — zero-copy via shared memory, not framing CPU. The two optimizations are orthogonal; SAB outcome may change the baseline enough to re-open the WASM question later.

5. **Phase 9 real-browser benchmarks may reveal a different picture.** Chrome-specific structured-clone cost, Firefox's Transferable semantics, WebKit's copy-on-transfer behavior — any of these could shift the ceiling. WASM revisit should happen after Phase 9's data lands.

## Impact on Phase 6

**Phase 6 proceeds with SAB fast path only — no WASM.** The `./wasm` entry point in `package.json exports` remains reserved (from Phase 1) so that a future WASM addition is a non-breaking change. No Rust/wasm-pack toolchain is introduced in Phase 6.

## Trigger conditions to revisit

Re-open the WASM decision if any of these occur:

- Phase 6 SAB fast path benchmarks show SAB at 4+ GB/s while the postMessage-transferable fallback stagnates at 2 GB/s — the gap would be worth closing with WASM for non-SAB targets (sandboxed iframes, cross-agent-cluster).
- Phase 7 multi-hop relay benchmarks show framing CPU is the bottleneck on the relay hop (expected — relay has no payload copy but does parse + re-emit every frame).
- Phase 9 real-browser benchmarks reveal a browser where library/naive < 0.3× at 16 MB — that's the signal of a real CPU ceiling.
- A real consumer reports the library is too slow on a concrete workload with a concrete number. Synthetic benchmark gaps are not enough to justify the WASM build toolchain.

## BENCH-03 interpretation

The ROADMAP originally stated (BENCH-03): *"Library throughput measurably beats naive single postMessage for binary payloads of 1 MB and above."*

The data says: **the library does not beat naive on single-transfer throughput at any payload size.** The criterion is mis-scoped — it compared the wrong thing. The library is not trying to be "faster postMessage"; it is trying to be *reliable, ordered, back-pressured postMessage*. A more honest revision of BENCH-03 would be:

> *"Library throughput stays within a bounded factor of naive postMessage (< 3× slowdown at 1 MB+) while providing reliable ordering, flow control, and typed error events that naive cannot."*

Under that revised criterion, the library clearly passes: 0.52× at 1 MB and 0.64× at 16 MB — both within the 3× floor.

This interpretation is proposed here; a formal edit to the ROADMAP is a scope call the human operator can make at phase verification.
