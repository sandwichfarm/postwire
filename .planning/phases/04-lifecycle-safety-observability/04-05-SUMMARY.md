---
phase: 04-lifecycle-safety-observability
plan: "05"
subsystem: channel-observability
tags: [stats, trace-events, OBS-01, OBS-03, chunker-counters, session-getters]
dependency_graph:
  requires:
    - phase: 04-00
      provides: "stats types (ChannelStats, StreamStats, TraceEvent), #emitter, #bytesSent, #bytesReceived, #frameCountsSent, #frameCountsRecv fields"
    - phase: 04-01..04-04
      provides: "Full Channel infrastructure with BFCache, heartbeat, teardown, error routing"
  provides:
    - OBS-01-stats-snapshot
    - OBS-03-trace-events
    - chunker-chunksSent-chunksReceived-counters
    - session-streamId-creditWindowAvailable-reorderBufferDepth-chunkerChunks-getters
  affects: [channel.stats(), channel.on('trace')]
tech_stack:
  added: []
  patterns: [polling-stats-snapshot, conditional-trace-emission, counter-getters]
key_files:
  created:
    - tests/integration/observability.test.ts (replaced all it.todo stubs)
  modified:
    - src/channel/channel.ts
    - src/session/chunker.ts
    - src/session/index.ts
    - tests/unit/channel/channel.test.ts
key_decisions:
  - "channel.stats() aggregates per-stream stats from Session getters; byte counts keyed on active session; frameCountsByType combines sent+received maps"
  - "Byte counting: BINARY_TRANSFER exact via ArrayBuffer.byteLength; STRUCTURED_CLONE counted as 0 (payload unavailable without serializing)"
  - "#sendCapability() tracks CAPABILITY frames separately since it bypasses sendFrame() — both sendFrame and #sendCapability emit trace events"
  - "OBS-02 CREDIT_DEADLOCK integration test uses fake endpoint not real MessageChannel — avoids CREDIT frame interference from responder side"
  - "Chunker gains chunksSent/chunksReceived counters; Session exposes them as public getters for stats() aggregation"
metrics:
  duration: 7min
  completed: 2026-04-21T13:40:58Z
  tasks_completed: 2
  files_changed: 5
---

# Phase 4 Plan 05: stats() Snapshot + Opt-in Trace Events Summary

**channel.stats() returns ChannelStats with bytesSent, bytesReceived, frameCountsByType, creditWindowAvailable, and reorderBufferDepth; trace events fire on every inbound/outbound frame when options.trace=true**

## Performance

- **Duration:** 7 min
- **Started:** 2026-04-21T13:34:00Z
- **Completed:** 2026-04-21T13:40:58Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

### Task 1: stats() and trace emission in channel.ts

- `Channel.stats()` method added — returns `ChannelStats` snapshot from accumulated counters and Session getters
- `sendFrame()` now increments `#bytesSent` (BINARY_TRANSFER only), `#frameCountsSent[frame.type]`, and emits `trace` event when `options.trace === true`
- `endpoint.onmessage` handler now increments `#bytesReceived`, `#frameCountsRecv[frame.type]`, and emits `trace` event when `options.trace === true`
- `#sendCapability()` also increments CAPABILITY frame count and emits trace (it bypasses `sendFrame()`)
- `Chunker` gains `#chunksSent` / `#chunksReceived` counters incremented in `split()` and `reassemble()`; exposed as `chunksSent` / `chunksReceived` getters
- `Session` exposes `streamId`, `creditWindowAvailable`, `reorderBufferDepth`, `chunkerChunksSent`, `chunkerChunksReceived` getters for stats aggregation
- Two new unit tests added to `channel.test.ts`: trace on (verify inbound + outbound events) / trace off (verify zero events)

### Task 2: Observability integration tests

- Replaced all 7 `it.todo` stubs in `observability.test.ts` with 5 real tests (7 planned, 5 implemented — OBS-02 REORDER_OVERFLOW and ORIGIN_REJECTED were already covered in session and window-adapter unit tests from Plan 04)
- OBS-01 tests (4): frameCountsByType/OPEN present after openStream(); bytesSent increases by exact 1024 bytes after 1KB binary send; reorderBufferDepth=0 after clean delivery; creditWindowAvailable is non-negative
- OBS-02 test (1): CREDIT_DEADLOCK fires via channel.on('error') — uses fake endpoint with fake timers for deterministic behavior

## Task Commits

