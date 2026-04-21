---
phase: 03-api-adapters-single-hop-integration
plan: "01"
subsystem: channel
tags: [channel, capability-handshake, stream-error, typescript, tdd]

# Dependency graph
requires:
  - phase: 03-api-adapters-single-hop-integration
    plan: "00"
    provides: >
      MockEndpoint helper, directory scaffold, Session.close(finalSeq?) patch,
      vitest.config.ts extended for integration tests

provides:
  - src/types.ts — StreamError class with ErrorCode discriminant (7 variants)
  - src/channel/channel.ts — Channel class, createChannel factory, CAPABILITY handshake
  - tests/unit/channel/channel.test.ts — 8 unit tests for CAPABILITY handshake

affects:
  - 03-02-lowlevel
  - 03-03-emitter
  - 03-04-streams
  - 03-05-mock-endpoint-tests

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Channel owns endpoint with strong ref (prevents GC per LIFE-04)"
    - "CAPABILITY promise swallows unhandled rejection; caller receives error via onError callback"
    - "Responder path: OPEN frame creates session on-demand and fires onStream callback"
    - "DataCloneError caught from postMessage — both DOMException and Node Error shapes"
    - "lastDataSeqOut tracked in sendFrame() for CLOSE finalSeq correctness (Pitfall 6)"

key-files:
  created:
    - src/types.ts
    - src/channel/channel.ts
    - tests/unit/channel/channel.test.ts
  modified: []

key-decisions:
  - "onStream responder path wired in constructor message handler — OPEN frame creates responder session inline rather than deferring to Phase 8 mux"
  - "Biome noUnusedPrivateClassMembers — #onStreamCb made live by wiring responder OPEN handling in inbound message handler"
  - "StreamError constructor takes (code, cause) to allow wrapping native DataCloneError as .cause"

requirements-completed: [TOPO-01, FAST-02]

# Metrics
duration: 3min
completed: 2026-04-21
---

# Phase 03 Plan 01: Channel + StreamError Summary

**Channel class with CAPABILITY handshake, frame routing, encode/decode wiring; StreamError typed error class**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-21T12:16:31Z
- **Completed:** 2026-04-21T12:19:40Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Created `src/types.ts` with `StreamError` class — typed error with `.code: ErrorCode` discriminant covering 7 variants (4 Phase 3 + 3 Phase 4 shape stubs)
- Created `src/channel/channel.ts` with `Channel` class and `createChannel` factory:
  - Sends CAPABILITY frame on construction (sab:false, transferableStreams:false in Phase 3)
  - `#capabilityReady` Promise resolves on matching remote version, rejects with `StreamError{code:'PROTOCOL_MISMATCH'}` on version mismatch
  - Responder path: OPEN frame arriving with no active session creates responder session and fires `onStream` callback
  - DataCloneError from `postMessage` caught and routed to `StreamError` via `onError` callback
  - `lastDataSeqOut` tracks DATA seqNums for correct `finalSeq` in CLOSE frame (RESEARCH.md Pitfall 6)
  - Strong endpoint reference prevents GC (LIFE-04)
- 8/8 unit tests passing; full 206-test suite passing

## Task Commits

Each task was committed atomically:

1. **Task 1: StreamError class** — `46ebf35` (feat)
2. **Task 2 RED: Failing channel unit tests** — `3df6a4f` (test)
3. **Task 2 GREEN: Channel implementation** — `09d2ba9` (feat)

## Files Created/Modified

- `src/types.ts` — StreamError class, ErrorCode union type
- `src/channel/channel.ts` — Channel class, createChannel factory, CAPABILITY handshake
- `tests/unit/channel/channel.test.ts` — 8 unit tests covering CAPABILITY handshake, negotiation, and error routing

## Decisions Made

- **Responder path wired now**: When an OPEN frame arrives with no active session, the Channel creates a responder session inline and fires `onStream`. This is correct Phase 3 behavior (single-stream single-hop) and satisfies Biome's `noUnusedPrivateClassMembers` lint rule without a suppress comment.
- **StreamError constructor shape**: `(code: ErrorCode, cause: unknown)` allows wrapping the native `DataCloneError` as `.cause` for programmatic inspection; matches RESEARCH.md's documented pattern.
- **#capabilityReady unhandled rejection**: The promise immediately attaches a no-op `.catch` in the constructor so it never surfaces as an unhandled rejection; callers receive the error via the `onError` callback instead.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Wired responder OPEN path in inbound handler**
- **Found during:** Task 2 GREEN (Biome `noUnusedPrivateClassMembers` lint error)
- **Issue:** `#onStreamCb` was declared and set in `onStream()` but never read — Biome flagged it as unused private class member
- **Fix:** Added responder path in the inbound message handler: when `frame.type === "OPEN"` arrives with no active session, create a responder `Session` and call `#onStreamCb`. This is correctness-required for the responder role to work at all.
- **Files modified:** `src/channel/channel.ts`
- **Commit:** `09d2ba9`

## Known Stubs

None — all exported functionality is fully wired. The Phase 4 `ErrorCode` variants (`CHANNEL_FROZEN`, `CHANNEL_DEAD`, `CHANNEL_CLOSED`) are declared in the type union but not yet surfaced by any code path — this is intentional and documented in the type comment.

## Self-Check: PASSED

- FOUND: src/types.ts
- FOUND: src/channel/channel.ts
- FOUND: tests/unit/channel/channel.test.ts
- FOUND: .planning/phases/03-api-adapters-single-hop-integration/03-01-SUMMARY.md
- FOUND: commit 46ebf35 (StreamError)
- FOUND: commit 3df6a4f (RED tests)
- FOUND: commit 09d2ba9 (Channel GREEN implementation)

---
*Phase: 03-api-adapters-single-hop-integration*
*Completed: 2026-04-21*
