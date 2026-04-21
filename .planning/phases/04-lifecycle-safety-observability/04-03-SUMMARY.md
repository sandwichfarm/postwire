---
phase: 04-lifecycle-safety-observability
plan: "03"
subsystem: channel
tags: [lifecycle, teardown, CHANNEL_CLOSED, LIFE-03, LIFE-04, LIFE-05, OBS-02, onOriginRejected, disposers, MessagePort]
dependency_graph:
  requires:
    - phase: 04-00
      provides: "#disposers array, #freezeAllStreams, ChannelEmitter skeleton, REORDER_OVERFLOW catch, test scaffolds"
    - phase: 04-01
      provides: "BFCache pagehide/pageshow listeners, endpointKind option"
    - phase: 04-02
      provides: "SW heartbeat LIFE-02, #startHeartbeat with disposers"
  provides:
    - LIFE-03-teardown-detection
    - LIFE-04-strong-ref-confirmed
    - LIFE-05-onmessage-null-on-close
    - OBS-02-onOriginRejected-hook
    - hasActiveSession-getter
    - WindowEndpointOptions-interface
  affects: [04-04, 04-05, src/channel/channel.ts, src/transport/adapters/window.ts]
tech-stack:
  added: []
  patterns: [disposers-array-onmessage-null, endpoint-close-event-guard, isTerminalState-extended-guard]
key-files:
  created: []
  modified:
    - src/channel/channel.ts
    - src/transport/adapters/window.ts
    - tests/integration/lifecycle-teardown.test.ts
key-decisions:
  - "endpoint.onmessage = null added to #disposers in constructor — LIFE-05 cleanup on close"
  - "Endpoint 'close' listener added defensively via typeof addEventListener check — fires in Node for MessagePort; safe no-op in browser where event may not exist"
  - "#freezeAllStreams guard extended: only call session.reset() from OPEN/LOCAL_HALF_CLOSED/REMOTE_HALF_CLOSED/CLOSING states — IDLE and OPENING do not accept RESET_SENT in the FSM"
  - "WindowEndpointOptions interface exported from window.ts with optional onOriginRejected callback — adapter stays unaware of Channel"
  - "hasActiveSession getter exposes #session !== null for integration test assertions"

patterns-established:
  - "Endpoint teardown: always guard session.reset() with explicit FSM-valid state check, not just isTerminalState()"
  - "Listener cleanup: push endpoint.onmessage = null into #disposers alongside removeEventListener calls"

requirements-completed: [LIFE-03, LIFE-04, LIFE-05]

duration: 3min
completed: 2026-04-21
---

# Phase 4 Plan 03: Endpoint Teardown Detection Summary

**MessagePort 'close' event wired to CHANNEL_CLOSED via disposers; LIFE-05 onmessage cleanup; WindowEndpointOptions.onOriginRejected hook for OBS-02**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-21T13:22:22Z
- **Completed:** 2026-04-21T13:24:41Z
- **Tasks:** 2 (Task 1 TDD, Task 2 covered by TDD cycle)
- **Files modified:** 3

## Accomplishments

- Wired `'close'` event listener on endpoint in `Channel` constructor; fires `#freezeAllStreams('CHANNEL_CLOSED')` (LIFE-03)
- Pushed `endpoint.onmessage = null` into `#disposers` so listener is removed when `channel.close()` runs (LIFE-05)
- Fixed `#freezeAllStreams` FSM guard: `session.reset()` only called from FSM states that accept `RESET_SENT` (`OPEN`, `LOCAL_HALF_CLOSED`, `REMOTE_HALF_CLOSED`, `CLOSING`)
- Added `hasActiveSession` getter for test assertions (session null-check)
- Exported `WindowEndpointOptions` interface with `onOriginRejected?: (origin: string) => void` from `window.ts` (OBS-02)
- Replaced 3 `it.todo` stubs with real integration tests — all pass

## Task Commits

1. **Task 1: Wire teardown detection + window adapter + integration tests** — `6085de2` (feat)

## Files Created/Modified

- `/home/sandwich/Develop/iframebuffer/src/channel/channel.ts` — Added `'close'` listener on endpoint; `onmessage=null` disposer; `hasActiveSession` getter; fixed `#freezeAllStreams` FSM state guard
- `/home/sandwich/Develop/iframebuffer/src/transport/adapters/window.ts` — Added `WindowEndpointOptions` interface; `onOriginRejected` callback option; updated function signature to accept third `opts` parameter
- `/home/sandwich/Develop/iframebuffer/tests/integration/lifecycle-teardown.test.ts` — Implemented 3 real integration tests replacing `it.todo` stubs

## Decisions Made

1. **onmessage = null in disposers** — The Channel sets `endpoint.onmessage` in the constructor; the matching cleanup is `endpoint.onmessage = null` pushed into `#disposers`. This is symmetric with the `removeEventListener` pattern and ensures the listener is always removed when disposers flush.

2. **Defensive addEventListener guard** — `typeof (endpoint as EventTarget).addEventListener === 'function'` check ensures the teardown listener is only added when the endpoint supports it. Node MessagePort does; plain `{ postMessage, onmessage }` objects don't. No failure mode, just a safe no-op when unsupported.

3. **Explicit FSM-valid state check in #freezeAllStreams** — `isTerminalState()` only covers `CLOSED/ERRORED/CANCELLED`. The FSM shows `OPENING` and `IDLE` also reject `RESET_SENT`. Extended the guard to explicitly enumerate the four states that DO accept `RESET_SENT`.

4. **onOriginRejected on adapter, not Channel** — `createWindowEndpoint` accepts the callback but does NOT import `StreamError` or `Channel`. The caller wires the callback to emit on the channel emitter. This keeps the adapter layer boundary clean.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed #freezeAllStreams guard for OPENING state**
- **Found during:** Task 1 (GREEN phase) — `IllegalTransitionError: OPENING + RESET_SENT`
- **Issue:** The existing `isTerminalState` guard covered `CLOSED/ERRORED/CANCELLED` but not `OPENING` or `IDLE`, which also reject `RESET_SENT` in the FSM transition table. When `openStream()` is called and the remote port closes before `OPEN_ACK` arrives, the session is in `OPENING` state and `reset()` throws.
- **Fix:** Replaced `!isTerminalState(session.state)` with explicit enumeration of the four FSM states that accept `RESET_SENT`: `OPEN | LOCAL_HALF_CLOSED | REMOTE_HALF_CLOSED | CLOSING`
- **Files modified:** `src/channel/channel.ts`
- **Verification:** All 3 integration tests pass; `IllegalTransitionError` no longer thrown
- **Committed in:** `6085de2` (task commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Fix was essential for correctness — the OPENING-state guard was always broken, just not exercised until this test. No scope creep.

## Issues Encountered

None beyond the auto-fixed FSM guard issue above.

## Known Stubs

None — all 3 integration tests are fully implemented and passing. The `onOriginRejected` callback on `createWindowEndpoint` is wired at the API surface; Plan 04-04 (OBS-02) will add the Channel-side wiring that passes this callback and re-emits as `StreamError('ORIGIN_REJECTED')`.

## Next Phase Readiness

- LIFE-03, LIFE-04, LIFE-05 requirements complete
- `onOriginRejected` hook available on `createWindowEndpoint` — ready for OBS-02 wiring in Plan 04-04
- Plan 04-04 (OBS-02 error taxonomy wiring) is unblocked

---
*Phase: 04-lifecycle-safety-observability*
*Completed: 2026-04-21*
