---
phase: 01-scaffold-wire-protocol-foundation
plan: "02"
subsystem: framing
tags: [typescript, wire-protocol, discriminated-union, encode-decode, seq-arithmetic, tdd, vitest]

# Dependency graph
requires:
  - 01-01 (toolchain scaffold — pnpm, TypeScript 6, Vitest 4, Biome 2.4.12)
provides:
  - src/framing/types.ts: 8-type Frame discriminated union, ChunkType, BaseFrame, FRAME_MARKER, PROTOCOL_VERSION
  - src/framing/encode-decode.ts: encode()/decode() pure functions with full validation
  - src/transport/seq.ts: seqLT/seqGT/seqLTE/seqNext/seqMask + SEQ_BITS/SEQ_MASK/HALF_WINDOW
  - tests/unit/framing/encode-decode.test.ts: 40 tests covering all 8 frame types round-trip + null-return
  - tests/unit/transport/seq.test.ts: seq arithmetic tests + 32-value wraparound fuzz
affects: [01-03, 01-04, all downstream plans]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "FRAME_MARKER as string literal ('__ibf_v1__') not Symbol — structured-clone safe"
    - "encode() as identity-function seam — plain objects are the Phase 1 wire format"
    - "decode() try-catch wrapper + null-guard chain — never throws pattern"
    - "TCP-style 32-bit modular seq arithmetic: ((a - b) >>> 0) > HALF_WINDOW"

key-files:
  created:
    - src/framing/types.ts
    - src/framing/encode-decode.ts
    - src/transport/seq.ts
    - tests/unit/framing/encode-decode.test.ts
    - tests/unit/transport/seq.test.ts

key-decisions:
  - "encode() is identity function in Phase 1 — frames are already structured-clone-friendly plain objects; function exists as seam for future binary encoding"
  - "decode() wraps entire body in try-catch as belt-and-suspenders; primary null-return path via explicit null-guards never throws anyway"
  - "FRAME_MARKER is the string '__ibf_v1__' (not Symbol) per RESEARCH.md: Symbols are silently dropped by postMessage structured-clone"
  - "All 8 frame types included (not 7): CAPABILITY is required by PROTO-04/PROTO-05; CONTEXT.md/REQUIREMENTS.md count discrepancy is a doc error"
  - "Biome useLiteralKeys rule converted m['type'] → m.type throughout decode() — functionally equivalent, Biome-idiomatic"

# Metrics
duration: 3min
completed: 2026-04-21T10:09:17Z
---

# Phase 01 Plan 02: Wire Protocol Framing Layer Summary

**8-type Frame discriminated union with FRAME_MARKER sentinel, encode()/decode() pure functions, and TCP-style 32-bit wraparound-safe seq arithmetic — 40 unit tests all green**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-21T10:06:25Z
- **Completed:** 2026-04-21T10:09:17Z
- **Tasks:** 2
- **Files created:** 5

## Accomplishments

- Complete wire protocol type layer: 8-type Frame discriminated union with all required fields, FRAME_MARKER string sentinel, PROTOCOL_VERSION constant
- encode()/decode() pure functions: encode is identity seam, decode validates marker + base fields + type-specific fields and never throws
- ChunkType covers all 4 variants: BINARY_TRANSFER, STRUCTURED_CLONE, STREAM_REF, SAB_SIGNAL (PROTO-03)
- CapabilityFrame carries protocolVersion + sab + transferableStreams (PROTO-04, PROTO-05)
- seqLT/seqGT wraparound fuzz passes all 32 values through the 0xFFFFFFF0 → 0 wrap point
- 40/40 unit tests pass; pnpm exec tsc --noEmit exits 0; pnpm exec biome check exits 0 on all new files

## Task Commits

1. **Task 1: Define Frame discriminated union types and sequence arithmetic** — `6dff0fb`
   - src/framing/types.ts — 8-type union, ChunkType, BaseFrame, FRAME_MARKER, PROTOCOL_VERSION
   - src/transport/seq.ts — seqLT/seqGT/seqLTE/seqNext/seqMask + constants

2. **Task 2: Implement encode/decode and write full unit test suite** — `0492103`
   - src/framing/encode-decode.ts — encode/decode implementation
   - tests/unit/framing/encode-decode.test.ts — 40 tests (8 round-trip + null-return suite)
   - tests/unit/transport/seq.test.ts — seq unit tests + 32-value wraparound fuzz

## Frame Type Shapes (all 8)

