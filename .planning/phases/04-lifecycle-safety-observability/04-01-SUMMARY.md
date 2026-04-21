---
phase: 04-lifecycle-safety-observability
plan: "01"
subsystem: channel
tags: [bfcache, lifecycle, pagehide, pageshow, CHANNEL_FROZEN, CHANNEL_CLOSED, disposers]
dependency_graph:
  requires: [04-00]
  provides: [BFCache-detection, LIFE-01]
  affects: [src/channel/channel.ts, tests/unit/channel/bfcache.test.ts]
tech_stack:
  added: []
  patterns: [disposers-array, globalThis-addEventListener, EventTarget-polyfill-in-tests]
key_files:
  created: []
  modified:
    - src/channel/channel.ts
    - tests/unit/channel/bfcache.test.ts
decisions:
  - "Cast Event to (Event & { persisted?: boolean }) in pagehide handler — avoids DOM-only PageTransitionEvent type dependency in runtime code"
  - "Test polyfills globalThis with a shared EventTarget in beforeAll — Node 22 globalThis is NOT an EventTarget, despite RESEARCH.md claim; browser globalThis === window IS an EventTarget"
  - "pageshow listener is an intentional no-op — channel stays dead after BFCache restore; idempotency via #isClosed guard in #freezeAllStreams"
metrics:
  duration: 3min
  completed: 2026-04-21
  tasks_completed: 1
  files_changed: 2
---

# Phase 4 Plan 01: BFCache Detection Summary

BFCache lifecycle detection (LIFE-01): pagehide/pageshow listeners on globalThis for Window endpoints; pagehide(persisted=true) emits CHANNEL_FROZEN; pagehide(persisted=false) emits CHANNEL_CLOSED; listeners removed on channel.close() via disposers array.

## What Was Built

### Task 1: Wire BFCache listeners and implement tests (TDD)

**RED:** Replaced 4 `it.todo` stubs in `tests/unit/channel/bfcache.test.ts` with real test implementations using `globalThis.dispatchEvent` pattern. All 4 tests failed as expected (channel had no BFCache wiring).

**GREEN:** Added BFCache listener block to `Channel` constructor in `src/channel/channel.ts`:

- `if (options.endpointKind === "window")` guard — only Window endpoints get BFCache listeners
- `onPagehide` handler reads `(e as Event & { persisted?: boolean }).persisted ?? false` — safe cast avoiding DOM type dependency
- `persisted=true` path calls `this.#freezeAllStreams('CHANNEL_FROZEN')`
- `persisted=false` path calls `this.#freezeAllStreams('CHANNEL_CLOSED')`
- `onPageshow` is an intentional no-op — channel stays dead; `#isClosed` guard in `#freezeAllStreams` prevents any double-error
- Both listeners pushed into `this.#disposers` — flushed in reverse on `channel.close()` (LIFE-05)

**Test polyfill deviation:** Node 22's `globalThis` does NOT have `addEventListener`/`dispatchEvent` (unlike browsers where `globalThis === window`). RESEARCH.md incorrectly stated it does. Added `beforeAll` in the test file to polyfill `globalThis` with a shared `EventTarget` instance's bound methods, mirroring the browser environment.

## Verification Results

- `pnpm exec tsc --noEmit`: clean (0 errors)
- `pnpm test -- --project unit`: 266 passed, 0 failures, 10 todo (276 total)
- 4 new LIFE-01 tests in `bfcache.test.ts` all pass
- 262 pre-existing tests continue to pass unchanged
- Full suite: `heap-flat.test.ts` fails with timing assertion — pre-existing flaky test, confirmed present before these changes, unrelated to BFCache

## Decisions Made

1. **Event type-cast avoids DOM dependency** — `(e as Event & { persisted?: boolean }).persisted` reads the `persisted` property at runtime without importing `PageTransitionEvent` (not available in Node). This keeps the runtime code environment-agnostic.

2. **Test uses beforeAll EventTarget polyfill** — `globalThis.addEventListener` is undefined in Node 22. Rather than injecting a custom event bus into the Channel constructor (which would complicate the API), the test polyfills `globalThis` once per file. The polyfill is a one-time setup and doesn't leak between tests because listeners are removed in `afterEach` via `channel.close()`.

3. **pageshow is a no-op** — CONTEXT.md decision: "pageshow(persisted=true) → channel stays dead". The `#isClosed` guard in `#freezeAllStreams` ensures idempotency even if `pageshow` fires (which it doesn't here since we register a no-op listener, but defensive).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Node 22 globalThis is not an EventTarget**
- **Found during:** Task 1 (GREEN phase) — `TypeError: globalThis.addEventListener is not a function`
- **Issue:** RESEARCH.md claimed "globalThis in Node 22 IS an EventTarget" — empirically false. `globalThis` in Node 22 has `EventTarget` as a global constructor but `globalThis` itself does not extend `EventTarget`.
- **Fix:** Added `beforeAll` in test file to polyfill `globalThis` with bound EventTarget methods, matching browser behavior where `globalThis === window` IS an EventTarget. Channel implementation unchanged — it correctly assumes `addEventListener` exists on `globalThis` when in a browser (where `endpointKind: 'window'` is actually meaningful).
- **Files modified:** `tests/unit/channel/bfcache.test.ts`
- **Commit:** db1da01

## Known Stubs

None — all 4 LIFE-01 tests are fully implemented and passing.

## Self-Check: PASSED
