# Phase 4: Lifecycle Safety + Observability - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning
**Mode:** Auto-generated with grey-area defaults (YOLO)

<domain>
## Phase Boundary

The library detects and cleanly surfaces all channel-death scenarios, and callers can observe stream metrics and errors through typed hooks.

This phase covers:
- **BFCache safety**: listen to `pagehide(persisted=true)` and `pageshow(persisted=true)`; freeze channels on hide, error on show with `CHANNEL_FROZEN` (resumption not safe — state may have drifted)
- **SW recycle detection**: optional heartbeat on ServiceWorker endpoints (ping/pong via a dedicated reserved stream or a non-framing sentinel); surface `CHANNEL_DEAD` after timeout (default 30 s)
- **Endpoint teardown**: port close / worker terminate / iframe unload propagates `CHANNEL_CLOSED` to all active streams; no zombie streams
- **Strong-ref retention**: Channel holds strong refs to MessagePort/Worker/Window + all listeners for the channel lifetime (PITFALLS item 5)
- **Listener cleanup**: on channel close, ALL event listeners registered by the library are removed (no leaks)
- **Observability**:
  - `channel.stats()` → `{ bytesSent, bytesReceived, creditWindow, reorderBufferDepth, frameCountsByType }` per stream + aggregate
  - `channel.on('error', handler)` with typed payload `{ code: ErrorCode, message: string, cause?: unknown }` — covers all named errors from OBS-02
  - `channel.on('trace', handler)` optional per-frame trace event for debugging; opt-in via options (OBS-03)

This phase explicitly does NOT include:
- SAB fast path — Phase 6
- Multi-hop relay — Phase 7
- Multiplexer — Phase 8
- Real browser BFCache testing — Phase 9 (we can mock `pagehide`/`pageshow` events in Node to unit-test the detection logic; the actual BFCache behavior is browser-only and covered in Phase 9)
- Final name, docs, publish — Phase 10

Requirements covered: LIFE-01, LIFE-02, LIFE-03, LIFE-04, LIFE-05, OBS-01, OBS-02, OBS-03.

</domain>

<decisions>
## Implementation Decisions

### BFCache

- Library adds `pagehide` / `pageshow` listener ONLY for `Window` endpoints (the only context where BFCache applies).
- On `pagehide(persisted=true)`: mark channel as `FROZEN`; emit `StreamError { code: 'CHANNEL_FROZEN' }` on all active streams; clear all pending writes.
- On `pageshow(persisted=true)`: no attempt to resume — caller must create a new channel if needed. Channel stays dead.
- Pure `pagehide(persisted=false)` (real navigation): fire `CHANNEL_CLOSED` instead.
- Listener is registered on `globalThis` (which is `window` in browsers, `self` in workers). In workers, `pagehide` doesn't fire — BFCache only applies to the enclosing page. Worker code path is a no-op.

### SW Recycle Heartbeat

- Opt-in via `channel.options.heartbeat = { intervalMs: 10_000, timeoutMs: 30_000 }`. Default: disabled for non-SW endpoints, available for SW endpoints.
- Implementation: Channel-level PING frame type? Or a reserved-streamId OPEN that immediately closes? **Decision:** Reuse CAPABILITY frame as a keep-alive ping — it's idempotent (both sides already handle it on arrival and negotiate to the same cached result). If no response in `timeoutMs`, emit `CHANNEL_DEAD`.
  - Alternative considered: add a `PING` frame type, but that expands the frame protocol beyond the 8 types committed in PROJECT.md. Reusing CAPABILITY avoids protocol change.
- Caveat: CAPABILITY-as-ping slightly conflates "capability negotiation" with "liveness check" — document clearly. If this becomes painful, Phase 6+ can add a dedicated PING frame.

### Teardown

- On endpoint close (MessagePort `close()`, Worker `terminate()`, Window unload, ServiceWorker unregister): detect via `port.onmessageerror`, `addEventListener('close', ...)`, or a generic `onerror` handler; propagate `CHANNEL_CLOSED` to all active streams.
- `channel.close()` explicit call: close all streams, emit `close` event, remove all listeners, release strong refs.

### Observability

- `channel.stats()` is a function, not a live getter — callers poll. Keep the surface small and deterministic.
- Per-stream stats via `stream.stats()` (same shape, scoped to one stream).
- Error events use a standard `EventEmitter`-like API on the channel: `channel.on('error' | 'close' | 'trace', handler)`. Reuse the TypedEmitter from Phase 3 (`src/adapters/emitter.ts`).
- Trace events are off by default; enable via `channel.options.trace = true`. Payload shape: `{ timestamp, direction: 'in' | 'out', frameType, streamId, seq, byteLength? }`.

