---
phase: 02-session-protocol-core
plan: "03"
subsystem: session
tags: [chunker, binary-transfer, structured-clone, metadata-before-transfer, tdd]
dependency_graph:
  requires:
    - src/framing/types.ts (DataFrame, ChunkType, FRAME_MARKER)
    - src/transport/seq.ts (seqNext)
    - src/session/chunker.ts (stub from 02-00)
  provides:
    - src/session/chunker.ts (Chunker, ChunkerOptions, ChunkResult)
    - tests/unit/session/chunker.test.ts (20 unit tests for SESS-04)
  affects:
    - 02-05 (Session entity wires Chunker)
    - Phase 3 (Transport layer calls split/reassemble)
tech_stack:
  added: []
  patterns:
    - metadata-before-transfer invariant: all metadata captured into locals before any ArrayBuffer slice
    - ab.slice() per chunk — original buffer never in transfer list; Transport transfers each slice
    - Map<streamId, ArrayBuffer[]> reassembly keyed by streamId
    - seqNext() for all sequence increments (wraparound safe at 0xFFFFFFFF→0)
key_files:
  created: []
  modified:
    - src/session/chunker.ts
    - tests/unit/session/chunker.test.ts
decisions:
  - "ab.slice() creates a copy per chunk — original ArrayBuffer is never placed in a transfer list; Transport transfers each slice individually. This is safer than slice-by-view because the original is never detached."
  - "Reassembly map uses streamId as key (not seqNum) — chunker is per-stream, but key allows future multi-stream support without API change."
  - "Non-null assertions replaced with local-variable pattern (let bufs = map.get(id); if undefined, create and set) — Biome noNonNullAssertion compliant."
metrics:
  duration: "~2min"
  completed: "2026-04-21"
  tasks_completed: 1
  files_created: 0
  files_modified: 2
---

# Phase 02 Plan 03: Chunker Summary

**One-liner:** `Chunker` splits ArrayBuffer payloads into maxChunkSize-bounded slices (default 64 KB) with metadata captured before any slice operation, and reassembles chunks by streamId on the receive side — implementing the metadata-before-transfer invariant from PITFALLS.md §Pitfall 2.

## What Was Built

### `src/session/chunker.ts`

Full replacement of the Wave 0 stub. Exports `Chunker`, `ChunkerOptions`, `ChunkResult`.

**`split(payload, chunkType)`** — returns `ChunkResult[]`:

- **BINARY_TRANSFER path:** Coerces payload to `ArrayBuffer`, captures `total = ab.byteLength` first, then loops with `ab.slice(offset, offset + chunkSize)`. All metadata (`isFinal`, `seq`, `chunkType`) are local variables captured before the slice is created. Each slice goes into `transfer: [slice]`. The original buffer is never in any transfer list.
- **STRUCTURED_CLONE path:** Single chunk, `transfer: []`, `isFinal: true`. No detach concern — structured-clone algorithm copies the object inside `postMessage`.
- Sequence numbers use `seqNext()` for every increment — 32-bit wraparound safe.
- Default `maxChunkSize`: 65 536 bytes (64 KB).

**`reassemble(frame)`** — returns `unknown | null`:

- STRUCTURED_CLONE: returns `frame.payload` immediately on isFinal.
- BINARY_TRANSFER: accumulates `ArrayBuffer` slices in `Map<streamId, ArrayBuffer[]>`. Returns null until isFinal. On isFinal, concatenates all slices via `Uint8Array.set()`, deletes map entry, returns result.

### `tests/unit/session/chunker.test.ts`

20 tests across 5 describe blocks:

| Describe | Tests | What it covers |
|---|---|---|
| `Chunker split — BINARY_TRANSFER` | 5 | exact-size, +1 byte, 3x, seqNums, slice sizes |
| `Chunker split — STRUCTURED_CLONE` | 3 | payload identity, isFinal, seqNum advance |
| `sequence numbers` | 3 | initSeq=0, second=seqNext(0), wraparound 0xFFFFFFFE→0 |
| `metadata-before-transfer invariant` | 2 | byteLength capturable before transfer; metadata re-read returns correct values |
| `Chunker reassemble` | 7 | null on non-final, concat on final, map cleared, multi-chunk, STRUCTURED_CLONE direct, out-of-order (in-order insertion) |

## Verification Results

- `pnpm exec vitest run --project=unit tests/unit/session/chunker.test.ts` → 20/20 passed
- `pnpm exec tsc --noEmit` → exit 0
- `pnpm exec biome check --write src/session/chunker.ts` → no fixes applied (clean)
- `pnpm test` → 176/176 tests passed (9 test files)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript error: ArrayBuffer | SharedArrayBuffer type mismatch**
- **Found during:** GREEN phase, tsc --noEmit
- **Issue:** `(payload as ArrayBufferView).buffer` has type `ArrayBuffer | SharedArrayBuffer` in TypeScript; the frame's transfer list expects `ArrayBuffer[]`
- **Fix:** Added explicit `ArrayBuffer` type annotation: `const ab: ArrayBuffer = ... ((payload as ArrayBufferView).buffer as ArrayBuffer)`
- **Files modified:** `src/session/chunker.ts`
- **Commit:** f32122f (same task commit)

**2. [Rule 1 - Bug] Replaced non-null assertions with local-variable pattern**
- **Found during:** Biome check after GREEN
- **Issue:** `this.#reassemblyBufs.get(streamId)!` — Biome `noNonNullAssertion` warning
- **Fix:** `let bufs = this.#reassemblyBufs.get(streamId); if (bufs === undefined) { bufs = []; this.#reassemblyBufs.set(streamId, bufs); }` — eliminates assertions, still logically correct
- **Files modified:** `src/session/chunker.ts`
- **Commit:** f32122f (same task commit)

## Known Stubs

None. This plan fully implements the Chunker. No placeholder data, no TODO markers.

## Self-Check: PASSED
