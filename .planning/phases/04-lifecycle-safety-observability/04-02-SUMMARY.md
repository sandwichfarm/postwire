---
phase: 04-lifecycle-safety-observability
plan: "02"
subsystem: channel
tags: [heartbeat, lifecycle, CHANNEL_DEAD, SW-recycle, fake-timers, ping-pong]
dependency_graph:
  requires: [04-00]
  provides: [SW-heartbeat, LIFE-02]
  affects: [src/channel/channel.ts, tests/unit/channel/channel.test.ts]
tech_stack:
  added: []
  patterns: [setInterval-heartbeat, setTimeout-timeout, disposers-cleanup, ping-pong-null-check]
key_files:
  created: []
  modified:
    - src/channel/channel.ts
    - tests/unit/channel/channel.test.ts
decisions:
  - "Ping-pong loop prevention via #heartbeatTimeout null-check: non-null = we sent ping, this is pong (clear timeout, do not echo); null = remote sent ping (echo once, do not arm timeout)"
  - "Initial handshake must complete (simulateMessage of CAPABILITY) before heartbeat pong test works, because isPostHandshake = (this.#remoteCap !== null)"
  - "Heartbeat timers registered in #disposers array for LIFE-05 compliance — cleared atomically when channel.close() runs disposers before emitting close event"
metrics:
  duration: 5min
  completed: 2026-04-21
  tasks_completed: 1
  files_changed: 2
---

# Phase 4 Plan 02: SW Heartbeat (LIFE-02) Summary

SW heartbeat via CAPABILITY-as-ping with CHANNEL_DEAD on timeout: setInterval sends CAPABILITY every intervalMs; #heartbeatTimeout null-check prevents ping-pong loop; disposers array clears both timers on channel.close().

## What Was Built

### Task 1: Implement heartbeat and add fake-timer tests

**Implementation in `src/channel/channel.ts`:**

- Added `#heartbeatInterval` and `#heartbeatTimeout` private fields (both nullable `ReturnType<typeof setInterval/setTimeout>`)
- Added `#startHeartbeat()` private method:
  - Reads `options.heartbeat.intervalMs` and `timeoutMs`
  - `setInterval` sends `#sendCapability()` ping on each tick
  - `setTimeout` armed after each ping — fires `#freezeAllStreams('CHANNEL_DEAD')` on expiry
  - Both timers registered in `#disposers` for LIFE-05 cleanup
- Updated `#handleCapability()` to distinguish post-handshake CAPABILITY (ping vs pong):
  - `isPostHandshake = this.#remoteCap !== null` (set on first handshake)
  - Non-initial: if `#heartbeatTimeout !== null` → pong, clear timeout; else → remote ping, echo once
  - Initial handshake path unchanged: calls `#resolveCapability()`
- Constructor calls `#startHeartbeat()` after `#sendCapability()` when `options.heartbeat` is set

**Tests in `tests/unit/channel/channel.test.ts`:**

Three new tests in `describe("Channel — SW heartbeat (LIFE-02)")` using `vi.useFakeTimers()`:
1. `emits CHANNEL_DEAD after timeoutMs when no CAPABILITY pong arrives` — advances past intervalMs, verifies ping sent, advances past timeoutMs, asserts error.code === "CHANNEL_DEAD"
2. `does NOT emit CHANNEL_DEAD when CAPABILITY pong arrives before timeout` — completes initial handshake first, advances past intervalMs (ping sent), simulates pong CAPABILITY, advances past timeoutMs, asserts no errors
3. `heartbeat timers are cleared after channel.close()` — calls close(), advances 200s, asserts no errors

## Verification Results

- `pnpm exec tsc --noEmit`: clean (0 errors)
- `pnpm exec vitest run --project unit tests/unit/channel/channel.test.ts --reporter=verbose`: 11 passed (8 pre-existing + 3 new heartbeat)
- Full unit suite: 269 passed, 10 todo, 1 flaky pre-existing failure (heap-flat.test.ts — timing assertion, confirmed pre-existing per 04-01-SUMMARY.md)

## Decisions Made

1. **Ping-pong loop prevention via `#heartbeatTimeout` null-check** — When a post-handshake CAPABILITY arrives and `#heartbeatTimeout` is non-null, we are waiting for our own ping's pong — clear it, done. When null, the remote sent an unsolicited CAPABILITY (their ping) — echo once. This is the exact pattern from RESEARCH.md Pitfall 3.

2. **Test must complete initial handshake before testing pong** — The `isPostHandshake` check uses `this.#remoteCap !== null`. In tests, the channel sends its CAPABILITY on construction but never receives one back unless the test explicitly simulates it. The pong test was adjusted to send the initial CAPABILITY first (via `ep.simulateMessage`), which sets `#remoteCap`, making subsequent CAPABILITY frames recognized as post-handshake.

3. **Heartbeat timers in `#disposers`** — Both `clearInterval` and `clearTimeout` are registered in the disposers array. This satisfies LIFE-05 and prevents RESEARCH.md Pitfall 6 (timeout fires after close). The disposers flush runs synchronously in `close()` and `#freezeAllStreams()` before any events are emitted.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test needed initial handshake before pong test**
- **Found during:** Task 1 — "does NOT emit CHANNEL_DEAD when CAPABILITY pong arrives" test failed because `#remoteCap` was null (no initial CAPABILITY received), so the pong was treated as the initial handshake rather than a post-handshake pong
- **Issue:** The plan's test sketch did not simulate the initial CAPABILITY handshake from the remote side before advancing timers and sending the pong
- **Fix:** Added `ep.simulateMessage(capabilityFrame)` at the start of the pong test to complete the handshake — `#remoteCap` is set, subsequent CAPABILITY frames are correctly identified as post-handshake
- **Files modified:** `tests/unit/channel/channel.test.ts`
- **Commit:** 5842080

## Known Stubs

None — all three LIFE-02 tests are fully implemented and passing. The heartbeat feature is complete.

## Self-Check: PASSED