| Type | Discriminant | Extra Fields |
|------|-------------|--------------|
| OpenFrame | `type: 'OPEN'` | `initCredit: number` |
| OpenAckFrame | `type: 'OPEN_ACK'` | `initCredit: number` |
| DataFrame | `type: 'DATA'` | `chunkType: ChunkType`, `payload: unknown`, `isFinal: boolean` |
| CreditFrame | `type: 'CREDIT'` | `credit: number` |
| CloseFrame | `type: 'CLOSE'` | `finalSeq: number` |
| CancelFrame | `type: 'CANCEL'` | `reason: string` |
| ResetFrame | `type: 'RESET'` | `reason: string` |
| CapabilityFrame | `type: 'CAPABILITY'` | `protocolVersion: number`, `sab: boolean`, `transferableStreams: boolean` |

All extend `BaseFrame` which carries: `[FRAME_MARKER]: 1`, `channelId: string`, `streamId: number`, `seqNum: number`

## encode/decode Design

**encode():** Identity function in Phase 1. Returns `frame as unknown as Record<string, unknown>`. Frames are already structured-clone-friendly plain objects — no ArrayBuffer packing needed. The function is a seam: if Phase 5 benchmarks justify a binary wire format, the seam exists without breaking callers.

**decode():** Never throws. Validation chain:
1. Null/non-object guard
2. `m[FRAME_MARKER] !== 1` → null
3. `typeof m.type !== 'string'` → null  
4. BaseFrame fields: `channelId`, `streamId`, `seqNum` type checks
5. Switch on `type` with type-specific field checks
6. `default:` branch → null
7. Outer `try-catch` as belt-and-suspenders

## Seq Arithmetic Algorithm

```
HALF_WINDOW = 0x8000_0000  // 2^31

seqLT(a, b) = (seqMask(a) - seqMask(b)) >>> 0 > HALF_WINDOW
seqNext(n)  = (n + 1) >>> 0
```

TCP-style modular comparison. At the 0xFFFFFFFF → 0 wrap point:
- `seqLT(0xFFFFFFFF, 0)` = `((0xFFFFFFFF - 0) >>> 0) > 0x80000000` = `0xFFFFFFFF > 0x80000000` = true ✓
- `seqLT(0, 0xFFFFFFFF)` = `((0 - 0xFFFFFFFF) >>> 0) > 0x80000000` = `1 > 0x80000000` = false ✓

The 32-value fuzz test from `0xFFFFFFF0` through `0x0000000F` exercises every transition across the wrap point.

## Test Count

| File | Tests | Result |
|------|-------|--------|
| tests/unit/framing/encode-decode.test.ts | 24 | All pass |
| tests/unit/transport/seq.test.ts | 16 | All pass |
| **Total** | **40** | **40/40 green** |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Biome useLiteralKeys lint errors in decode()**
- **Found during:** Task 2 lint check
- **Issue:** Biome 2.4.12 `complexity/useLiteralKeys` rule flags `m["type"]`, `m["channelId"]` etc. as violations when plain property access `m.type`, `m.channelId` is equivalent
- **Fix:** Applied `biome check --write --unsafe` to convert all bracket notation to dot notation in encode-decode.ts; also fixed import ordering in all new files
- **Files modified:** src/framing/encode-decode.ts, src/framing/types.ts, src/transport/seq.ts, tests/unit/framing/encode-decode.test.ts
- **Verification:** `biome check` exits 0 on all new files; tests still 40/40 passing

**2. [Rule 2 - Missing Critical] Added try-catch wrapper to decode()**
- **Found during:** Task 2 implementation (plan acceptance criterion check)
- **Issue:** Plan acceptance criteria require "decode() has a try-catch wrapping the switch OR all branches are null-safe (no throw possible)" — added outer try-catch as belt-and-suspenders even though null-guard chain already prevents throws in normal execution
- **Fix:** Wrapped decode() body in try-catch returning null on any caught error
- **Files modified:** src/framing/encode-decode.ts

## Known Stubs

None. All files in this plan implement complete, non-stub functionality.
- `encode()` is intentionally an identity function in Phase 1 per plan design (seam for future binary encoding, not a stub)
- `decode()` validates all required fields for all 8 frame types

## Self-Check: PASSED

All 5 created files confirmed present. All 2 task commits confirmed in git log.

| Check | Status |
|-------|--------|
| src/framing/types.ts | FOUND |
| src/framing/encode-decode.ts | FOUND |
| src/transport/seq.ts | FOUND |
| tests/unit/framing/encode-decode.test.ts | FOUND |
| tests/unit/transport/seq.test.ts | FOUND |
| commit 6dff0fb | FOUND |
| commit 0492103 | FOUND |

---
*Phase: 01-scaffold-wire-protocol-foundation*
*Completed: 2026-04-21*