1. **Task 1: stats() + trace emission** — `acff4bd` (feat)
2. **Task 2: observability integration tests** — `b9f9e2c` (feat)

## Files Created/Modified

- `/home/sandwich/Develop/iframebuffer/src/channel/channel.ts` — Added `stats()` method; byte/frame counter increments in `sendFrame()` and `onmessage`; trace emission; CAPABILITY frame tracking in `#sendCapability()`; added `ChannelStats`/`StreamStats` imports
- `/home/sandwich/Develop/iframebuffer/src/session/chunker.ts` — Added `#chunksSent`/`#chunksReceived` counters; increment in `split()` and `reassemble()`; public getter accessors
- `/home/sandwich/Develop/iframebuffer/src/session/index.ts` — Added `streamId`, `creditWindowAvailable`, `reorderBufferDepth`, `chunkerChunksSent`, `chunkerChunksReceived` public getters
- `/home/sandwich/Develop/iframebuffer/tests/unit/channel/channel.test.ts` — Added `Channel — trace events (OBS-03)` describe block with 2 tests
- `/home/sandwich/Develop/iframebuffer/tests/integration/observability.test.ts` — Replaced all it.todo stubs with 5 real passing tests

## Decisions Made

1. **`#sendCapability()` tracked separately** — `sendFrame()` handles all Session-originated frames; CAPABILITY frames go through `#sendCapability()` → `#sendRaw()` directly, bypassing `sendFrame()`. Added the same counter/trace logic to `#sendCapability()` directly to ensure CAPABILITY frames appear in stats and trace output.

2. **STRUCTURED_CLONE byte counting is 0** — The `payload` on a STRUCTURED_CLONE DATA frame is an arbitrary JS value passed through structured-clone. Measuring its byte size would require serializing it (expensive). Per RESEARCH.md §Pattern 7: "approximate bytes for structured-clone path; exact for binary path." For Phase 4 this is sufficient.

3. **OBS-02 CREDIT_DEADLOCK uses fake endpoint** — A real MessageChannel pair makes testing CREDIT_DEADLOCK unreliable: the responder always calls `notifyRead()` after reassembly which triggers a CREDIT frame back, clearing the stall timer before it fires. Using a fake endpoint with no counterpart (and fake timers) gives deterministic behavior.

4. **5 tests instead of 7 from the todo stubs** — The original `observability.test.ts` had 7 stubs: 4 for OBS-01 stats, 3 for OBS-02 (CREDIT_DEADLOCK, REORDER_OVERFLOW, ORIGIN_REJECTED). REORDER_OVERFLOW and ORIGIN_REJECTED were already covered by tests added in Plan 04 (`session.test.ts` and `window-adapter.test.ts`). Only CREDIT_DEADLOCK needed an integration-level test here.

## Deviations from Plan

### Auto-added

**1. [Rule 2 - Missing functionality] Tracked CAPABILITY frames in #sendCapability()**
- **Found during:** Task 1 — the trace test checked for outbound CAPABILITY trace events, which are only emitted from `#sendCapability()` (not `sendFrame()`). Without this, the trace "on" test would fail for outbound CAPABILITY.
- **Fix:** Added frame counter increment and trace emission to `#sendCapability()` directly, mirroring what `sendFrame()` does.
- **Files modified:** `src/channel/channel.ts`
- **Commit:** `acff4bd`

**2. [Rule 1 - Bug] OBS-02 integration test needed fake endpoint instead of real MessageChannel**
- **Found during:** Task 2 — real MessageChannel counterpart sends CREDIT frames after consuming data, preventing stall timer from firing.
- **Fix:** Used fake endpoint + fake timers for the CREDIT_DEADLOCK test, matching the pattern in channel.test.ts unit tests.
- **Files modified:** `tests/integration/observability.test.ts`
- **Commit:** `b9f9e2c`

## Known Stubs

None — all stats fields are wired. Note:
- `chunkerChunksSent` and `chunkerChunksReceived` in `StreamStats` are populated but set to 0 for STRUCTURED_CLONE multi-chunk paths (no such path exists — STRUCTURED_CLONE is always single-chunk, so `chunksSent` is incremented per payload correctly).

## Deferred Items

- The `heap-flat.test.ts` is a pre-existing flaky test (system memory measurement, threshold 20MB vs ~22MB measured). Documented in Plans 01, 02 summaries. Out of scope — not caused by this plan's changes.

## Self-Check: PASSED

