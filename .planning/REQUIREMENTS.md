# Requirements: iframebuffer *(working name)*

**Defined:** 2026-04-21
**Core Value:** A high-throughput, reliable, ordered stream abstraction that slots into any existing postMessage boundary with minimal caller-side code.

## v1 Requirements

All v1 requirements are hypotheses until shipped and validated. YOLO mode — scope auto-derived from PROJECT.md, research SUMMARY.md, and the user's questioning answers; no per-category interactive narrowing.

### Endpoint abstraction

- [ ] **ENDP-01**: Library accepts any caller-provided transport endpoint that exposes `postMessage(message, transfer?)` and a message-receipt hook (`onmessage` setter or `addEventListener('message', ...)`)
- [ ] **ENDP-02**: Ships adapters that wrap the four endpoint shapes — `Worker` / `DedicatedWorkerGlobalScope`, `MessagePort`, `Window` (cross-origin iframe), and `ServiceWorker` / `Client`
- [ ] **ENDP-03**: `Window` adapter requires a non-wildcard `expectedOrigin` and validates `MessageEvent.origin` on every inbound message; messages from other origins are dropped silently and surfaced via the observability hook
- [ ] **ENDP-04**: `ServiceWorker` / `Client` endpoint is flagged as SAB-incapable at capability negotiation (different agent cluster)

### Wire protocol

- [ ] **PROTO-01**: Frame protocol defines exactly seven frame types — `OPEN`, `OPEN_ACK`, `DATA`, `CREDIT`, `CLOSE`, `CANCEL`, `RESET`, `CAPABILITY`
- [ ] **PROTO-02**: Every frame carries a channel ID, a stream ID, and a sequence number; sequence comparisons use wraparound-safe modular arithmetic
- [ ] **PROTO-03**: `DATA` frames include a `chunkType` tag distinguishing `BINARY_TRANSFER`, `STRUCTURED_CLONE`, `STREAM_REF`, `SAB_SIGNAL`
- [ ] **PROTO-04**: `CAPABILITY` handshake runs once on channel open; both sides compute `min(local, remote)` capabilities and cache the result for the channel lifetime (no per-chunk fast-path switching)
- [ ] **PROTO-05**: Protocol version is included in the `CAPABILITY` frame and mismatches surface a deterministic error (`PROTOCOL_MISMATCH`) rather than a silent hang

### Session core

- [ ] **SESS-01**: Reorder buffer delivers chunks in sequence-number order even under out-of-order arrivals, bounded by a configurable `maxReorderBuffer` with a clear error on overflow
- [ ] **SESS-02**: Credit-based flow control issues initial credits on `OPEN_ACK`, refreshes credits when the receiver's queue drains below half the high-water mark (QUIC WINDOW_UPDATE-style), and never allows the sender to write past available credit
- [ ] **SESS-03**: Credit refresh is driven by consumer reads, not frame arrivals — applying backpressure through the entire WHATWG Streams chain rather than only at the transport
- [ ] **SESS-04**: Chunker splits oversized payloads into protocol-sized chunks and reassembles them on the receiving side before surfacing to the consumer
- [ ] **SESS-05**: Stream lifecycle FSM covers `idle → open → data → half-closed → closed` with explicit `CANCEL` and `RESET` transitions and well-defined behavior for every source/destination pair
- [ ] **SESS-06**: Sequence number wraparound is handled correctly — library passes a fuzz test that drives sequences through the wrap point

### Fast-path selection

- [ ] **FAST-01**: Transferable `ArrayBuffer` / `TypedArray` path transfers ownership (zero-copy) when the caller provides typed binary; the post-transfer source is treated as detached, not read again
- [ ] **FAST-02**: Transferable `ReadableStream` path is used when feature-detected (modern Chrome/Firefox); falls back to library-native chunked delivery where unavailable (Safari stable as of v1 release is assumed absent)
- [ ] **FAST-03**: Structured-clone path handles arbitrary cloneable payloads and surfaces `DataCloneError` as a named, typed error — never swallowed
- [ ] **FAST-04**: `SharedArrayBuffer` + `Atomics` fast path activates when cross-origin-isolated AND not cross-agent-cluster AND caller opts in; falls back transparently to the postMessage-transferable path otherwise
- [ ] **FAST-05**: Feature detection runs once at channel open, not per chunk; the path stays fixed for the channel lifetime

### API surfaces

