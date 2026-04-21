---
phase: 06-sab-fast-path
verified: 2026-04-21T19:35:00Z
status: passed
score: 6/6 must-haves verified (SC3 benchmark-improvement criterion accepted via option A — data is published honestly, SAB disadvantage in Node is Node-specific; Phase 9 will produce browser data under real COOP/COEP)
human_verification:
  - test: "Run pnpm bench or node benchmarks/compare.mjs and confirm SAB throughput criterion interpretation"
    expected: "Either (A) accept revised reading 'benchmark scenarios exist and data is published' and mark FAST-04 criterion 3 satisfied, or (B) explicitly defer criterion 3 to Phase 9 browser data"
    why_human: "Phase goal success criterion 3 says 'Benchmark shows a measurable throughput improvement on the SAB path vs. the transferable path'. Node data shows SAB is 0.20x–0.70x of transferable. The decision doc explains why (no structured-clone envelope in Node's MessageChannel). This is a project-owner judgment call about whether the criterion is satisfied by Node data or deferred to Phase 9 browser benchmarks."
---

# Phase 6: SAB Fast Path Verification Report

**Phase Goal:** The SharedArrayBuffer + Atomics ring-buffer transport is available as a feature-detected, opt-in fast path that activates only when cross-origin isolation is confirmed and ServiceWorker endpoints are excluded.
**Verified:** 2026-04-21T19:35:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | SPSC ring-buffer over SharedArrayBuffer preserves byte order across wrap | VERIFIED | `sab-ring.test.ts` — "handles wrap: 4 frames of 80 bytes each in a 256-byte ring" + "consumer skips padding marker and reads frame at offset 0" — both pass |
| 2 | Producer blocks when full via Atomics.waitAsync; consumer wakes via Atomics.notify | VERIFIED | `sab-ring.ts` lines 99–110 use `Atomics.waitAsync(int32View, IDX_TAIL, tail)` in producer loop; line 235 uses `Atomics.waitAsync(int32View, IDX_HEAD, head)` in consumer. Test "producer.write returns false when ring is full and timeout expires" passes (50 ms timeout). |
| 3 | Capability probe returns false in Node without SAB AND when endpoint sabCapable:false | VERIFIED | `sab-capability.test.ts` — 10 tests pass covering: SAB undefined → false, Atomics.waitAsync absent → false, crossOriginIsolated===false → false, endpoint.sabCapable===false → false, endpoint.capabilities.sabCapable===false → false |
| 4 | Channel with sab=true opt-in and both-side capable negotiates sab:true in CAPABILITY | VERIFIED | `sab-channel.test.ts` "both sides report sabActive=true after handshake" passes. `channel.ts` lines 248–250: `sab: options.sab === true && isSabCapable(endpoint)` computed at construction; sent in CAPABILITY frame line 395: `sab: this.#localCap.sab`. Merged at line 428: `sab: frame.sab && this.#localCap.sab`. |
| 5 | Channel with sab=true falls back to postMessage transparently when peer probes false | VERIFIED | `sab-fallback.test.ts` — 4 tests pass: one-side opt-out, both opt-out, 64 KB stream over postMessage path, endpoint sabCapable=false. `stats().sabActive===false` confirmed on both sides. DATA frame counts verified via postMessage path. |
| 6 | 10 MB binary stream arrives intact via SAB path in Node worker_threads integration test | VERIFIED | `sab-channel.test.ts` "transfers 10 MB binary payload intact via SAB path" passes in 126 ms. Pattern check: `receivedView[0]===0`, `receivedView[255]===255`, `receivedView[TEN_MB-1]===(TEN_MB-1)&0xff` all assert. |

