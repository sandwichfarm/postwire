---
phase: 07-multi-hop-relay
verified: 2026-04-21T20:00:00Z
status: passed
score: 4/4 must-haves verified
---

# Phase 7 — Verification

**Goal:** A relay context can forward a stream between two endpoints with end-to-end backpressure, bounded memory, and bidirectional error propagation — without reassembling payloads.

## Automated gate

- `pnpm lint` — exit 0 (All good!)
- `pnpm test` — 332/332 passing (313 pre-existing + 19 new from Phase 7)
- `pnpm exec tsc --noEmit` — exit 0
- `pnpm bench` — existing baseline intact; no new bench scenarios added (relay bench deferred to Phase 9)

## Success criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `createRelayBridge` forwards DATA without reassembly; relay heap bounded | ✓ PASSED | tests/integration/relay-backpressure.test.ts — heap delta **8.76 MB** under 3s fast-producer / 1-chunk/sec consumer (target < 15 MB, threshold 20 MB) |
| 2 | 10× speed mismatch pauses producer, not relay buffer | ✓ PASSED | Same test — producer credit window drains; relay heap stays bounded; no unbounded growth observed |
| 3 | CANCEL → RESET within 100 ms | ✓ PASSED | tests/integration/relay-cancel.test.ts — measured latency **0.32 ms** (300× better than target) |
| 4 | Stream identity preserved via translation table | ✓ PASSED | tests/integration/relay-bridge.test.ts — 10 MB binary round-trips with bytes intact across two MessageChannel pairs + relay |

## Requirement coverage

- **TOPO-02**: Relay helper routes without reassembling. ✓
- **TOPO-03**: Credits propagate end-to-end; relay memory bounded. ✓
- **TOPO-04**: Stream identity preserved via routing table with upstreamToDown / downToUpstream maps. ✓

## Bugs caught and fixed during execution

1. `isFinal=true` handling: incorrectly deleted stream mapping on every chunk with isFinal; fixed to only treat isFinal as "last chunk of a payload" not "end of stream"
2. ArrayBuffer transfer: relay's `sendRawFrame` was transferring payloads, detaching them before the upstream Session could reassemble; fix removed transfer list from relay path (relay passes references, doesn't claim ownership)

## Notes

- Three integration tests + 7 unit raw-frame hook tests + 9 unit RelayBridge tests = 19 new tests
- Zero regressions on existing 313 tests
- Real-browser three-hop topology (worker → main-thread relay → sandboxed iframe) deferred to Phase 9

**Verdict:** passed. Phase 7 goal achieved.
