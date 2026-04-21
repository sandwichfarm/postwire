---
phase: 02-session-protocol-core
plan: "05"
subsystem: session
tags: [session, integration, tdd, fast-check, wraparound, sess-06, test-01, test-06, wave-2]
dependency_graph:
  requires:
    - src/session/reorder-buffer.ts (02-01)
    - src/session/credit-window.ts (02-02)
    - src/session/chunker.ts (02-03)
    - src/session/fsm.ts (02-04)
    - src/framing/types.ts (Phase 1)
  provides:
    - src/session/index.ts (Session, SessionOptions — full implementation)
    - tests/unit/session/session.test.ts (19 integration tests)
  affects:
    - Phase 3 (PostMessageEndpoint wiring — Session is the primary consumer API)
    - Phase 4 (onMetrics? extension point already in SessionOptions)
tech_stack:
  added: []
  patterns:
    - Composition via constructor (ReorderBuffer + CreditWindow + Chunker + FSM wired in Session)
    - Credit-gated send queue (#pendingSends drain on CREDIT/OPEN_ACK)
    - isTerminalState guard in receiveFrame (Pitfall 3 from RESEARCH.md)
    - reorderInitSeq?: number in SessionOptions forwarded to new ReorderBuffer(opts.reorderInitSeq ?? 0, ...)
    - #handleStall() called by CreditWindow.onStall, transitions FSM OPEN→ERRORED via STALL_TIMEOUT
    - #checkFinalSeqDelivered() inline modular arithmetic to detect CLOSING→CLOSED without extra import
    - Biome import-sort auto-applied; unused type imports removed by biome --unsafe
    - vi.useFakeTimers() + afterEach(vi.useRealTimers) for stall detection test
key_files:
  created: []
  modified:
    - src/session/index.ts
    - tests/unit/session/session.test.ts
decisions:
  - "reorderInitSeq?: number added to SessionOptions and forwarded as opts.reorderInitSeq ?? 0 to new ReorderBuffer() — required for SESS-06 wraparound tests starting at 0xFFFFFFF0"
  - "Initiator CreditWindow starts at initialCredit=0; responder starts at initialCredit (responder grants credits to initiator via OPEN_ACK)"
  - "DATA_RECEIVED FSM transition called after reorder buffer delivery — ordering is: insert → reassemble → onChunk → notifyRead → transition → checkFinalSeq"
  - "#checkFinalSeqDelivered inlines modular seqGT logic rather than importing from seq.ts, avoiding an extra import; logic: (remoteFinalSeq - nextExp + 1) >>> 0 > HALF_WINDOW || nextExp === (remoteFinalSeq + 1) >>> 0"
  - "SESS-06 test uses isFinal=true for all 32 frames (each is a complete STRUCTURED_CLONE message) — chunker.reassemble returns null for STRUCTURED_CLONE with isFinal=false (it is single-chunk protocol)"
  - "onMetrics?: (event: never) => void preserved as Phase 4 extension point — accepted but unused in Phase 2"
metrics:
  duration: "~5min"
  completed: "2026-04-21"
  tasks_completed: 2
  files_created: 0
  files_modified: 2
---

# Phase 02 Plan 05: Session Integration Summary

**One-liner:** Session class composes ReorderBuffer + CreditWindow + Chunker + FSM into a credit-gated, reorder-buffered, FSM-guarded stream entity with configurable reorderInitSeq enabling SESS-06 wraparound integration passing 100 fast-check runs across 0xFFFFFFF0.

## What Was Built

### src/session/index.ts

Full replacement of the Wave 0 stub. The `Session` class wires all four Wave 1 sub-modules:

**Constructor:** `SessionOptions.reorderInitSeq?: number` is forwarded to `new ReorderBuffer(opts.reorderInitSeq ?? 0, ...)`. Initiator starts with 0 send credits; responder starts with `initialCredit` send credits. `CreditWindow.onStall` calls `#handleStall()` to fire `STALL_TIMEOUT` on the FSM and call `onError('consumer-stall')`.

**`receiveFrame(frame)` dispatch:**
- `isTerminalState()` guard at top — silently drops all frames in CLOSED/ERRORED/CANCELLED (FSM Pitfall 3)
- `OPEN` → responder path: OPEN_RECEIVED→OPENING, then sends OPEN_ACK (OPEN_ACK_SENT→OPEN)
- `OPEN_ACK` → initiator path: addSendCredit + OPEN_ACK_RECEIVED→OPEN + drain pending sends
- `DATA` → addRecvConsumed + reorder.insert + for-each delivered: reassemble → onChunk + notifyRead, then DATA_RECEIVED transition + checkFinalSeqDelivered
- `CREDIT` → addSendCredit + drainPendingSends
- `CLOSE` → set remoteFinalSeq + CLOSE_RECEIVED + checkFinalSeqDelivered
- `CANCEL`/`RESET` → FSM transition + onError callback
- `CAPABILITY` → silently dropped (channel-level, Phase 8 concern)

**`sendData(payload, chunkType)`:** Credit-gated. If `consumeSendCredit()` returns false, queues in `#pendingSends`. Otherwise calls `#emitData()` which uses `chunker.split()` and emits each ChunkResult via `onFrameOut`.

**`close()`/`cancel(reason)`/`reset(reason)`:** Each emits the corresponding frame, transitions the FSM, and calls `onError` (for cancel/reset).

**`#checkFinalSeqDelivered()`:** When `state === 'CLOSING'` and `remoteFinalSeq !== null`, checks whether `reorder.nextExpected` has passed `remoteFinalSeq` using inlined modular arithmetic. If so, fires `FINAL_SEQ_DELIVERED` → CLOSED.

**Re-exports:** All sub-module types re-exported from `src/session/index.ts` so Phase 3 needs only one import: `StreamState`, `StreamEvent`, `IllegalTransitionError`, `ReorderBufferOptions`, `CreditWindowOptions`, `ChunkerOptions`, `ChunkResult`.

### tests/unit/session/session.test.ts

19 integration tests across 6 describe blocks:

| Describe | Tests | Coverage |
|---|---|---|
| TEST-01: headless Node | 1 | `typeof window === 'undefined'` assertion |
| Responder side | 7 | OPEN→OPEN_ACK, in-order/out-of-order DATA, RESET, CANCEL, terminal drop, CLOSE |
| Initiator side | 7 | open()→OPENING, sendData with credit, credit-gate queue, CREDIT drain, close, cancel, full lifecycle |
| Consumer-stall detection | 1 | vi.useFakeTimers + stallTimeoutMs=1000 → ERRORED + onError('consumer-stall') |
| SESS-06 wraparound | 2 | 100-run fast-check property with reorderInitSeq=0xFFFFFFF0; negative test showing stale-drop without reorderInitSeq |
| Full lifecycle (responder) | 1 | OPEN → DATA×3 → close() → remote CLOSE(finalSeq=2) → CLOSING → CLOSED |

## Verification Results

- `pnpm exec vitest run --project=unit tests/unit/session/session.test.ts` → 19/19 passed
- `pnpm exec vitest run --project=unit tests/unit/session/` → 139/139 passed (all 5 session test files)
- `pnpm test` → 194/194 passed (9 test files)
- `pnpm exec tsc --noEmit` → exit 0
- `pnpm exec biome check src/session/index.ts tests/unit/session/session.test.ts` → exit 0, no fixes

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] isFinal=true for all SESS-06 test frames**
- **Found during:** Task 2, RED phase — fast-check counterexample showed only 1 chunk delivered
- **Issue:** Test used `isFinal = seqNum === lastSeqNum`, meaning 31 frames had `isFinal=false`. Chunker.reassemble for STRUCTURED_CLONE returns `null` for `isFinal=false` — it is a single-chunk protocol. The reorder buffer delivered frames correctly but reassemble suppressed 31 of them.
- **Fix:** Changed all 32 SESS-06 frames to `isFinal=true`. Each DATA frame is its own complete message in the integration test; multi-chunk reassembly is tested separately in chunker.test.ts.
- **Files modified:** `tests/unit/session/session.test.ts`
- **Commit:** 04a6850 (same task commit)

**2. [Rule 1 - Bug] Biome removed unused `import type { ... }` lines**
- **Found during:** Task 1, after writing index.ts — biome check flagged ChunkerOptions, CreditWindowOptions, ReorderBufferOptions as unused imports (they are re-exported directly via `export type { ... } from` without needing a local import)
- **Fix:** Applied `biome check --write --unsafe` to remove the unused type imports. The `export type { ... } from '...'` re-exports work without a corresponding import statement in TypeScript.
- **Files modified:** `src/session/index.ts`
- **Commit:** a5472a8 (same task commit)

## Known Stubs

None. `src/session/index.ts` is fully implemented. All public methods wire to the four sub-modules. The `onMetrics?: (event: never) => void` parameter is accepted but unused — this is an intentional Phase 4 extension point, not a stub.

## Self-Check: PASSED
