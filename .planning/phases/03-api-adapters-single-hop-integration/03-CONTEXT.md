# Phase 3: API Adapters + Single-Hop Integration - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning
**Mode:** Auto-generated with grey-area defaults (YOLO)

<domain>
## Phase Boundary

All three public API surfaces (low-level / EventEmitter / WHATWG Streams) are implemented, and the library streams data end-to-end over a real postMessage boundary in a single-hop topology — proven against a real `MessageChannel`-backed endpoint.

This phase covers:
- `src/channel/channel.ts` — a `Channel` that pairs a `PostMessageEndpoint` with the `Session` from Phase 2; encodes outbound frames, decodes inbound, honors capability negotiation (capability handshake emits a CAPABILITY frame on channel open)
- `src/adapters/lowlevel.ts` — `send(chunk, transfer?) / onChunk(cb) / close()` — thin façade over `Channel`, the primitive all higher-level adapters compose on
- `src/adapters/emitter.ts` — Node-style EventEmitter (`.on('data' | 'end' | 'error' | 'close' | 'drain')`, `.write(chunk)`, `.end()`). Pure JS, zero deps. Not `require('events')` — we can't assume Node built-ins in browser builds. Ship a tiny in-module emitter.
- `src/adapters/streams.ts` — WHATWG Streams `{ readable: ReadableStream, writable: WritableStream }` with `desiredSize` wired to the credit window (SESS-03 pays off here). `WritableStream.write()` awaits credits; `ReadableStream.pull()` resolves when data is available; backpressure propagates end-to-end.
- MockEndpoint harness (test-only) — wraps a `MessageChannel` pair to satisfy `PostMessageEndpoint`; lets integration tests exercise real structured-clone + Transferable semantics without spawning a browser.
- Integration tests: low-level send/receive of an ArrayBuffer with source-detach proof; WHATWG Streams 16 MB ArrayBuffer pipe with backpressure; EventEmitter data/drain; heap-flat slow-consumer test (credit wiring proof); `DataCloneError` surfacing as typed WritableStream error.
- `src/index.ts` re-exports the three adapter entry points and the `Channel` + `createChannel` helper.

This phase explicitly does NOT include:
- Real Window/iframe/cross-origin browser tests — Phase 9 (Cross-Browser E2E Test Suite)
- Lifecycle safety (BFCache, SW recycle, teardown) — Phase 4
- Observability hooks (metrics/error events) — Phase 4
- SAB fast path — Phase 6
- Multi-hop relay — Phase 7
- Multiplexing — Phase 8

Requirements covered: FAST-01, FAST-02, FAST-03, API-01, API-02, API-03, API-04, TOPO-01, TEST-02.

</domain>

<decisions>
## Implementation Decisions

### API Shape

- **Channel factory**: `createChannel(endpoint, options)` is the single entry point. Returns a `Channel` handle with `openStream() → Stream`, `onStream(cb)` (inbound stream acceptance), `close()`.
- **Stream handle**: `Stream` is the neutral shape every adapter wraps. Exposes `{ session, channel }` for adapter access; not part of the public API.
- **Low-level adapter**: `createLowLevelStream(channel, options?) → { send(chunk, transfer?), onChunk(cb), onClose(cb), onError(cb), close() }`. `send` is async and resolves when the frame is handed to the endpoint; it awaits credit.
- **EventEmitter adapter**: `createEmitterStream(channel, options?) → EmitterStream` where `EmitterStream` has `.on(event, handler)`, `.off(event, handler)`, `.write(chunk)` (sync-ish; returns `true` if more can be written, `false` if buffering), `.end()`, events: `'data' | 'end' | 'error' | 'close' | 'drain'`.
- **WHATWG Streams adapter**: `createStream(channel, options?) → { readable: ReadableStream<Chunk>, writable: WritableStream<Chunk> }`. `desiredSize` wired to `credit-window.desiredSize`. Backpressure flows through `pipeTo` naturally.
- **Zero cross-imports between adapters**: each adapter independently depends on the `Channel`, not on another adapter. Tree-shakeable (API-04).

### Error Names

Use the named-error set already in PROJECT.md's observability list:
- `DataCloneError` — from structured-clone failure; surfaces on the adapter as a typed `StreamError` with `.cause: DataCloneError`
- `ORIGIN_REJECTED` — from Phase 1 Window adapter; not re-exposed at the stream level (origin drops happen before framing)
- `PROTOCOL_MISMATCH` — from CAPABILITY handshake
- `CONSUMER_STALL` — from credit-window stall timer (Phase 2)
- Additional Phase-4 errors (`CHANNEL_FROZEN`, `CHANNEL_DEAD`, `CHANNEL_CLOSED`) — declare their type shape now so Phase 4 can just wire them

Errors are a single `StreamError` class with a `.code` discriminant. Exported.

### Capability Negotiation

- On channel open, both peers emit a `CAPABILITY` frame with `{ protocolVersion, sabCapable, transferableStreamsCapable }`.
- Each side takes `min(local, remote)` once, caches for the channel lifetime (PROTO-04 anti-pattern of per-chunk switching is explicitly avoided).
- `PROTOCOL_MISMATCH` fires immediately on version disagreement — no silent fallback.
- For Phase 3, `sabCapable` is always `false` (Phase 6 flips it on); `transferableStreamsCapable` is feature-detected via a try/catch probe on a `ReadableStream` reference but defaults to `false` for Phase 3 and is enabled in later phases.

### MockEndpoint (test harness)