- [ ] **API-01**: Low-level `send(chunk) / onChunk(cb) / close()` API — the underlying primitive all higher-level wrappers compose on
- [ ] **API-02**: Node-style `EventEmitter` wrapper (`stream.on('data' | 'end' | 'error' | 'close', ...)`, `stream.write(chunk)`, `stream.end()`) — thin layer over the low-level API
- [ ] **API-03**: WHATWG Streams wrapper returning `{ readable: ReadableStream, writable: WritableStream }` pair; `desiredSize` is wired to the credit window so `pipeTo`/`pipeThrough` respect backpressure end-to-end
- [ ] **API-04**: API surfaces are independent entry points — consumers can import the low-level primitive without pulling in the EventEmitter or Streams wrappers (tree-shakeable)

### Topology

- [ ] **TOPO-01**: Two-party topology (one endpoint ↔ one endpoint) is the default and simplest case; all other topologies compose from it
- [ ] **TOPO-02**: Relay helper exposes a routing table — it forwards frames between two endpoints **without** reassembling payloads, without using `pipeTo`/`pipeThrough` across the postMessage boundary, and without unbounded buffering
- [ ] **TOPO-03**: Credits propagate end-to-end across a relay: the relay only issues upstream credits equal to what the downstream has granted, bounding relay memory to `downstreamCreditWindow × maxChunkSize`
- [ ] **TOPO-04**: Multi-hop stream identity is preserved end-to-end — the worker and the iframe see one logical stream with consistent stream IDs (or remapped IDs that present as a single logical stream to the caller)

### Multiplexing (opt-in)

- [ ] **MUX-01**: Single-stream mode is the default; no stream IDs or extra headers in the common path
- [ ] **MUX-02**: Explicit multiplex mode allows many concurrent logical streams over one endpoint, distinguished by stream ID in the frame header
- [ ] **MUX-03**: Multiplexer enforces per-stream credit windows independently — one stalled stream does not block others on the same channel

### Lifecycle safety

- [ ] **LIFE-01**: `pagehide` / `pageshow` (BFCache) is handled — streams on a BFCached page are paused cleanly on `pagehide` and either resumed on `pageshow` or error with `CHANNEL_FROZEN` if resumption isn't safe
- [ ] **LIFE-02**: Service-worker recycling mid-stream triggers a heartbeat/timeout that surfaces `CHANNEL_DEAD` instead of silent stall
- [ ] **LIFE-03**: Endpoint teardown (iframe unload, worker terminate, port close) propagates an explicit `CHANNEL_CLOSED` error to all active streams; no zombie streams remain
- [ ] **LIFE-04**: Strong references to `MessagePort` are retained for the channel lifetime so ports are not GC'd mid-stream
- [ ] **LIFE-05**: Event listeners registered by the library are removed on channel close; no leaked listeners after teardown

### Observability

- [ ] **OBS-01**: Library exposes typed metrics hooks — bytes sent/received per stream, current credit window, reorder buffer depth, frame counts by type
- [ ] **OBS-02**: Library exposes typed error events — `DataCloneError`, `ORIGIN_REJECTED`, `CREDIT_DEADLOCK`, `REORDER_OVERFLOW`, `PROTOCOL_MISMATCH`, `CHANNEL_FROZEN`, `CHANNEL_DEAD`, `CHANNEL_CLOSED`
- [ ] **OBS-03**: Optional trace hook emits per-frame trace events for debugging without hard-coupling to a specific logger

### Compatibility & security

- [ ] **COMP-01**: Baseline path (postMessage-only, no SAB, no WASM) runs under strict CSP without `unsafe-eval` or `wasm-unsafe-eval`
- [x] **COMP-02**: Library has zero runtime dependencies
- [ ] **COMP-03**: Library runs in Chrome, Firefox, and Safari (latest-2 evergreen) — verified by CI against real browsers
- [x] **COMP-04**: Library is ESM-first with TypeScript type declarations shipped

### Testing

- [ ] **TEST-01**: Unit tests for framing, reorder buffer, credit window, chunker, and FSM run headless under Node with no browser (pure TypeScript seams)
- [ ] **TEST-02**: Integration tests use a `MockEndpoint` backed by a real `MessageChannel` pair — exercising real structured-clone and Transferable semantics without spawning a real Worker
- [ ] **TEST-03**: E2E tests via Vitest browser mode + Playwright exercise real iframe, worker, and service-worker contexts in Chromium, Firefox, and WebKit
- [ ] **TEST-04**: E2E suite includes the three-hop topology scenario (worker → main-thread relay → strict-CSP sandboxed iframe) as a first-class test
- [ ] **TEST-05**: E2E suite asserts baseline (postMessage-only, no SAB) works inside a sandboxed iframe under strict CSP — no `unsafe-eval`, no `wasm-unsafe-eval`
- [ ] **TEST-06**: Property/fuzz tests for the session FSM and sequence-number wraparound

