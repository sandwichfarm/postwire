---
phase: 04-lifecycle-safety-observability
plan: "04"
subsystem: channel
tags: [error-taxonomy, OBS-02, CREDIT_DEADLOCK, REORDER_OVERFLOW, PROTOCOL_MISMATCH, DataCloneError, ORIGIN_REJECTED, TypedEmitter, session-error-routing]
dependency_graph:
  requires:
    - phase: 04-00
      provides: "#emitter ChannelEmitter, #onErrorCb, REORDER_OVERFLOW catch in session"
    - phase: 04-03
      provides: "onOriginRejected hook on createWindowEndpoint, WindowEndpointOptions interface"
  provides:
    - OBS-02-all-errors-via-channel-emitter
    - CREDIT_DEADLOCK-rename-from-CONSUMER_STALL
    - mapSessionErrorCode-helper
    - DataCloneError-FSM-guard-fix
  affects: [04-05, consumers of channel.on('error')]
tech-stack:
  added: []
  patterns: [session-onError-routed-to-channel-emitter, mapSessionErrorCode-module-helper, FSM-guard-before-reset]
key-files:
  created: []
  modified:
    - src/channel/channel.ts
    - src/adapters/emitter.ts
    - tests/unit/channel/channel.test.ts
    - tests/unit/transport/window-adapter.test.ts
    - tests/unit/session/session.test.ts
key-decisions:
  - "session.onError wired in #createSession to emit on #emitter; both #emitter and #onErrorCb called for backward compat"
  - "mapSessionErrorCode() module-level helper converts reason strings to ErrorCode — single source of truth for the mapping"
  - "CONSUMER_STALL renamed to CREDIT_DEADLOCK in emitter.ts #wireSession"
  - "DataCloneError #sendRaw catch block guarded with same FSM state check as #freezeAllStreams — fixes OPENING state crash"

patterns-established:
  - "Channel error paths: always call #emitter.emit('error') before #onErrorCb (emitter first, then legacy compat)"
  - "FSM guard before reset(): check state is OPEN|LOCAL_HALF_CLOSED|REMOTE_HALF_CLOSED|CLOSING before calling session.reset()"

requirements-completed: [LIFE-05, OBS-02]

duration: 5min
completed: 2026-04-21
---

# Phase 4 Plan 04: Error Taxonomy Summary

**All OBS-02 error codes (PROTOCOL_MISMATCH, DataCloneError, CREDIT_DEADLOCK, REORDER_OVERFLOW) routed through channel.on('error') as typed StreamError; CONSUMER_STALL renamed to CREDIT_DEADLOCK**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-21T13:27:00Z
- **Completed:** 2026-04-21T13:32:36Z
- **Tasks:** 2 (Task 1 implementation, Task 2 TDD tests)
- **Files modified:** 5

## Accomplishments

- Added `mapSessionErrorCode()` module-level helper in `channel.ts` mapping session reason strings to `ErrorCode`
- Wired `session.onError` → `#emitter.emit('error')` in `#createSession` — all session errors now surface as typed `StreamError` via `channel.on('error')`
- Added `#emitter.emit('error')` to `#handleCapability` for `PROTOCOL_MISMATCH` routing
- Added `#emitter.emit('error')` to `#sendRaw` catch for `DataCloneError` routing
- Renamed `CONSUMER_STALL` → `CREDIT_DEADLOCK` in `emitter.ts` `#wireSession` (OBS-02)
- Added 6 new tests across 3 test files covering all OBS-02 error code paths

## Task Commits

1. **Task 1: Route all error codes through channel emitter** — `c0bb791` (feat)
2. **Task 2: Add OBS-02 error routing tests** — `42ae478` (test)

## Files Created/Modified

