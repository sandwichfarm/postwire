---
phase: 02-session-protocol-core
plan: "04"
subsystem: session/fsm
tags: [fsm, pure-reducer, tdd, property-testing, fast-check, wave-1]
dependency_graph:
  requires:
    - 02-00 (stubs created; fast-check installed)
  provides:
    - src/session/fsm.ts (transition, StreamState, StreamEvent, IllegalTransitionError, isTerminalState, TERMINAL_STATES)
  affects:
    - 02-05 (Session entity wires FSM via transition())
    - Any consumer that calls isTerminalState() to guard post-terminal events
tech_stack:
  added: []
  patterns:
    - Pure reducer function (not class method) for direct property test importability
    - ReadonlySet<StreamState> for isolatedDeclarations-compatible TERMINAL_STATES export
    - IllegalTransitionError with .state and .eventType fields for structured error handling
    - fast-check property suite: never-undefined (1000 runs) + terminal-absorbing (500 runs)
key_files:
  created: []
  modified:
    - src/session/fsm.ts
    - tests/unit/session/fsm.test.ts
decisions:
  - "ReadonlySet<StreamState> chosen over Set<StreamState> for TERMINAL_STATES — stronger type signal that the set is never mutated"
  - "IllegalTransitionError exposes .state and .eventType readonly fields so Session can pattern-match on error without string parsing"
  - "switch/break pattern over nested if-else tree — exhaustiveness enforced by trailing throw after each case"
metrics:
  duration: "~5min"
  completed: "2026-04-21"
  tasks_completed: 2
  files_created: 0
  files_modified: 2
---

# Phase 02 Plan 04: FSM Transition Reducer Summary

**One-liner:** Pure `transition(state, event): StreamState` reducer with 28-row table, `IllegalTransitionError` with structured fields, and fast-check property suite asserting terminal absorption and no-undefined-state invariants.

## What Was Built

### `src/session/fsm.ts`

Full replacement of the Wave 0 stub. The module has zero imports — it is a pure TypeScript module with no dependencies.

**Exports:**
- `StreamState` — union type of 9 states: `IDLE | OPENING | OPEN | LOCAL_HALF_CLOSED | REMOTE_HALF_CLOSED | CLOSING | CLOSED | ERRORED | CANCELLED`
- `StreamEvent` — discriminated union of 14 event types covering open/ack/data/close/cancel/reset/final/stall
- `IllegalTransitionError` — `Error` subclass with `.state: StreamState` and `.eventType: string` readonly fields
- `TERMINAL_STATES` — `ReadonlySet<StreamState>` containing `CLOSED`, `ERRORED`, `CANCELLED`
- `isTerminalState(state): boolean` — predicate backed by `TERMINAL_STATES`
- `transition(state, event): StreamState` — pure reducer; throws `IllegalTransitionError` for all invalid pairs

**Implementation pattern:** `switch (state)` over 6 non-terminal cases, each using `if (event.type === ...)` guards with early returns. Each case falls through to the trailing `throw new IllegalTransitionError(state, event)` for unmatched events. The three terminal states (`CLOSED`, `ERRORED`, `CANCELLED`) are handled in a combined case that throws immediately.

### `tests/unit/session/fsm.test.ts`

Full replacement of the Wave 0 scaffold. 65 tests across 5 describe blocks:

| Describe block | Tests | Coverage |
|---|---|---|
| `FSM valid transitions` | 28 | One `it()` per table row; exhaustive |
| `FSM terminal states throw on any event` | 12 | 3 terminals × 4 events each |
| `FSM invalid transitions` | 9 | 8 illegal pairs + error field validation |
| `CANCEL vs RESET semantics` | 5 | Direction/semantic distinction |
| `isTerminalState` | 9 | All 9 states |
| `property: FSM — TEST-06` | 3 | fast-check: never-undefined (1000), terminal-absorbing (500), valid-result (500) |

## Verification Results

- `pnpm exec vitest run --project=unit tests/unit/session/fsm.test.ts` → 65/65 passed
- `pnpm exec tsc --noEmit` → exit 0
- `pnpm exec biome check --write src/session/fsm.ts` → no fixes applied (clean)
- `pnpm exec biome check --write tests/unit/session/fsm.test.ts` → import order sorted (auto-fixed, tests still pass)

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written. The implementation matches the pseudocode in the plan verbatim. One note: `TERMINAL_STATES` was changed from `Set<StreamState>` (plan) to `ReadonlySet<StreamState>` (implementation) per the isolatedDeclarations pattern established in 02-00 and for stronger type safety. This is a tightening of the type, not a behavioral change.

## Known Stubs

None. `transition()` is fully implemented with all 28 valid rows and complete terminal absorption. `IllegalTransitionError`, `isTerminalState`, `TERMINAL_STATES`, `StreamState`, and `StreamEvent` are all non-stub exports.

## Self-Check: PASSED