### Benchmarks

- [ ] **BENCH-01**: Benchmark harness built on Vitest browser mode + tinybench, runnable locally and in CI, across Chromium, Firefox, and WebKit
- [ ] **BENCH-02**: Benchmarks measure throughput (MB/s), latency (p50/p95/p99), and CPU (approximated via `performance.now()`-banded sampling) for each data type (binary, stream-ref, structured-clone)
- [ ] **BENCH-03**: Benchmarks compare the library against naive postMessage chunking across data sizes (1KB, 64KB, 1MB, 16MB, 256MB) and topologies (two-party, relay)
- [ ] **BENCH-04**: Benchmark report is published alongside each release — versioned in the repository and rendered in the docs site
- [ ] **BENCH-05**: Benchmark data drives the WASM decision gate — introduce WASM only when JS path hits a measurable ceiling that WASM can break through (documented in decision log)

### Examples

- [ ] **EX-01**: Example — two-party stream (parent ↔ iframe) with a simple `pipeTo` file download
- [ ] **EX-02**: Example — two-party stream (main ↔ worker) with `ReadableStream` of compressed frames
- [ ] **EX-03**: Example — three-hop topology: worker ingests a live stream → main-thread relay → strict-CSP sandboxed iframe consumer
- [ ] **EX-04**: Example — multiplex mode: file download and control channel over one endpoint
- [ ] **EX-05**: Each example is runnable locally (`pnpm dev`) and deployed to the examples site

### Documentation

- [ ] **DOC-01**: README covers install, a 10-line quickstart, and a link tree to the API/topology/benchmark docs
- [ ] **DOC-02**: Documentation site (generated from source) covers the three API surfaces, endpoint adapters, capability negotiation, topology patterns, lifecycle/teardown semantics, and all named errors
- [ ] **DOC-03**: Benchmark results section with charts (throughput, latency, CPU vs chunk size / data type / topology)
- [ ] **DOC-04**: Migration / interop notes — when to use this library vs comlink vs native Transferable ReadableStream vs SAB ring buffer directly
- [ ] **DOC-05**: Security-model docs explicitly cover origin validation, strict-CSP caveats, COOP/COEP interactions, sandboxed-iframe limitations
- [ ] **DOC-06**: Decision log captures every key architecture/protocol decision with the benchmark or research evidence behind it

### Publishing

- [ ] **PUB-01**: Package has a short, catchy name that is available on both npm and jsr; name selected before v1 publish
- [ ] **PUB-02**: Dual-publish to npm and jsr from a single CI workflow using GitHub OIDC trusted publishing (no long-lived tokens)
- [ ] **PUB-03**: Version sync script keeps `package.json` and `jsr.json` on the same version automatically; drift is prevented by CI check
- [ ] **PUB-04**: Semantic versioning managed by Changesets with human-readable changelog

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Cross-runtime

- **XRT-01**: Library works under Node `worker_threads`, Deno workers, and Bun workers via thin endpoint adapters
- **XRT-02**: Runtime-specific test matrices added to CI

### Delivery semantics

- **DEL-01**: Configurable per-stream delivery modes — `reliable+ordered` (v1 default), `reliable+unordered`, `best-effort` (drop on pressure) for live media use cases

### Advanced features