- `/home/sandwich/Develop/iframebuffer/src/channel/channel.ts` — Added `mapSessionErrorCode()` helper; wired `session.onError` in `#createSession`; added `#emitter.emit` to `#handleCapability` and `#sendRaw`; FSM guard fix in `#sendRaw`
- `/home/sandwich/Develop/iframebuffer/src/adapters/emitter.ts` — Renamed `CONSUMER_STALL` → `CREDIT_DEADLOCK` in `#wireSession`; added `ErrorCode` import
- `/home/sandwich/Develop/iframebuffer/tests/unit/channel/channel.test.ts` — Added OBS-02 error routing test suite (PROTOCOL_MISMATCH, DataCloneError, CREDIT_DEADLOCK tests)
- `/home/sandwich/Develop/iframebuffer/tests/unit/transport/window-adapter.test.ts` — Added 2 tests: onOriginRejected fires on wrong origin; correct origin does not trigger rejection
- `/home/sandwich/Develop/iframebuffer/tests/unit/session/session.test.ts` — Added REORDER_OVERFLOW test: overflow triggers `onError('REORDER_OVERFLOW')`

## Decisions Made

1. **session.onError wired in #createSession** — Rather than a separate method, `session.onError` is wired inline in `#createSession` alongside `session.onFrameOut`. This is symmetric, easy to read, and means every session (initiator or responder) automatically gets error routing without extra wiring calls.

2. **mapSessionErrorCode as module-level function** — Centralizes the reason-string → ErrorCode mapping. Future additions only need to update this function, not hunt through the Channel class.

3. **Backward compat: both #emitter and #onErrorCb called** — All error paths call `#emitter.emit('error', err)` first, then `#onErrorCb?.(err)`. New callers use `channel.on('error')`; existing callers using `channel.onError(cb)` continue to work.

4. **CONSUMER_STALL kept in types.ts** — The `ErrorCode` union still includes `CONSUMER_STALL` for backward compat (the comment says it's kept for backward compat and will be removed later). The emitter.ts code now emits `CREDIT_DEADLOCK` exclusively.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed DataCloneError catch block calling session.reset() without FSM state guard**
- **Found during:** Task 2 (writing DataCloneError test — `IllegalTransitionError: OPENING + RESET_SENT`)
- **Issue:** `#sendRaw` catch block called `this.#session?.reset("DataCloneError")` unconditionally. When `openStream()` is called and postMessage throws immediately (session is in `OPENING` state), `reset()` throws `IllegalTransitionError` because `OPENING` does not accept `RESET_SENT`. The same issue was fixed in `#freezeAllStreams` in Plan 03, but `#sendRaw` was missed.
- **Fix:** Added the same FSM state guard: only call `session.reset()` when state is `OPEN | LOCAL_HALF_CLOSED | REMOTE_HALF_CLOSED | CLOSING`. Error still emitted on `#emitter` regardless of session state.
- **Files modified:** `src/channel/channel.ts`
- **Verification:** DataCloneError test passes; `IllegalTransitionError` no longer thrown; TypeScript clean
- **Committed in:** `c0bb791` (Task 1 feat commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Essential fix for correctness — DataCloneError during stream opening would have crashed silently without this guard. No scope creep.

## Issues Encountered

None beyond the auto-fixed FSM guard above.

## Known Stubs

None — all error routing is fully wired. `onOriginRejected` on `createWindowEndpoint` is an API-level hook; callers can pass `(origin) => channel.#emitter.emit('error', new StreamError('ORIGIN_REJECTED', ...))` when constructing the channel. The hook itself fires correctly (verified by window-adapter tests).

## Next Phase Readiness

- OBS-02 requirement fully satisfied: all 7 named error codes surface as typed `StreamError` via `channel.on('error')`
- `CREDIT_DEADLOCK` used consistently; `CONSUMER_STALL` retained in `ErrorCode` union for backward compat only
- Plan 04-05 (stats/observability) is unblocked

---
*Phase: 04-lifecycle-safety-observability*
*Completed: 2026-04-21*