- `createMessageChannelPair()` — returns `{ a: PostMessageEndpoint, b: PostMessageEndpoint }` backed by Node's `node:worker_threads` `MessageChannel`. Provides real structured-clone + Transferable semantics.
- All Phase 3 integration tests use this. Browser-mode Vitest is deferred to Phase 9.
- Test-only module under `tests/helpers/mock-endpoint.ts`; not shipped.

### FAST paths (this phase scope)

- FAST-01 `BINARY_TRANSFER`: ArrayBuffer/TypedArray → transferred. After send, source is detached. Integration test proves `buffer.byteLength === 0` post-send (or equivalent detach check).
- FAST-02 `STREAM_REF`: feature-detect `ReadableStream` transferable. Default OFF in Phase 3 (safer to land chunked path first and flip on in Phase 5/9 once benchmarks confirm browsers support it). The probe logic must exist now; the capability flag is wired off-by-default.
- FAST-03 `STRUCTURED_CLONE`: non-cloneable payload surfaces `DataCloneError` as a typed stream error, not silent.

### Heap-flat slow-consumer test

- Sender writes a 64 KB chunk in a tight loop for N seconds.
- Consumer reads 1 chunk per second.
- Credit window HWM bounds the reorder buffer; heap should plateau, not grow linearly.
- Test asserts `process.memoryUsage().heapUsed` or `heapTotal` delta < a threshold (e.g., 10 MB) after N seconds.

### Claude's Discretion

All other implementation choices (how to internally split channel/session plumbing, exact option defaults, internal method names, test-helper ergonomics) are at Claude's discretion.

</decisions>

<code_context>
## Existing Code Insights

**Reusable exports (Phase 1 + 2):**
- `src/framing/types.ts` — `Frame`, all 8 frame-type interfaces, `ChunkType`, `FRAME_MARKER`, `PROTOCOL_VERSION`, `BaseFrame`
- `src/framing/encode-decode.ts` — `encode(frame)`, `decode(msg)` pure functions
- `src/transport/seq.ts` — `seqLT`, `seqGT`, `seqLTE`, `seqNext`, constants
- `src/transport/endpoint.ts` — `PostMessageEndpoint` interface
- `src/transport/adapters/{window,worker,message-port,service-worker}.ts` — four real-endpoint adapters (Phase 3 uses MessageChannel via Node's `node:worker_threads`, not these; these four adapters are consumer-facing)
- `src/session/index.ts` — `Session` class with `sendFrame / receiveFrame / onFrameOut / close / cancel / reset`, `SessionOptions.reorderInitSeq`

**Established patterns:**
- ESM with `.js` import extensions
- TypeScript 6 strict + `isolatedDeclarations: true` — all exports have explicit types
- Biome 2.4.12 formatting (`pnpm exec biome check --write <file>` before commit)
- Vitest 4 Node env (`--project=unit`) for all Phase 3 tests
- Tests colocated under `tests/unit/<module>/` + `tests/integration/<scenario>/`
- Zero runtime deps (COMP-02)
- fast-check available as devDep for property tests

**Integration points:**
- Phase 3 imports from `src/framing`, `src/transport`, `src/session` only
- Phase 3 EXPORTS from `src/index.ts`: the three adapter factories + `createChannel` + `StreamError` class
- Phase 4+ will layer on top (observability, lifecycle, SAB, relay, multiplex)

</code_context>

<specifics>
## Specific Ideas

- The EventEmitter implementation is ~40 LoC — do NOT pull in `events` or any polyfill. A plain `Map<Event, Set<Handler>>` with `.on/.off/.emit` is enough.
- WritableStream backpressure wiring: `highWaterMark` in the `WritableStream` config should equal the credit window's initial credit × chunk size, so `desiredSize` returns `(available_credits × chunk_size) - queued_bytes`.
- For `DataCloneError` surfacing: wrap `endpoint.postMessage(msg, transfer)` in a `try/catch` that detects `DOMException { name: 'DataCloneError' }` and routes to the stream's error channel with `StreamError { code: 'DataCloneError', cause }`.
- When `send()` transfers an `ArrayBuffer`, record `byteLength` BEFORE the transfer (PITFALLS item 2 — Chunker already does this; keep the invariant in the adapter layer).
- Use `writable.abort()` and `readable.cancel()` to trigger CANCEL/RESET on the underlying Session — map cleanly.
- The slow-consumer heap-flat test may need `--expose-gc` or a manual loop that yields via `setImmediate` to let the event loop drain — document in the test file.
- Integration tests use `describe.concurrent.each` patterns where possible, but keep the slow-consumer heap test in a non-concurrent `describe` (timing-sensitive).

</specifics>

<deferred>
## Deferred Ideas

- Observability hooks (metrics/error events) — Phase 4; leave a `hooks?: SessionHooks` option slot in channel/adapter options that defaults to `{}`
- Lifecycle (BFCache, SW recycle) — Phase 4
- Real-browser cross-context integration tests — Phase 9
- SAB fast path activation — Phase 6 (capability flag lives in CAPABILITY now, defaults `false`)
- Transferable `ReadableStream` path — Phase 6 or 9 (capability flag lives in CAPABILITY now, defaults `false`)
- Multi-hop relay — Phase 7 (Channel must route frames, not reassemble — keep that invariant in mind now so Phase 7 is a small add)
- Multiplexing — Phase 8 (the current Channel carries one logical stream; adding `openStream()`/`onStream()` shapes the API for later multiplex)

</deferred>
