---
phase: 03-api-adapters-single-hop-integration
plan: "03"
subsystem: api-adapters
tags: [eventemitter, typed-emitter, backpressure, drain-event, typescript, node-streams]

# Dependency graph
requires:
  - phase: 03-api-adapters-single-hop-integration
    plan: "01"
    provides: Channel class, StreamError, createChannel factory
  - phase: 03-api-adapters-single-hop-integration
    plan: "00"
    provides: MockEndpoint helper, Session.close(finalSeq?), vitest integration config

provides:
  - src/adapters/emitter.ts — createEmitterStream() + TypedEmitter + EmitterStream interface
  - tests/unit/adapters/emitter.test.ts — 10 unit tests for on/off/once/write/end/removeAllListeners
  - tests/integration/emitter-drain.test.ts — 3 integration tests for drain event + bidirectional data flow
  - Session.onCreditRefill() callback hook (added to src/session/index.ts)
  - Session.isCreditExhausted getter (added to src/session/index.ts)

affects:
  - 03-05-mock-endpoint-tests
  - 03-06-exports-treeshake
  - 03-04-streams (Session.onCreditRefill pattern available for streams adapter too)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TypedEmitter: plain Map<event, Set<handler>> — zero deps, browser-safe, ~40 LoC"
    - "EmitterOptions.role: 'initiator' | 'responder' — controls whether factory calls openStream() or onStream()"
    - "Backpressure tracking: backpressureActive flag toggled by write() + Session.onCreditRefill()"
    - "end() order: emit('end') → emit('close') → removeAllListeners() — allows both events to be observed"
    - "Pending writes queue: responder path buffers writes until OPEN frame arrives"

key-files:
  created:
    - src/adapters/emitter.ts
    - tests/unit/adapters/emitter.test.ts
    - tests/integration/emitter-drain.test.ts
  modified:
    - src/session/index.ts

key-decisions:
  - "EmitterOptions.role: 'initiator' | 'responder' avoids FSM conflict when both sides create streams simultaneously"
  - "end() order: emit('end') then emit('close') then removeAllListeners — both events observable before cleanup"
  - "Session.onCreditRefill() added to Session (not polling) — event-driven drain firing, no setTimeout loops"
  - "backpressureActive flag: drain fires only when transitioning from false-return write → credit refill"
  - "Responder path queues pre-session writes to handle writes before OPEN_ACK arrives"

patterns-established:
  - "Initiator/responder role pattern: one side calls openStream(), other uses onStream()"
  - "Session.onCreditRefill() hook pattern for drain-style events in adapter layer"

requirements-completed: [API-02]

# Metrics
duration: 7min
completed: 2026-04-21
---

# Phase 03 Plan 03: EventEmitter Adapter Summary

**Node-style EventEmitter adapter with in-module TypedEmitter (~40 LoC), drain event via Session.onCreditRefill(), and initiator/responder role option for two-party stream setup**

## Performance

- **Duration:** 7 min
- **Started:** 2026-04-21T12:22:38Z
- **Completed:** 2026-04-21T12:29:38Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Created `src/adapters/emitter.ts` with in-module `TypedEmitter` base class (~40 LoC, zero deps, browser-safe via `Map<event, Set<handler>>`) and `createEmitterStream()` factory
- `write()` returns boolean for backpressure signaling; `drain` event fires exactly when credit window refills after backpressure was active
- Added `Session.onCreditRefill()` and `Session.isCreditExhausted` to `src/session/index.ts` to enable event-driven drain without polling
- Added `EmitterOptions.role: 'initiator' | 'responder'` to handle two-party setup without FSM conflicts
- All 260 tests pass (13 new: 10 unit + 3 integration)

## Task Commits

1. **Task 1: TypedEmitter + EmitterStream factory** — `638b93f` (feat)
2. **Task 2: Unit tests for on/off/once/write/end** — `d13c053` (test)
3. **Task 3: Integration test for drain event** — `f43bbf6` (feat + test)

## Files Created/Modified