### Error Taxonomy

Extend `StreamError.ErrorCode` from Phase 3 with the full OBS-02 set:
- `ORIGIN_REJECTED` — from Phase 1 Window adapter (already wired via `onOriginRejected` hook; now routed through channel error event)
- `CREDIT_DEADLOCK` — from CreditWindow stall (already Phase 2, re-routed)
- `REORDER_OVERFLOW` — from ReorderBuffer overflow (already Phase 2, re-routed)
- `PROTOCOL_MISMATCH` — Phase 3 (already in StreamError)
- `DataCloneError` — Phase 3 (already in StreamError)
- `CHANNEL_FROZEN` — new in Phase 4
- `CHANNEL_DEAD` — new in Phase 4
- `CHANNEL_CLOSED` — new in Phase 4

All error codes are string-literal discriminated; `ErrorCode` type is a union of all.

### Testing

- BFCache: mock `pagehide`/`pageshow` events in a Node test via `new EventTarget()` + `dispatchEvent`. Test listener is attached, freeze happens, error propagates. Real browser verification in Phase 9.
- SW recycle: mock a SW endpoint that stops responding mid-channel; use fake timers (Vitest `vi.useFakeTimers()`) to advance past the heartbeat timeout. Assert `CHANNEL_DEAD` fires.
- Teardown: use the MockEndpoint MessageChannel from Phase 3; close one port; assert the other side emits `CHANNEL_CLOSED` on all streams.
- Observability: run a complete small stream, assert `stats()` returns correct counts after completion.

### Claude's Discretion

- Exact internal wiring of existing errors (`ORIGIN_REJECTED`, `CREDIT_DEADLOCK`, `REORDER_OVERFLOW`) into the channel error event. Recommend: Session exposes a `stream.onError(cb)` hook (Phase 2 already exposes via `session.onError`); Channel aggregates into the channel-level `error` event.
- Whether `StreamError` gets a `streamId` field for stream-level errors or it's attached as a meta field — minor.
- Listener registry shape — Map<string, Set<handler>> is fine.

</decisions>

<code_context>
## Existing Code Insights

**Phase 3 artifacts to extend:**
- `src/channel/channel.ts` — already holds strong endpoint ref (LIFE-04 partly done); listener cleanup is partial (PITFALLS item 17); add BFCache + heartbeat + teardown detection
- `src/adapters/emitter.ts` — minimal TypedEmitter, reuse for channel-level events
- `src/types.ts` — extend `ErrorCode` union
- `src/session/index.ts` — already has `onError(cb)` hook; session errors bubble into channel errors

**Phase 2 artifacts:**
- `src/session/credit-window.ts` — stall timer already exists, fires via onError; re-route to channel error event with `CREDIT_DEADLOCK` code
- `src/session/reorder-buffer.ts` — overflow throws; wrap in channel-level catch and re-emit as `REORDER_OVERFLOW`

**Phase 1 artifacts:**
- `src/transport/adapters/window.ts` — already has origin rejection; needs channel-level error routing hook added

**Patterns:**
- ESM + `.js` extensions
- TypeScript 6 + isolatedDeclarations
- Biome + Vitest Node env
- Zero runtime deps

</code_context>

<specifics>
## Specific Ideas

- The BFCache listener must be added ONLY when the endpoint is a `Window`-adapted endpoint. Check the endpoint adapter type or expose a `isWindowAdapter` flag from the adapter.
- Heartbeat ping reuses CAPABILITY frame — if a peer responds to CAPABILITY with `CAPABILITY`, that's both a liveness proof and a no-op renegotiation (both sides already cached min). Document in comments that CAPABILITY-as-keep-alive is intentional.
- `channel.stats()` should be a plain data snapshot, no reactive Proxy or observable. Trace events handle the streaming-observability need.
- Listener cleanup: maintain a `disposers: (() => void)[]` array on the Channel. Every `addEventListener` push a disposer. On close, flush in reverse order.
- For the SW-recycle test: simulate by creating a MessageChannel pair, then `port.close()` on the SW side AND NOT propagating any message — the library heartbeat should fire `CHANNEL_DEAD` after `timeoutMs`.

</specifics>

<deferred>
## Deferred Ideas

- Real browser BFCache verification — Phase 9
- SAB fast path — Phase 6
- Multi-hop relay — Phase 7
- Multiplexing — Phase 8
- Dedicated `PING` frame type if CAPABILITY-as-heartbeat causes issues — future
- Metrics aggregation across channels — out of scope for Phase 4, belongs to consumer's observability stack

</deferred>