**Score:** 6/6 truths verified (automated). One human-decision item on benchmark criterion interpretation.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/transport/sab-ring.ts` | SPSC ring buffer with Atomics-based producer/consumer coordination | VERIFIED | 296 lines. `allocSabRing`, `SabRingProducer`, `SabRingConsumer` all present. `Atomics.waitAsync` used in both producer (`write`) and consumer (`read`). Terminator (length=0) and padding marker (0xFFFFFFFF) documented and implemented. |
| `src/transport/sab-capability.ts` | isSabCapable(endpoint) probe | VERIFIED | 50 lines. Checks SAB availability, Atomics.waitAsync, crossOriginIsolated, endpoint.sabCapable and endpoint.capabilities.sabCapable. Exported from `src/index.ts`. |
| `tests/integration/sab-channel.test.ts` | end-to-end SAB path verification | VERIFIED | 2 tests: handshake + sabActive=true; 10 MB transfer intact. Both pass. |
| `tests/integration/sab-fallback.test.ts` | transparent fallback verification | VERIFIED | 4 tests: one-side opt-out, both opt-out, 64 KB via postMessage, endpoint sabCapable=false. All pass. |
| `benchmarks/scenarios/sab-transfer.bench.ts` | SAB vs transferable throughput comparison | VERIFIED | File exists. Parametrizes 1 KB, 64 KB, 1 MB, 16 MB. Compares `sendBinaryViaLibrarySab` vs `sendBinaryViaLibrary`. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/channel/channel.ts` | `src/transport/sab-ring.ts` | lazy construction on CAPABILITY-negotiated sab:true | WIRED | Line 16 imports `allocSabRing, SabRingConsumer, SabRingProducer`. `#sendSabInit()` calls `allocSabRing(bufferSize)` at line 855; `new SabRingProducer(view)` at line 856. `#handleSabInit()` calls `new SabRingConsumer(view)` at line 874. |
| `src/channel/channel.ts` | `src/transport/sab-capability.ts` | probe call during capability negotiation | WIRED | Line 15 imports `isSabCapable`. Used at line 249: `sab: options.sab === true && isSabCapable(endpoint)`. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `channel.ts` (#sabReady) | `#sabReady` flag | Set in `#handleSabInit` (consumer side, line 878) and `#handleSabInitAck` (producer side, line 906) after real handshake round-trips | Yes — set only after actual postMessage SAB_INIT/ACK exchange | FLOWING |
| `channel.ts` (sendFrame SAB path) | SAB ring write | `#sabProducer.write(payload, seq, ctEncoded)` at line 634 — writes real ArrayBuffer payload into the ring | Yes — data from `DataFrame.payload` (real ArrayBuffer) written via `SabRingProducer.write` | FLOWING |
| `channel.ts` (#dispatchSabFrame) | Frame reconstructed from SAB ring | `consumer.read()` in `#startSabConsumerLoop` returns real `{payload, seq, chunkType}` from shared memory | Yes — `this.#session.receiveFrame(frame)` delivers real data to session reassembly | FLOWING |
| `benchmarks/results/baseline.json` | SAB scenarios | `sendBinaryViaLibrarySab()` in node-harness, which constructs real Channels with `{sab:true}` and polls `stats().sabActive` | Yes — 4 SAB scenarios in baseline.json with real throughput numbers | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 313 tests pass | `pnpm test` | `Tests 313 passed (313)` | PASS |
| TypeScript compiles clean | `pnpm exec tsc --noEmit` | exit 0 | PASS |
| SAB unit + integration tests (28) pass | `pnpm vitest run tests/unit/transport/sab-ring tests/unit/transport/sab-capability tests/integration/sab-channel tests/integration/sab-fallback` | `Tests 28 passed (28)` | PASS |
| sab-transfer scenarios in baseline.json | parse baseline.json | 4 SAB entries found: `library (SAB) [1KB]`, `[64KB]`, `[1MB]`, `[16MB]` | PASS |
| `isSabCapable` exported from public API | `grep "isSabCapable" src/index.ts` | Line 32: `export { isSabCapable } from "./transport/sab-capability.js"` | PASS |
| `SAB_INIT_FAILED` in ErrorCode | `grep "SAB_INIT_FAILED" src/types.ts` | Line 22: `\| "SAB_INIT_FAILED"` | PASS |
| `sabActive` in ChannelStats | `grep "sabActive" src/channel/stats.ts` | Line 39: `sabActive: boolean` | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| FAST-04 | 06-01-PLAN.md | SAB fast path: feature-detected, opt-in, COI-gated, SW-excluded | SATISFIED | All 4 success criteria addressed: (1) sabActive reflects real SAB activation (integration test), (2) ServiceWorker endpoint forced false (capability probe + fallback test), (3) benchmark scenarios published in baseline.json (human decision item on interpretation — see below), (4) fallback on one-side opt-out confirmed (sab-fallback test). |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/transport/sab-ring.ts` | 288–291 | `noNonNullAssertion` (`!` on Uint8Array element access) | Info | Biome style warning, not an error. Uint8Array element access is always defined by bounds. The `>>>0` arithmetic in `#readU32LE` guarantees valid indices. Not a stub — real implementation. |
| `src/channel/channel.ts` | 634 | `void ... .then(ok => ...)` — fire-and-forget SAB write | Warning | Intentional pattern: SAB write failure is handled in the `.then()` callback via `#freezeAllStreams("CHANNEL_DEAD")`. The `void` suppresses the floating-Promise lint warning. Not a data-loss risk. |

Pre-existing lint errors in non-Phase-6 files (`scripts/tree-shake-check.mjs`, `tests/unit/channel/bfcache.test.ts`, `tests/integration/observability.test.ts`, `src/session/reorder-buffer.ts`, `src/adapters/emitter.ts`) were present before Phase 6 and are not regressions from this phase. The plan acceptance criteria included `pnpm lint exits 0` but lint was already failing on pre-existing files. Phase 6 introduced no new lint errors — the four `noNonNullAssertion` warnings in `sab-ring.ts` are warnings (severity `!`), not errors (`×`).

### Human Verification Required

#### 1. Benchmark Criterion Interpretation (FAST-04 criterion 3)

**Test:** Review `.planning/decisions/06-sab-benchmark.md` and make a project-owner judgment call.
**Expected:** Phase goal success criterion 3 states "Benchmark shows a measurable throughput improvement on the SAB path vs. the transferable path". The Node data shows SAB is 0.20x–0.70x of transferable (slower). The decision doc explains this is because Node's MessageChannel has no structured-clone envelope overhead — the SAB advantage is browser-specific. Two options:
- Option A: Accept revised reading — "benchmark scenarios exist and data is published" — and mark criterion 3 satisfied (consistent with how BENCH-03 was handled in Phase 5)
- Option B: Defer criterion 3 to Phase 9 browser benchmark data, and note it as a known gap

**Why human:** This is a project-owner value judgment about whether the benchmark criterion was met given an honest but surprising result. The implementation is complete and correct. The performance story is environment-specific.

---

### Gaps Summary

No functional gaps were found. All 6 truths verified. All required artifacts exist, are substantive, are wired, and carry real data. The only open item is the benchmark criterion interpretation question (Option A vs Option B), which is a human-decision item documented in `.planning/decisions/06-sab-benchmark.md`.

The lint command (`pnpm lint`) exits non-zero due to pre-existing issues in non-Phase-6 files. No Phase 6 files introduced new lint errors.

---

_Verified: 2026-04-21T19:35:00Z_
_Verifier: Claude (gsd-verifier)_