- `src/adapters/emitter.ts` — TypedEmitter base, EmitterStream interface, createEmitterStream() factory with role support
- `src/session/index.ts` — Added `#onCreditRefillCb`, `onCreditRefill()` method, `isCreditExhausted` getter; `#drainPendingSends()` fires callback after drain cycle
- `tests/unit/adapters/emitter.test.ts` — 10 unit tests: on/off/once, write() boolean return, end() lifecycle, removeAllListeners() isolation
- `tests/integration/emitter-drain.test.ts` — 3 integration tests: drain event after backpressure, no drain without backpressure, bidirectional data flow

## Decisions Made

- **Role option design**: Added `EmitterOptions.role: 'initiator' | 'responder'` because without it both sides calling `createEmitterStream` would both call `channel.openStream()`, causing FSM conflict (`OPENING + OPEN_RECEIVED = IllegalTransitionError`). Initiator calls `openStream()` immediately; responder registers `onStream()` callback and wires the session when the OPEN frame arrives.

- **end() event order**: `emit('end')` → `emit('close')` → `removeAllListeners()`. This ensures both lifecycle events are observable by handlers registered before `end()` is called, then all listeners are cleared for GC safety (LIFE-05).

- **Session.onCreditRefill() hook**: Added to Session rather than polling `desiredSize` — this is event-driven, fires exactly when `#drainPendingSends()` processes pending sends after credit arrives. Fires only when `hadPending` was true (i.e., backpressure was active).

- **backpressureActive flag**: The drain event only fires when write() previously returned `false` AND credits then arrive. This matches Node.js stream semantics precisely — drain is not fired on every credit refill, only on transitions from backpressure to no-backpressure.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added Session.onCreditRefill() callback for drain event**
- **Found during:** Task 1 (EmitterStream factory implementation)
- **Issue:** Plan's template code included a `TODO: listen for credit refill` comment — Session had no public callback for credit refill events, making `drain` event unwireable without polling
- **Fix:** Added `#onCreditRefillCb`, `onCreditRefill()` method, and `isCreditExhausted` getter to Session; updated `#drainPendingSends()` to fire the callback when pending sends are drained
- **Files modified:** `src/session/index.ts`
- **Verification:** TypeScript clean, all 260 tests pass, drain integration test confirms event fires
- **Committed in:** `638b93f`

**2. [Rule 1 - Bug] Added EmitterOptions.role to fix FSM conflict in two-party tests**
- **Found during:** Task 2 (Unit test execution)
- **Issue:** Both sides calling `createEmitterStream` → `channel.openStream()` caused `IllegalTransitionError: OPENING + OPEN_RECEIVED` when the remote OPEN arrived while local session was in OPENING state
- **Fix:** Added `role: 'initiator' | 'responder'` option; responder path uses `channel.onStream()` instead of `channel.openStream()`; pending writes queued until session is ready
- **Files modified:** `src/adapters/emitter.ts`, `tests/unit/adapters/emitter.test.ts`
- **Verification:** All unit tests pass (10/10), FSM errors eliminated
- **Committed in:** `f43bbf6`

---

**Total deviations:** 2 auto-fixed (1 missing critical, 1 bug)
**Impact on plan:** Both fixes essential for correctness. No scope creep — Session hook is minimal (3 additions), role option is the correct design for the two-party model.

## Known Stubs

None — all exported functionality is fully wired. The `code` value for non-stall session errors is mapped to `CONSUMER_STALL` as a conservative fallback; Phase 4 observability hooks will wire more specific error codes.

## Self-Check: PASSED

- FOUND: src/adapters/emitter.ts
- FOUND: src/session/index.ts (modified)
- FOUND: tests/unit/adapters/emitter.test.ts
- FOUND: tests/integration/emitter-drain.test.ts
- FOUND: commit 638b93f (feat: TypedEmitter + factory)
- FOUND: commit d13c053 (test: unit tests)
- FOUND: commit f43bbf6 (feat: role option + integration test)
- VERIFIED: pnpm exec tsc --noEmit exits 0
- VERIFIED: 260/260 tests pass

---
*Phase: 03-api-adapters-single-hop-integration*
*Completed: 2026-04-21*
