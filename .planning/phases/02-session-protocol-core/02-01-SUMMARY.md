---
phase: 02-session-protocol-core
plan: "01"
subsystem: session
tags: [reorder-buffer, tdd, fast-check, wraparound, sess-01, sess-06]
dependency_graph:
  requires:
    - src/transport/seq.ts (seqLT, seqNext — Phase 1)
    - src/framing/types.ts (DataFrame — Phase 1)
    - fast-check@^4.7.0 (devDep — installed in 02-00)
  provides:
    - src/session/reorder-buffer.ts (ReorderBuffer, ReorderBufferOptions)
  affects:
    - 02-05 (Session entity wires ReorderBuffer on receive path)
tech_stack:
  added: []
  patterns:
    - Map-backed in-order delivery with seqLT wraparound-safe comparison
    - TDD RED→GREEN: failing tests committed before implementation
    - fast-check shuffledSubarray property for wraparound fuzz
    - Private class fields (#buffer, #nextExpected, #maxBuffer) for encapsulation
key_files:
  created: []
  modified:
    - src/session/reorder-buffer.ts
    - tests/unit/session/reorder-buffer.test.ts
decisions:
  - "seqLT from Phase 1 seq.ts for all comparisons — never raw < or > to avoid wraparound corruption"
  - "Map<number, DataFrame> for O(1) insert/lookup vs Array with binary search"
  - "Capacity overflow check (buffer.size >= maxBuffer) before buffering new out-of-order frame"
  - "Duplicate key in buffer dropped silently (has() check before buffering)"
  - "Non-null assertion guarded by has() in drain loop — Biome warning but exits 0"
metrics:
  duration: "~2min"
  completed: "2026-04-21"
  tasks_completed: 1
  files_created: 0
  files_modified: 2
---

# Phase 02 Plan 01: ReorderBuffer Summary

**One-liner:** Map-backed ReorderBuffer with seqLT wraparound-safe delivery, capacity overflow detection, and fast-check SESS-06 property fuzz across the 0xFFFFFFF0 boundary.

## What Was Built

### src/session/reorder-buffer.ts

Full replacement of the Wave 0 stub. The `ReorderBuffer` class uses a `Map<number, DataFrame>` for O(1) insert/lookup by sequence number. Key behaviors:

- **In-order delivery:** When the inserted frame equals `nextExpected`, it is immediately returned and the drain loop runs: consecutive buffered frames are popped from the Map and returned in sequence until a gap is found.
- **Out-of-order buffering:** Frames ahead of `nextExpected` are stored in the Map. Buffer capacity is enforced at `maxReorderBuffer` (default 64).
- **Overflow:** When `buffer.size >= maxReorderBuffer` and a new out-of-order frame arrives, throws `Error('REORDER_OVERFLOW')`.
- **Stale drop:** `seqLT(seq, nextExpected)` catches all already-delivered frames including those that look "larger" due to 32-bit wraparound.
- **Duplicate key drop:** If the same seqNum is inserted twice while out-of-order, the second is a no-op returning `[]`.
- **seqNext() for counter:** Never uses `+ 1` directly — all increments go through `seqNext()` which handles `0xFFFFFFFF → 0`.

### tests/unit/session/reorder-buffer.test.ts

13 tests across 6 `describe` blocks:

| Block | Tests | Coverage |
|-------|-------|---------|
| in-order delivery | 3 | basic insert, nextExpected advance, out-of-order returns [] |
| out-of-order buffering | 2 | gap fill flushes all consecutive, partial flush then drain |
| overflow | 3 | maxReorderBuffer exceeded, exactly at limit, default 64 |
| duplicate detection | 3 | seqLT stale, post-delivery stale, duplicate key in buffer |
| wraparound deterministic | 1 | 32 frames across 0xFFFFFFF0, post-wrap buffered then pre-wrap delivered |
| fast-check fuzz SESS-06 | 1 | 200 runs shuffled all 32 seqs, all delivered exactly once in order |

## Verification Results

- `pnpm exec vitest run --project=unit tests/unit/session/reorder-buffer.test.ts` → 13/13 passed
- `pnpm exec tsc --noEmit` → exit 0
- `pnpm exec biome check ...` → exit 0 (1 warning: noNonNullAssertion, guarded by `.has()`)

## Deviations from Plan

None — plan executed exactly as written. Implementation matches the Pattern 1 spec from RESEARCH.md with the duplicate-key check from PLAN.md behavior spec.

## Known Stubs

None — all logic implemented and tested.

## Self-Check: PASSED
