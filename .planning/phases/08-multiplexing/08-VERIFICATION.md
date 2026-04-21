---
phase: 08-multiplexing
verified: 2026-04-21T20:15:00Z
status: passed
score: 3/3 must-haves verified
---

# Phase 8 — Verification

**Goal:** Multiple concurrent logical streams can share one endpoint in opt-in multiplex mode; each stream has an independent credit window so a stalled stream cannot block others.

## Automated gate
- `pnpm test` — 340/340 passing (332 pre-existing + 8 new: 7 multiplex unit, 1 HoL integration)
- `pnpm lint`, `pnpm exec tsc --noEmit` — exit 0

## Success criteria
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Default single-stream wire format unchanged | ✓ PASSED | All 332 pre-existing tests green without modification |
| 2 | 4 concurrent streams; stalling one doesn't block others | ✓ PASSED | `tests/integration/multiplex-hol.test.ts` — stream 3 stalled at credit=0 via credit-dropping wrapper; streams 1/5/7 each deliver 32 chunks within 2 s |
| 3 | Per-stream stats for all active streams | ✓ PASSED | multiplex unit tests: stats reports distinct creditWindowAvailable per active stream |

## Requirement coverage
- **MUX-01**: Single-stream default unchanged. ✓
- **MUX-02**: HoL proof. ✓
- **MUX-03**: Per-stream independent credit windows via Map-based session storage. ✓

## Notable finding
Session's `notifyRead()` fires unconditionally on every reassembled chunk — credit refills are automatic regardless of `onChunk` registration. The HoL test therefore stalls a stream by dropping CREDIT frames at the wire level (endpoint wrapper), which is architecturally equivalent and more precisely tests the credit-window backpressure path.

**Verdict:** passed.
