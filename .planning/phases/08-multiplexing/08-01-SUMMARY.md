---
phase: 08-multiplexing
plan: "01"
subsystem: channel
tags: [multiplex, streams, credit-window, hol-blocking, postmessage]

requires:
  - phase: 07-relay-bridge
    provides: RelayBridge, raw-frame hooks, relay integration tests

provides:
  - "Channel.#sessions Map<number, Session> replacing single #session field"
  - "multiplex option in ChannelOptions — both sides must opt-in for activation"
  - "Stream ID allocator: odd IDs for initiator role, even for responder role"
  - "CapabilityFrame.multiplex?: boolean field for negotiation"
  - "HoL-blocking proof: 4 concurrent streams, one stalled, others deliver 32 chunks in 2s"
  - "Per-stream stats via channel.stats().streams[] in both single-stream and multiplex modes"

affects:
  - 09-api-adapters-multiplex
  - phase-benchmarks-multiplex
  - relay-multiplex-compose

tech-stack:
  added: []
  patterns:
    - "Map<streamId, Session> for multi-stream channel hosting"
    - "Odd/even stream ID partitioning to avoid collision without extra handshake (mirrors HTTP/2)"
    - "Credit-dropping endpoint wrapper for deterministic stall testing"
    - "CAPABILITY frame carries feature flags negotiated as logical AND of both sides"

key-files:
  created:
    - tests/unit/channel/multiplex.test.ts
    - tests/integration/multiplex-hol.test.ts
  modified:
    - src/channel/channel.ts
    - src/framing/types.ts

key-decisions:
  - "Map<number, Session> replaces Session|null — single-stream default unchanged; at most one entry in non-multiplex mode"
  - "Multiplex activated only when both sides advertise multiplex:true in CAPABILITY — one-sided opt-in falls back to single-stream"
  - "Stream ID allocator follows HTTP/2 convention: initiator=odd (1,3,5...), responder=even (2,4,6...)"
  - "close() guards FSM state: OPEN/REMOTE_HALF_CLOSED get graceful CLOSE; IDLE/OPENING sessions abandoned (no outbound frame)"
  - "HoL stall proof via credit-dropping endpoint wrapper — drops CREDIT frames for the target streamId without modifying Session"
  - "lastDataSeqOut getter preserved for backward compat; internally reads from #lastDataSeqByStream map"

patterns-established:
  - "Pattern: Multiplex-safe resource iteration — always iterate #sessions.values() rather than holding a single session ref"
  - "Pattern: Credit-dropping endpoint wrapper for deterministic stall integration tests"

requirements-completed:
  - MUX-01
  - MUX-02
  - MUX-03

duration: 12min
completed: 2026-04-21
---

# Phase 8 Plan 01: Multiplexing Summary

**Channel refactored to Map<number, Session> with odd/even stream ID allocation; HoL-blocking proved via credit-dropping endpoint — stalled stream 3 (credit=0) cannot block streams 1, 5, 7 (each delivering 32 chunks in 2 s)**

## Performance

- **Duration:** 12 min
- **Started:** 2026-04-21T18:03:25Z
- **Completed:** 2026-04-21T18:15:02Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- `Channel.#sessions: Map<number, Session>` replaces `#session: Session | null`; all 332 pre-existing tests pass unchanged
- Multiplex capability negotiation: both sides advertise `multiplex: true` in CAPABILITY frame; merged via logical AND; `#multiplexActive` gates the new code paths
- Stream ID allocator: initiator allocates odd IDs (1, 3, 5, ...), responder allocates even IDs (2, 4, 6, ...) — HTTP/2 convention, no extra per-stream handshake needed
- HoL-blocking integration test: 4 concurrent streams; stream 3 stalled at `credit=0` (CREDIT frames dropped by endpoint wrapper) while streams 1, 5, 7 each deliver all 32 chunks within 2 seconds

## Measured Results (HoL test)

| Stream | StreamId | Chunks (of 32) | CreditAvailable |
|--------|----------|----------------|-----------------|
| Stream 0 | 1 | 32 ✓ | 228 |
| Stream 1 (stalled) | 3 | 4 (stalled) | 0 |
| Stream 2 | 5 | 32 ✓ | 228 |
| Stream 3 | 7 | 32 ✓ | 228 |

## Task Commits

1. **Task 1: Channel session storage Map + multiplex capability** - `d50c423` (feat)
2. **Task 2: HoL-blocking integration test** - `1936384` (feat)

**Plan metadata commit:** (included in final docs commit)

## Files Created/Modified

