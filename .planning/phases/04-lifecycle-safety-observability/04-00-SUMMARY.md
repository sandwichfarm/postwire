---
phase: 04-lifecycle-safety-observability
plan: "00"
subsystem: channel-types-session
tags: [scaffold, types, emitter, disposers, reorder-overflow, stats-types]
dependency_graph:
  requires: [03-api-adapters-single-hop-integration]
  provides: [ErrorCode-full-set, StreamError-streamId, ChannelEmitter, disposers-pattern, stats-types, REORDER_OVERFLOW-catch, test-scaffolds]
  affects: [src/types.ts, src/channel/channel.ts, src/channel/stats.ts, src/session/index.ts, src/session/reorder-buffer.ts]
tech_stack:
  added: []
  patterns: [disposers-array, ChannelEmitter-inline, TypedEmitter-ChannelEventMap, FrameType-alias]
key_files:
  created:
    - src/channel/stats.ts
    - tests/unit/channel/bfcache.test.ts
    - tests/integration/lifecycle-teardown.test.ts
    - tests/integration/observability.test.ts
  modified:
    - src/types.ts
    - src/framing/types.ts
    - src/channel/channel.ts
    - src/session/index.ts
    - src/session/reorder-buffer.ts
decisions:
  - "Inline ChannelEmitter class in channel.ts rather than reusing emitter.ts TypedEmitter — emitter.ts has a stream-level EventMap (data/end/error/close/drain) that is not appropriate for channel-level events"
  - "Keep CONSUMER_STALL in ErrorCode union for backward compat with emitter.ts; CREDIT_DEADLOCK added alongside it (Plan 04 renames the wiring)"
  - "close() now flushes disposers and is idempotent via #isClosed guard; #freezeAllStreams is the shared teardown path"
  - "bufferSize getter added to ReorderBuffer as a public accessor for OBS-01 stats collection"
metrics:
  duration: 4min
  completed: 2026-04-21
  tasks_completed: 3
  files_changed: 9
---

# Phase 4 Plan 00: Phase 4 Scaffold Summary

Phase 4 Wave 0 scaffold: ErrorCode union extended to full OBS-02 set, stats types module created, Channel wired with TypedEmitter/disposers/isClosed/freezeAllStreams skeleton, REORDER_OVERFLOW caught in Session.receiveFrame, three test scaffolds with it.todo stubs.

## What Was Built

### Task 1: Extended types and stats module

- `src/types.ts`: Added `CREDIT_DEADLOCK`, `REORDER_OVERFLOW` to `ErrorCode` union (keeping `CONSUMER_STALL` for backward compat). Added optional `streamId?: number` to `StreamError` constructor.
- `src/framing/types.ts`: Exported `FrameType = Frame["type"]` alias for use in stats types.
- `src/channel/stats.ts`: New file — exports `StreamStats`, `ChannelStats`, `TraceEvent`, `TraceDirection` interfaces. Pure type definitions, no runtime code.

### Task 2: Channel skeleton and REORDER_OVERFLOW catch

- `src/channel/channel.ts`:
  - Added `ChannelEventMap` type (`error | close | trace`) and inline `ChannelEmitter` class
  - Added `#emitter`, `#disposers`, `#isClosed`, `#bytesSent`, `#bytesReceived`, `#frameCountsSent`, `#frameCountsRecv` private fields
  - Added `on()`/`off()` public methods for channel-level event subscription
  - Added `#freezeAllStreams(code)` private method — idempotent teardown with session reset + emitter flush
  - Added `#runDisposers()` helper — flushes disposers array in reverse (LIFE-05)
  - Updated `close()` to be idempotent via `#isClosed` guard and flush disposers
  - Updated `ChannelOptions` with `endpointKind`, `heartbeat`, `trace` fields (contracts for Wave 1 plans)
  - Added `isTerminalState` import from `session/fsm.js` for `#freezeAllStreams` guard
