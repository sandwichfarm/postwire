---
phase: 03-api-adapters-single-hop-integration
plan: "04"
subsystem: adapters
tags: [whatwg-streams, backpressure, credit-window, data-clone-error, typescript]

# Dependency graph
requires:
  - phase: 03-api-adapters-single-hop-integration
    plan: "01"
    provides: Channel class, StreamError, createChannel factory

provides:
  - src/adapters/streams.ts — createStream(channel, options?) → {readable: ReadableStream, writable: WritableStream}
  - tests/unit/adapters/streams.test.ts — 15 unit tests for ReadableStream and WritableStream basic behavior
  - tests/integration/streams-backpressure.test.ts — 4 integration tests: 16 MB pipe + credit exhaustion
  - tests/integration/data-clone-error.test.ts — 4 integration tests: DataCloneError surfacing (FAST-03)

affects:
  - src/index.ts (Phase 3 re-exports — separate plan)
  - 03-05-mock-endpoint-tests

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ReadableStream pull source HWM=0: credit window is sole backpressure gate (SESS-03)"
    - "WritableStream sink HWM=initialCredit: aligns WHATWG desiredSize with credit window depth"
    - "session.onChunk → pendingChunks buffer → pull resolver pattern (RESEARCH.md Pattern 3)"
    - "DataCloneError path: Channel.#sendRaw catches postMessage throw → session.reset → onError → controller.error"
    - "IllegalTransitionError guard: sink.write() catches FSM errors from the DataCloneError callback chain"

key-files:
  created:
    - src/adapters/streams.ts
    - tests/unit/adapters/streams.test.ts
    - tests/integration/streams-backpressure.test.ts
    - tests/integration/data-clone-error.test.ts
  modified:
    - src/adapters/streams.ts (DataCloneError fix — Task 4 deviation)

key-decisions:
  - "createStream always calls channel.openStream() (initiator role) — responder integration tests use chB.onStream() directly to avoid double-open"
  - "IllegalTransitionError guard added to sink.write(): DataCloneError causes session.reset() mid-sendData() chain leaving FSM in ERRORED state; subsequent DATA_SENT transition would throw — catch and surface as StreamError"
  - "streamError state variable bridges session.onError callback to WritableStream write() rejection — avoids race between async error propagation and synchronous Promise.resolve()"

requirements-completed: [API-03, FAST-03]

# Metrics
duration: 6min
completed: 2026-04-21
---

# Phase 03 Plan 04: WHATWG Streams Adapter Summary

**WHATWG Streams adapter (`createStream`) with full backpressure wiring via `desiredSize↔credit` and DataCloneError routing to typed `StreamError{code:'DataCloneError'}`**

## Performance

- **Duration:** 6 min
- **Started:** 2026-04-21T12:23:33Z
- **Completed:** 2026-04-21T12:29:42Z
- **Tasks:** 4
- **Files modified:** 4 created (+ 1 bug fix to streams.ts)

## Accomplishments

- Implemented `src/adapters/streams.ts` with `createStream(channel, options?)` returning `{ readable: ReadableStream, writable: WritableStream }`
- ReadableStream uses pull source with `highWaterMark: 0` — pull() is called only when consumer is actively waiting; session's `onChunk` fills a bounded `pendingChunks` buffer (bounded by credit window)
- WritableStream uses `highWaterMark: initialCredit` — aligns WHATWG Streams desiredSize signal with the credit window depth; `sink.write()` resolves after `session.sendData()` returns
- DataCloneError: `Channel.#sendRaw` catches synchronous throw from `postMessage`, calls `session.reset('DataCloneError')` → `session.onError('DataCloneError')` → adapter maps to `StreamError{code:'DataCloneError'}` → `readableController.error(err)` — never silent
- `cancel(reason)` → `session.cancel()`, `abort(reason)` → `session.reset()`, `close()` → `channel.close()`
- 15 unit tests + 8 integration tests all pass (260 total in suite)
- 16 MB pipe (16 × 1 MB ArrayBuffer chunks) completes successfully through real Node MessageChannel
- `pnpm exec tsc --noEmit` exits 0; biome check clean

