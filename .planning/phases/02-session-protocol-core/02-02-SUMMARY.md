---
phase: 02-session-protocol-core
plan: "02"
subsystem: session
tags: [credit-window, flow-control, quic, backpressure, tdd, fake-timers, fast-check]
dependency_graph:
  requires:
    - 02-00 (session scaffold)
  provides:
    - src/session/credit-window.ts (CreditWindow full implementation)
    - tests/unit/session/credit-window.test.ts (21 tests: unit + fake-timer + property)
  affects:
    - 02-05 (Session entity will wire CreditWindow)
    - Phase 3 WHATWG Streams adapter (desiredSize seam)
tech_stack:
  added: []
  patterns:
    - QUIC WINDOW_UPDATE-style credit accounting (RFC 9000 §4.1)
    - Private class fields (#) for encapsulation
    - ReturnType<typeof setTimeout> for Node-compatible timer handle type
    - vi.useFakeTimers() + afterEach(vi.useRealTimers) for stall detection tests
    - fast-check property test: sendCredit never negative across 500 random sequences
    - TDD: RED commit (c575ff4) then GREEN commit (df54a7d)
key_files:
  created:
    - tests/unit/session/credit-window.test.ts
  modified:
    - src/session/credit-window.ts
decisions:
  - "consumeSendCredit guard is if (sendCredit <= 0) return false BEFORE any decrement — prevents credit going negative (RESEARCH.md Pitfall 2)"
  - "notifyRead drives CREDIT (not frame arrival) — SESS-03 requirement; issuing credit on arrival leads to unbounded buffering"
  - "stallTimeoutMs <= 0 disables stall timer entirely — no setTimeout call made"
  - "Stall timer re-arms after notifyRead when sendCredit is still 0 — consumer read alone does not cure stall condition"
  - "addSendCredit clears stall timer when sendCredit becomes > 0 — credit grant resolves stall"
metrics:
  duration: "~2min"
  completed: "2026-04-21"
  tasks_completed: 2
  files_created: 0
  files_modified: 2
---

# Phase 02 Plan 02: CreditWindow Summary

**One-liner:** QUIC WINDOW_UPDATE-style CreditWindow with send-side guard, half-HWM CREDIT refresh, configurable stall timeout, and desiredSize seam for Phase 3 WHATWG Streams adapter.

## What Was Built

### src/session/credit-window.ts

Full replacement of the Wave 0 stub. Key behaviors:

- `consumeSendCredit()`: guard-before-decrement prevents negative credit; arms stall timer when credit reaches 0
- `addSendCredit(grant)`: adds to sendCredit, clears stall timer if credit becomes > 0
- `notifyRead()`: decrements recvConsumed (bounded at 0), fires `onCreditNeeded(hwm - recvConsumed)` when `recvConsumed <= floor(hwm / 2)`, re-arms stall timer if sendCredit still 0
- `addRecvConsumed(n)`: increments recv consumed budget (called when a DATA frame arrives)
- `desiredSize` getter: returns `hwm - recvConsumed` — positive means capacity, <=0 means backpressure (SESS-03 seam)
- `destroy()`: clears stall timer unconditionally
- Stall timer disabled when `stallTimeoutMs <= 0`

### tests/unit/session/credit-window.test.ts

21 tests across 5 describe blocks:
- **send side** (6 tests): consume/add mechanics, initial credit default, zero-credit guard
- **receive side / onCreditNeeded** (4 tests): half-HWM threshold, grant calculation, callback suppression above threshold
- **desiredSize** (3 tests): zero recvConsumed, after addRecvConsumed, fully blocked
- **consumer-stall timeout** (5 tests, fake timers): fires after stallTimeoutMs, resets on notifyRead, resets on addSendCredit, disabled when <=0, destroy clears timer
- **property: sendCredit never negative** (1 property test, 500 runs): fast-check with chain arbitrary for init credit + random consume/add sequence

## Verification Results

- `pnpm exec vitest run --project=unit tests/unit/session/credit-window.test.ts` → 21/21 passed
- `pnpm exec tsc --noEmit` → exit 0
- `pnpm exec biome check --write src/session/credit-window.ts` → exit 0, 1 file formatted

## Deviations from Plan

None — plan executed exactly as written. Implementation shape matches the `<implementation>` block in the PLAN.md verbatim.

## Known Stubs

None — `src/session/credit-window.ts` is fully implemented. All exported symbols are complete.

## Self-Check: PASSED