- `src/session/reorder-buffer.ts`: Added `get bufferSize(): number` getter (OBS-01 stats)
- `src/session/index.ts`: Wrapped `this.#reorder.insert()` in try/catch — catches `Error('REORDER_OVERFLOW')` and routes to `#applyTransition({ type: 'RESET_SENT' })` + `#onErrorCb?.('REORDER_OVERFLOW')` instead of unhandled exception

### Task 3: Test scaffolds

Three test files created with `it.todo` stubs. All compile cleanly; Vitest shows them as TODO (not failures).

- `tests/unit/channel/bfcache.test.ts`: 4 stubs for LIFE-01 (BFCache pagehide/pageshow mocks)
- `tests/integration/lifecycle-teardown.test.ts`: 3 stubs for LIFE-03/LIFE-05 (port close, zombie prevention, listener cleanup)
- `tests/integration/observability.test.ts`: 7 stubs for OBS-01/OBS-02 (stats(), error event routing)

## Verification Results

- `pnpm exec tsc --noEmit`: clean (0 errors)
- `pnpm test`: 262 passed, 14 todo, 0 failures (19 passing + 3 skipped test files)
- All pre-existing Phase 3 tests continue to pass unchanged

## Decisions Made

1. **Inline ChannelEmitter instead of reusing TypedEmitter from emitter.ts** — The emitter.ts TypedEmitter is hardcoded to `EmitterEventMap` (data/end/error/close/drain) and is private to that module. Channel needs a different map (error/close/trace). Inlining a ~30-line `ChannelEmitter` class avoids forcing a refactor of the stream emitter.

2. **CONSUMER_STALL retained alongside CREDIT_DEADLOCK** — `emitter.ts` line 184 maps `"consumer-stall"` to `"CONSUMER_STALL"`. Removing `CONSUMER_STALL` from the union would break that code. Plan 04 (OBS-02 wiring) will rename the mapping; for now both codes coexist.

3. **`close()` now idempotent** — Pre-Phase-4 `close()` called `session.close()` without guarding for double-close. Phase 4 adds `#isClosed` guard so BFCache, heartbeat, and explicit `channel.close()` paths all converge safely.

4. **`bufferSize` as a public getter** — Required for OBS-01 stats. The buffer is a private `Map<number, DataFrame>` inside `ReorderBuffer`; a getter is the least-invasive exposure.

## Deviations from Plan

### Auto-added

**1. [Rule 2 - Missing functionality] Added `#options` field to Channel**
- **Found during:** Task 2 — `#freezeAllStreams` and future heartbeat/BFCache code need access to the options object
- **Fix:** Stored `this.#options = options` in constructor
- **Files modified:** `src/channel/channel.ts`
- **Commit:** 503702d

**2. [Rule 2 - Missing functionality] Added `FrameType` export to framing/types.ts**
- **Found during:** Task 1 — `stats.ts` imports `FrameType` but it was not previously exported
- **Fix:** Added `export type FrameType = Frame["type"];` at the bottom of `framing/types.ts`
- **Files modified:** `src/framing/types.ts`
- **Commit:** 7a2186c

## Known Stubs

The scaffold test files contain `it.todo` stubs that are intentional — they are the Wave 1 implementation targets:

| File | Stubs | Implemented by |
|------|-------|---------------|
| `tests/unit/channel/bfcache.test.ts` | 4 | Plan 04-01 (BFCache) |
| `tests/integration/lifecycle-teardown.test.ts` | 3 | Plan 04-02 (Teardown) |
| `tests/integration/observability.test.ts` | 7 | Plan 04-03 (OBS-01) / 04-04 (OBS-02) |

The `#freezeAllStreams`, `#disposers`, `on()`/`off()`, and `ChannelOptions.endpointKind/heartbeat/trace` fields are skeleton infrastructure — they compile and are wired internally but have no call sites yet. Wave 1 plans attach listeners to them.

## Self-Check: PASSED