## Task Commits

1. **Task 1: createStream implementation** — `62c7812` (feat)
2. **Task 2: Unit tests** — `b68d267` (test)
3. **Task 3: Backpressure integration tests** — `2d56da5` (test)
4. **Task 4: DataCloneError integration tests + bug fix** — `c2dc597` (test + fix)

## Files Created/Modified

- `src/adapters/streams.ts` — createStream() WHATWG Streams adapter with backpressure wiring
- `tests/unit/adapters/streams.test.ts` — 15 unit tests using stub Channel + real Session
- `tests/integration/streams-backpressure.test.ts` — 4 integration tests over real MessageChannel
- `tests/integration/data-clone-error.test.ts` — 4 integration tests proving FAST-03

## Decisions Made

- **`createStream` always uses initiator role:** Calls `channel.openStream()` on construction. Responder-side integration tests use `chB.onStream()` to receive the session and wire chunk handlers directly — cleaner than having a separate `createStreamResponder` function.
- **Two-queue backpressure design:** WHATWG Streams internal queue (depth = `highWaterMark: initialCredit`) + Session `#pendingSends`. These are coordinated: once `initialCredit` writes are queued, WHATWG desiredSize hits 0 and `writer.ready` pends; as CREDIT frames arrive, the session drains `#pendingSends` and WHATWG's queue empties, resolving `writer.ready`.
- **IllegalTransitionError guard in sink.write():** DataCloneError creates a re-entrancy issue: `session.reset('DataCloneError')` is called synchronously inside `session.sendData()` (via the `onFrameOut` → Channel → postMessage → catch → reset chain), setting session to ERRORED; then `#emitData()` tries `DATA_SENT` transition on ERRORED state, throwing `IllegalTransitionError`. The fix: wrap `session.sendData()` in try/catch and surface the pre-set `streamError` (already pointing to DataCloneError).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] IllegalTransitionError from DataCloneError re-entrancy**
- **Found during:** Task 4 — DataCloneError integration test "subsequent write() after DataCloneError rejects with StreamError" failed with `IllegalTransitionError` instead of `StreamError`
- **Issue:** `session.reset('DataCloneError')` is called synchronously inside `session.sendData()` via the `onFrameOut` callback chain. After `reset()`, the session FSM is in ERRORED state. But `#emitData()` (the caller of `onFrameOutCb`) then tries `#applyTransition({ type: 'DATA_SENT' })` on ERRORED state — illegal transition. This unhandled error propagated to `sink.write()`, putting the WritableStream itself into an errored state with the wrong error type.
- **Fix:** Wrapped `session.sendData()` in try/catch in `sink.write()`. On any caught error, surface `streamError` (already set by `session.onError` callback) or fallback to `StreamError{code:'CHANNEL_DEAD'}`.
- **Files modified:** `src/adapters/streams.ts`
- **Commit:** `c2dc597`

## Known Stubs

None — all exported functionality is fully wired. The `StreamsOptions.sessionOptions.hooks` slot is deferred to Phase 4 (comment left in interface).

## Self-Check: PASSED

- FOUND: src/adapters/streams.ts
- FOUND: tests/unit/adapters/streams.test.ts
- FOUND: tests/integration/streams-backpressure.test.ts
- FOUND: tests/integration/data-clone-error.test.ts
- FOUND: commit 62c7812 (streams adapter implementation)
- FOUND: commit b68d267 (unit tests)
- FOUND: commit 2d56da5 (backpressure integration tests)
- FOUND: commit c2dc597 (DataCloneError integration tests + fix)
- VERIFIED: 260 tests pass (pnpm exec vitest run --project=unit)
- VERIFIED: tsc --noEmit exits 0
- VERIFIED: biome check clean on src/adapters/streams.ts

---
*Phase: 03-api-adapters-single-hop-integration*
*Completed: 2026-04-21*
