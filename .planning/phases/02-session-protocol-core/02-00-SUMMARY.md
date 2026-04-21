---
phase: 02-session-protocol-core
plan: "00"
subsystem: session
tags: [scaffold, fast-check, wave-0, tdd-setup]
dependency_graph:
  requires: []
  provides:
    - src/session/reorder-buffer.ts (ReorderBuffer stub)
    - src/session/credit-window.ts (CreditWindow stub)
    - src/session/chunker.ts (Chunker stub)
    - src/session/fsm.ts (StreamState / StreamEvent / transition stubs)
    - src/session/index.ts (Session stub)
    - tests/unit/session/*.test.ts (5 scaffold test files)
  affects:
    - Wave 1 plans (02-01 through 02-04) — each owns one stub file with no conflicts
    - Wave 2 plan (02-05) — Session entity implementation
tech_stack:
  added:
    - fast-check@^4.7.0 (devDependency — property/fuzz testing)
  patterns:
    - Export stubs with constructor signatures matching planned implementations
    - Scaffold tests: single passing `typeof === 'function'` assertion per class
    - isolatedDeclarations: explicit type annotation on Set<StreamState> export
key_files:
  created:
    - src/session/reorder-buffer.ts
    - src/session/credit-window.ts
    - src/session/chunker.ts
    - src/session/fsm.ts
    - src/session/index.ts
    - tests/unit/session/reorder-buffer.test.ts
    - tests/unit/session/credit-window.test.ts
    - tests/unit/session/chunker.test.ts
    - tests/unit/session/fsm.test.ts
    - tests/unit/session/session.test.ts
  modified:
    - package.json (fast-check devDependency added)
    - pnpm-lock.yaml
decisions:
  - "fast-check added as devDependency at ^4.7.0 per COMP-02 (zero runtime deps)"
  - "TERMINAL_STATES exported as Set<StreamState> with explicit annotation for isolatedDeclarations compatibility"
  - "noUselessConstructor Biome warnings are info-only (exit 0); stubs retain constructors intentionally for Wave 1 to fill"
metrics:
  duration: "~5min"
  completed: "2026-04-21"
  tasks_completed: 1
  files_created: 10
  files_modified: 2
---

# Phase 02 Plan 00: Session Scaffold Summary

**One-liner:** fast-check devDep installed and five Wave 0 stub files created in `src/session/` with matching scaffold tests in `tests/unit/session/`, unblocking parallel Wave 1 implementation.

## What Was Built

Wave 0 gate: all file-ownership slots for Phase 2 are claimed, preventing merge conflicts when Wave 1 tasks run in parallel. Each Wave 1 plan now has exactly one source file and one test file to own.

### fast-check installation

`pnpm add -D fast-check@^4.7.0` — appears in `devDependencies` only. Verified not in `dependencies` (COMP-02 compliant). Required by TEST-06 (property/fuzz tests for FSM and wraparound).

### Source stubs (`src/session/`)

| File | Exports | Wave owner |
|------|---------|-----------|
| `reorder-buffer.ts` | `ReorderBuffer`, `ReorderBufferOptions` | 02-01 |
| `credit-window.ts` | `CreditWindow`, `CreditWindowOptions` | 02-02 |
| `chunker.ts` | `Chunker`, `ChunkerOptions`, `ChunkResult` | 02-03 |
| `fsm.ts` | `StreamState`, `StreamEvent`, `IllegalTransitionError`, `TERMINAL_STATES`, `isTerminalState`, `transition` | 02-04 |
| `index.ts` | `Session`, `SessionOptions` + re-exports from all four above | 02-05 |

All stubs: typecheck (`tsc --noEmit` exits 0), Biome clean (exits 0), import-compatible with each other.

### Test scaffolds (`tests/unit/session/`)

Five scaffold files each with a single passing assertion (`expect(typeof ClassName).toBe('function')`). Wave 1 plans write real tests alongside their implementations; these scaffolds establish the import paths and confirm module loading is not broken.

## Verification Results

- `grep "fast-check" package.json` → `"fast-check": "^4.7.0"` in `devDependencies`
- `ls src/session/` → 5 files: reorder-buffer.ts, credit-window.ts, chunker.ts, fsm.ts, index.ts
- `ls tests/unit/session/` → 5 files
- `pnpm exec tsc --noEmit` → exit 0
- `pnpm test` → 62/62 tests passed (9 test files)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical annotation] Added explicit type on TERMINAL_STATES export**
- **Found during:** Task 1, Step 4 (tsc --noEmit)
- **Issue:** `export const TERMINAL_STATES = new Set<StreamState>(...)` — TypeScript 6 with `isolatedDeclarations: true` requires an explicit type annotation on exported variables; the inferred `Set<StreamState>` was not accepted
- **Fix:** Changed to `export const TERMINAL_STATES: Set<StreamState> = new Set<StreamState>([...])`
- **Files modified:** `src/session/fsm.ts`
- **Commit:** 996cce3 (same task commit)

None other — plan executed with one inline fix.

## Known Stubs

All files in `src/session/` are intentional stubs:

| File | Stub type | Resolving plan |
|------|-----------|---------------|
| `src/session/reorder-buffer.ts` | Empty method bodies, no real logic | 02-01 |
| `src/session/credit-window.ts` | Empty method bodies, no real logic | 02-02 |
| `src/session/chunker.ts` | Empty method bodies, no real logic | 02-03 |
| `src/session/fsm.ts` | `transition()` always throws; no real FSM | 02-04 |
| `src/session/index.ts` | `Session` has no real wiring | 02-05 |

These stubs are **intentional** — this is a Wave 0 gate plan. The stubs exist to prevent TypeScript import errors when Wave 1 tasks partially implement their modules. They are not regressions.

## Self-Check: PASSED
