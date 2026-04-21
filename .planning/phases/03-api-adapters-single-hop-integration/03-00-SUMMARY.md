---
phase: 03-api-adapters-single-hop-integration
plan: "00"
subsystem: testing
tags: [vitest, node-worker-threads, message-channel, typescript, session]

# Dependency graph
requires:
  - phase: 02-session-protocol-core
    provides: Session class with close(), onFrameOut(), sendData() — patched close() here

provides:
  - tests/helpers/mock-endpoint.ts — createMessageChannelPair() backed by real Node MessageChannel
  - src/channel/ directory (empty, ready for Wave 1 channel.ts)
  - src/adapters/ directory (empty, ready for Wave 1 adapter files)
  - tests/unit/channel/ and tests/unit/adapters/ directories (empty, ready for Wave 1 tests)
  - tests/integration/ directory (empty, ready for integration tests)
  - Session.close(finalSeq?: number) — optional finalSeq parameter for correct CLOSE frame emission
  - vitest.config.ts extended to include tests/integration/**

affects:
  - 03-01-channel
  - 03-02-lowlevel
  - 03-03-emitter
  - 03-04-streams
  - 03-05-mock-endpoint-tests

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "MockEndpoint: node:worker_threads MessageChannel cast to PostMessageEndpoint — no wrapper needed"
    - "TDD RED/GREEN: test file at tests/unit/session/session-close-finalseq.test.ts"
    - "vitest.config.ts unit project include covers both unit and integration test dirs"

key-files:
  created:
    - tests/helpers/mock-endpoint.ts
    - tests/unit/channel/.gitkeep
    - tests/unit/adapters/.gitkeep
    - tests/integration/.gitkeep
    - src/channel/.gitkeep
    - src/adapters/.gitkeep
    - tests/unit/session/session-close-finalseq.test.ts
  modified:
    - vitest.config.ts
    - src/session/index.ts

key-decisions:
  - "Node MessagePort from node:worker_threads is cast as unknown as PostMessageEndpoint — no wrapper layer needed; onmessage= auto-starts in Node 22"
  - "Session.close(finalSeq = 0) uses default parameter not overloads — keeps the type (finalSeq?: number) => void with full backward compat"
  - "Integration tests run in same vitest unit project (Node env) — no new project entry needed, just extended include glob"

patterns-established:
  - "MockEndpoint pattern: cast MessagePort to PostMessageEndpoint via as unknown as"
  - "close(finalSeq = 0) default-param pattern for backward-compat optional numeric param"

requirements-completed: [TEST-02, TOPO-01]

# Metrics
duration: 2min
completed: 2026-04-21
---

# Phase 03 Plan 00: Scaffold Summary

**Phase 3 directory scaffold + MockEndpoint helper + Session.close(finalSeq?) patch enabling correct CLOSE frame emission from the Channel layer**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-21T12:10:54Z
- **Completed:** 2026-04-21T12:13:12Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- Created src/channel/ and src/adapters/ directories for Wave 1 Channel and adapter implementations
- Created tests/helpers/mock-endpoint.ts with createMessageChannelPair() backed by real Node MessageChannel — provides structured-clone + ArrayBuffer transfer semantics for integration tests
- Patched Session.close() to accept optional finalSeq parameter (default 0) so the Channel layer can pass the last DATA seqNum in the CLOSE frame
- Extended vitest.config.ts unit project include to cover tests/integration/**
- All 198 tests pass (194 pre-existing + 4 new finalSeq TDD tests)

## Task Commits

Each task was committed atomically:

1. **Task 1: Directory scaffold, MockEndpoint, vitest config** - `700f561` (feat)
2. **Task 2 RED: Failing finalSeq tests** - `3770609` (test)
3. **Task 2 GREEN: Session.close(finalSeq?) patch** - `fae3735` (feat)

_Note: TDD task 2 has two commits (RED test + GREEN implementation)_

## Files Created/Modified

- `tests/helpers/mock-endpoint.ts` — createMessageChannelPair() returning MockEndpointPair with real MessageChannel semantics
- `tests/unit/channel/.gitkeep` — placeholder for Wave 1 channel unit tests
- `tests/unit/adapters/.gitkeep` — placeholder for Wave 1 adapter unit tests
- `tests/integration/.gitkeep` — placeholder for integration tests
- `src/channel/.gitkeep` — placeholder for Channel implementation
- `src/adapters/.gitkeep` — placeholder for adapter implementations
- `tests/unit/session/session-close-finalseq.test.ts` — 4 TDD tests for Session.close(finalSeq?)
- `vitest.config.ts` — extended unit project include to cover tests/integration/**
- `src/session/index.ts` — Session.close() signature changed from close(): void to close(finalSeq = 0): void

## Decisions Made

- **Node MessagePort cast pattern:** Node's MessagePort from node:worker_threads fully satisfies PostMessageEndpoint without any wrapper. The cast `port as unknown as PostMessageEndpoint` is the correct approach — confirmed by research that postMessage() and onmessage getter/setter are both present and compatible.
- **Default parameter over overload:** `close(finalSeq = 0)` chosen over explicit overloads — simpler, backward compatible, TypeScript infers `(finalSeq?: number) => void` correctly with isolatedDeclarations.
- **Single vitest project for integration:** Extended the existing `unit` project's include glob rather than adding a new project. All Phase 3 integration tests run in Node environment (no browser needed for MockEndpoint-backed tests).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Wave 1 can begin: src/channel/ and src/adapters/ directories exist
- createMessageChannelPair() is available for all integration tests
- Session.close(finalSeq) accepts the Channel layer's lastDataSeqOut value
- vitest.config.ts picks up tests/integration/** automatically

---
*Phase: 03-api-adapters-single-hop-integration*
*Completed: 2026-04-21*

## Self-Check: PASSED

- FOUND: tests/helpers/mock-endpoint.ts
- FOUND: tests/unit/channel/.gitkeep
- FOUND: tests/unit/adapters/.gitkeep
- FOUND: tests/integration/.gitkeep
- FOUND: src/channel/.gitkeep
- FOUND: src/adapters/.gitkeep
- FOUND: 03-00-SUMMARY.md
- FOUND: commit 700f561 (scaffold)
- FOUND: commit 3770609 (RED tests)
- FOUND: commit fae3735 (GREEN implementation)
- FOUND: tests/integration in vitest.config.ts
- FOUND: finalSeq in src/session/index.ts
- FOUND: createMessageChannelPair export in mock-endpoint.ts