- **ADV-01**: Optional compression (zstd/lz4/brotli) as a TransformStream the consumer pipes through — likely the point where WASM first earns its keep
- **ADV-02**: Stream resumption after transient endpoint loss if the caller opts in and provides a session token (note: contradicts v1 anti-feature "Automatic reconnection" — would require explicit design, not implicit)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Encryption / authentication | Origin isolation + caller-supplied crypto cover the threat model. Adding it bloats scope and drags in key management. |
| RPC / request-response | This is a stream library, not "comlink but faster." RPC semantics (method registry, promise correlation, argument marshaling) would eat scope and tempt feature creep. |
| Automatic reconnection | If the underlying channel dies, streams error out. The caller decides whether to re-open because only they know session state. |
| Channel discovery / handshake helpers | The caller sets up the MessageChannel / Worker / iframe and hands us a wired endpoint. Bootstrapping belongs to the host application. |
| IE / legacy browser support | Evergreen-only. Structured clone, Transferable, ReadableStream, and ES modules are hard dependencies. |
| Per-chunk fast-path switching | Capability handshake on channel open, cached for the lifetime. Per-chunk switching is an explicit anti-pattern (added protocol complexity, hurts JIT, correctness footguns). |
| Using WHATWG `pipeTo` across postMessage hops in the relay | Does not propagate backpressure. Relay is a routing table, not a pipe composition. Documented anti-pattern. |
| Wildcard `targetOrigin` on Window endpoints | Supply-chain attack vector (MSRC August 2025 incident). Library refuses to ship a default that accepts `*`. |
| Node / Deno / Bun in v1 | Compatible shape, but v1 is browser-focused. Cross-runtime is a v2 milestone. |
| Runtime dependencies | The library targets security-sensitive contexts (sandboxed iframes, CSP-restricted pages). Each transitive dep is audit surface. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| COMP-01 | Phase 1 | Pending |
| COMP-02 | Phase 1 | Complete |
| COMP-03 | Phase 9 | Pending |
| COMP-04 | Phase 1 | Complete |
| ENDP-01 | Phase 1 | Pending |
| ENDP-02 | Phase 1 | Pending |
| ENDP-03 | Phase 1 | Pending |
| ENDP-04 | Phase 1 | Pending |
| PROTO-01 | Phase 1 | Pending |
| PROTO-02 | Phase 1 | Pending |
| PROTO-03 | Phase 1 | Pending |
| PROTO-04 | Phase 1 | Pending |
| PROTO-05 | Phase 1 | Pending |
| FAST-05 | Phase 1 | Pending |
| SESS-01 | Phase 2 | Pending |
| SESS-02 | Phase 2 | Pending |
| SESS-03 | Phase 2 | Pending |
| SESS-04 | Phase 2 | Pending |
| SESS-05 | Phase 2 | Pending |
| SESS-06 | Phase 2 | Pending |
| TEST-01 | Phase 2 | Pending |
| TEST-06 | Phase 2 | Pending |
| FAST-01 | Phase 3 | Pending |
| FAST-02 | Phase 3 | Pending |
| FAST-03 | Phase 3 | Pending |
| API-01 | Phase 3 | Pending |
| API-02 | Phase 3 | Pending |
| API-03 | Phase 3 | Pending |
| API-04 | Phase 3 | Pending |
| TOPO-01 | Phase 3 | Pending |
| TEST-02 | Phase 3 | Pending |
| LIFE-01 | Phase 4 | Pending |
| LIFE-02 | Phase 4 | Pending |
| LIFE-03 | Phase 4 | Pending |
| LIFE-04 | Phase 4 | Pending |
| LIFE-05 | Phase 4 | Pending |
| OBS-01 | Phase 4 | Pending |
| OBS-02 | Phase 4 | Pending |
| OBS-03 | Phase 4 | Pending |
| BENCH-01 | Phase 5 | Pending |
| BENCH-02 | Phase 5 | Pending |
| BENCH-03 | Phase 5 | Pending |
| BENCH-04 | Phase 5 | Pending |
| BENCH-05 | Phase 5 | Pending |
| FAST-04 | Phase 6 | Pending |
| TOPO-02 | Phase 7 | Pending |
| TOPO-03 | Phase 7 | Pending |
| TOPO-04 | Phase 7 | Pending |
| MUX-01 | Phase 8 | Pending |
| MUX-02 | Phase 8 | Pending |
| MUX-03 | Phase 8 | Pending |
| TEST-03 | Phase 9 | Pending |
| TEST-04 | Phase 9 | Pending |
| TEST-05 | Phase 9 | Pending |
| EX-01 | Phase 10 | Pending |
| EX-02 | Phase 10 | Pending |
| EX-03 | Phase 10 | Pending |
| EX-04 | Phase 10 | Pending |
| EX-05 | Phase 10 | Pending |
| DOC-01 | Phase 10 | Pending |
| DOC-02 | Phase 10 | Pending |
| DOC-03 | Phase 10 | Pending |
| DOC-04 | Phase 10 | Pending |
| DOC-05 | Phase 10 | Pending |
| DOC-06 | Phase 10 | Pending |
| PUB-01 | Phase 10 | Pending |
| PUB-02 | Phase 10 | Pending |
| PUB-03 | Phase 10 | Pending |
| PUB-04 | Phase 10 | Pending |

**Coverage:**
- v1 requirements: 69 total
- Mapped to phases: 69
- Unmapped: 0

**Note:** The REQUIREMENTS.md file contained 69 v1 requirements across 15 categories (the initial summary of "53" omitted the Examples, Documentation, and Publishing categories from its count; all are present in the requirements body and all are now mapped).

---
*Requirements defined: 2026-04-21*
*Last updated: 2026-04-21 after roadmap creation — full traceability added*