- `src/channel/channel.ts` — `#sessions Map`, `#nextStreamId`, `#multiplexActive`, `ChannelOptions.multiplex/role`, `CapabilityFrame.multiplex` negotiation, updated `openStream/close/stats/#freezeAllStreams/#sendRaw/#dispatchSabFrame`
- `src/framing/types.ts` — `CapabilityFrame.multiplex?: boolean` added
- `tests/unit/channel/multiplex.test.ts` — 7 unit tests covering negotiation, stream ID allocation, stats, single-stream guard
- `tests/integration/multiplex-hol.test.ts` — 1 HoL integration test with credit-dropping endpoint wrapper

## Decisions Made

- **Map over single session ref:** Required for multiplex; also cleaner for iteration in `close()` and `#freezeAllStreams()`.
- **HTTP/2 stream ID convention:** Odd/even partitioning avoids collision without a per-stream coordination round-trip.
- **`close()` FSM guard:** Session in OPENING/IDLE state cannot accept CLOSE_SENT (no OPEN_ACK yet); those sessions are silently abandoned rather than crashing.
- **Credit-dropping wrapper for HoL test:** Session's `notifyRead()` fires unconditionally after every reassembled chunk — there is no "consumer doesn't read" path that starves credits. Dropping CREDIT frames at the transport layer is the correct way to simulate credit exhaustion for testing.
- **`lastDataSeqOut` getter preserved:** Iterates `#lastDataSeqByStream.values()` and returns the last entry; backward-compatible for existing adapter code.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed close() crashing on OPENING-state sessions**
- **Found during:** Task 1 (multiplex unit tests)
- **Issue:** `close()` called `session.close(finalSeq)` which internally fires `CLOSE_SENT`. FSM rejects `CLOSE_SENT` from `OPENING` state with `IllegalTransitionError`.
- **Fix:** Added FSM state guard in `close()` — only call `session.close(finalSeq)` from `OPEN` or `REMOTE_HALF_CLOSED`; silently skip `IDLE`/`OPENING`/terminal states.
- **Files modified:** `src/channel/channel.ts`
- **Verification:** All multiplex unit tests pass; lifecycle teardown tests continue to pass.
- **Committed in:** d50c423 (Task 1 commit)

**2. [Rule 1 - Bug] HoL test redesigned around actual credit-flow behavior**
- **Found during:** Task 2 (HoL integration test)
- **Issue:** Plan assumed "consumer doesn't register onChunk → credits stall". Reality: `Session.receiveFrame()` calls `CreditWindow.notifyRead()` unconditionally after every reassembled chunk, regardless of whether `onChunk` is registered. Credits refill automatically.
- **Fix:** Used a credit-dropping endpoint wrapper (`createCreditDroppingPair()`) that intercepts the initiator's inbound `MessagePort` and drops `CREDIT` frames for the target `streamId`. This correctly simulates credit exhaustion without modifying library code.
- **Files modified:** `tests/integration/multiplex-hol.test.ts`
- **Verification:** Stalled stream delivers exactly `initialCredit=4` chunks; `creditWindowAvailable=0`; other streams deliver all 32 chunks; test passes deterministically.
- **Committed in:** 1936384 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 Rule 1 bugs)
**Impact on plan:** Both fixes required for correctness. The credit-flow fix revealed an important behavioral truth about the library: credit is protocol-automatic, not application-controlled. The HoL proof is still valid — stream independence is real.

## Issues Encountered

- `Session.notifyRead()` fires unconditionally — there is no application-level credit hold. Documented in the credit-dropping wrapper approach. Future "manual credit" mode (if needed for backpressure-aware adapters) would require a Session option to make `notifyRead()` application-driven.

## Known Stubs

None — no stub values, placeholders, or wired-but-empty data flows introduced in this plan.

## Next Phase Readiness

- Multiplex-capable `Channel` is ready for adapter-layer wiring (Phase 9)
- `channel.stats().streams` returns correct per-stream entries for multiplex channels
- HoL independence is tested and confirmed at the session/credit level
- SAB + multiplex remains deferred (single-stream SAB is sufficient for v1)

## Self-Check: PASSED

- src/channel/channel.ts: FOUND
- src/framing/types.ts: FOUND
- tests/unit/channel/multiplex.test.ts: FOUND
- tests/integration/multiplex-hol.test.ts: FOUND
- 08-01-SUMMARY.md: FOUND
- Commit d50c423: FOUND
- Commit 1936384: FOUND
- `#sessions` present in channel.ts: PASS
- `Map<number, Session>` present in channel.ts: PASS

---
*Phase: 08-multiplexing*
*Completed: 2026-04-21*
