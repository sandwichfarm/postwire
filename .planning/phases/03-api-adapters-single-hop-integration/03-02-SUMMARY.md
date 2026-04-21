---
phase: 03-api-adapters-single-hop-integration
plan: "02"
subsystem: adapters
tags: [lowlevel, binary-transfer, fast-path, tdd, vitest, typescript]

# Dependency graph
requires:
  - phase: 03-api-adapters-single-hop-integration
    plan: "01"
    provides: >
      Channel class, createChannel factory, StreamError typed error class

provides:
  - src/adapters/lowlevel.ts — createLowLevelStream factory (API-01)
  - tests/unit/adapters/lowlevel.test.ts — 15 unit tests for API-01 behaviors
  - tests/integration/binary-transfer.test.ts — 3 integration tests proving FAST-01

affects:
  - 03-03-emitter
  - 03-04-streams
  - 03-05-mock-endpoint-tests
  - 03-06-index

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "LowLevelStream: thin wrapper over Channel.openStream() and Session callbacks"
    - "BINARY_TRANSFER single-chunk: original ArrayBuffer passed directly to transfer list (detaches caller's buffer per FAST-01)"
    - "BINARY_TRANSFER multi-chunk: ab.slice() copies used (original read multiple times)"
    - "onError: maps session reason strings to typed StreamError instances"
    - "onClose: observes session.state===CLOSED via onChunk/onError hooks"
    - "Integration tests: await capabilityReady + 50ms OPEN/OPEN_ACK handshake before sending"

key-files:
  created:
    - src/adapters/lowlevel.ts
    - tests/unit/adapters/lowlevel.test.ts
    - tests/integration/binary-transfer.test.ts
  modified:
    - src/session/chunker.ts

key-decisions:
  - "send() resolves immediately after session.sendData() handoff — session manages credit queue; WHATWG Streams adapter adds deeper backpressure in plan 04"
  - "onClose wired via session.onChunk + session.onError hooks checking state===CLOSED (Session has no dedicated onClose callback)"
  - "Chunker single-chunk zero-copy: original ab used directly when payload fits in one frame; slices used for multi-chunk to allow multiple reads of original"

requirements-completed: [API-01, FAST-01]

# Metrics
duration: 4min
completed: 2026-04-21
---

# Phase 03 Plan 02: Low-Level Adapter Summary

**createLowLevelStream factory with BINARY_TRANSFER zero-copy path — FAST-01 proven via real Node MessageChannel detach semantics**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-21T12:22:24Z
- **Completed:** 2026-04-21T12:26:30Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Created `src/adapters/lowlevel.ts` with `createLowLevelStream(channel, options?)` factory:
  - Returns `{send, onChunk, onClose, onError, close}` — the primitive all higher adapters compose on
  - `send(chunk, transfer?)` is async, resolves after session.sendData() handoff
  - `send(buf, [buf])` uses BINARY_TRANSFER path — source buffer is detached after postMessage (FAST-01)
  - `onError` maps session reason strings to typed `StreamError` instances
  - `onClose` observes `session.state === "CLOSED"` via onChunk/onError hooks
  - Zero cross-imports from emitter.ts or streams.ts (tree-shakeable, API-04)
- Created 15 unit tests covering: shape, send async contract, close, onChunk, onError error mapping, onClose registration
- Created 3 integration tests proving FAST-01: ArrayBuffer detach, STRUCTURED_CLONE no-detach, multi-chunk ordered delivery
- Fixed chunker bug: single-chunk BINARY_TRANSFER now uses original ArrayBuffer in transfer list (not a copy) — enables FAST-01 zero-copy contract

## Task Commits

Each task was committed atomically:

1. **Task 1: TDD RED + GREEN — createLowLevelStream adapter + unit tests** — `8829f6b` (feat)
2. **Task 2: FAST-01 integration test + chunker zero-copy single-chunk fix** — `da3d088` (feat)

## Files Created/Modified

- `src/adapters/lowlevel.ts` — createLowLevelStream factory, LowLevelStream interface, LowLevelOptions
- `tests/unit/adapters/lowlevel.test.ts` — 15 unit tests for API-01 behaviors
- `tests/integration/binary-transfer.test.ts` — 3 integration tests proving FAST-01
- `src/session/chunker.ts` — fixed single-chunk BINARY_TRANSFER to use original ArrayBuffer

## Decisions Made

- **send() resolves after handoff**: Low-level adapter resolves `send()` immediately after `session.sendData()` returns. The session's `#pendingSends` queue handles credit gating internally. Deeper caller-facing backpressure is deferred to the WHATWG Streams adapter in plan 04 which uses `WritableStream.write()` Promise semantics.
- **onClose via state polling**: Session has no dedicated `onClose` hook. The low-level adapter observes `session.state === "CLOSED"` after each `onChunk`/`onError` notification. This is correct for Phase 3 — a dedicated hook can be added in Phase 4 alongside lifecycle work.
- **Chunker zero-copy for single-chunk**: When a BINARY_TRANSFER payload fits in one frame (the common case for payloads <= 64KB), the original `ab` reference is placed in the transfer list directly rather than a copy. This detaches the caller's buffer after `postMessage`, satisfying FAST-01. For multi-chunk payloads, slices are still required since the original must be read at each chunk offset.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Chunker always created .slice() copies for BINARY_TRANSFER, breaking FAST-01**
- **Found during:** Task 2 integration test failure (`expect(buf.byteLength).toBe(0)` failed with 4096)
- **Issue:** `chunker.split()` with `BINARY_TRANSFER` unconditionally called `ab.slice()` for every chunk, including single-chunk payloads. The original `ab` was never placed in a transfer list, so `postMessage` never detached it. This broke the documented API contract (`send(buf, [buf])` should detach `buf`).
- **Fix:** For the single-chunk case (`offset === 0 && isFinal === true`), use the original `ab` directly in the frame payload and transfer list. Multi-chunk case continues to use `.slice()` (required since the original must be read at each offset).
- **Files modified:** `src/session/chunker.ts`
- **Commit:** `da3d088`

## Known Stubs

None — all exported functionality is fully wired.

## Self-Check: PASSED

- FOUND: src/adapters/lowlevel.ts
- FOUND: tests/unit/adapters/lowlevel.test.ts
- FOUND: tests/integration/binary-transfer.test.ts
- FOUND: 03-02-SUMMARY.md
- FOUND: commit 8829f6b (feat: lowlevel adapter + unit tests)
- FOUND: commit da3d088 (feat: FAST-01 integration + chunker fix)
- pnpm exec tsc --noEmit: exits 0
- pnpm exec vitest run --project=unit tests/unit/adapters/lowlevel.test.ts tests/integration/binary-transfer.test.ts: 18 tests passed

---
*Phase: 03-api-adapters-single-hop-integration*
*Completed: 2026-04-21*
