# Phase 6: SAB Fast Path - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning
**Mode:** Auto-generated with grey-area defaults (YOLO)

<domain>
## Phase Boundary

The SharedArrayBuffer + Atomics ring-buffer transport is available as a feature-detected, opt-in fast path that activates only when cross-origin isolation is confirmed (`crossOriginIsolated === true`) and the endpoint is not a ServiceWorker (different agent cluster — SAB throws `DataCloneError`).

This phase covers:
- `src/transport/sab.ts` — SPSC ring buffer using `SharedArrayBuffer` + `Atomics.wait` / `Atomics.notify` for producer-consumer coordination
- `src/transport/sab-capability.ts` — runtime probe: `typeof SharedArrayBuffer !== 'undefined'` AND `crossOriginIsolated === true` AND endpoint's `sabCapable !== false` (ServiceWorker adapters already set `sabCapable: false` in Phase 1)
- Channel capability-negotiation wiring: `sab: boolean` in the `CAPABILITY` frame payload, already reserved from Phase 3
- Channel SAB-path activation: when negotiated capability is `sab: true` and caller opts in via `channel.options.sab = true`, data frames are written via the ring buffer instead of `postMessage`; control frames stay on postMessage
- Fallback: when any condition fails (no SAB, no COI, caller opts out, peer negotiates down), the channel transparently uses the Phase 3 transferable path with no behavior change
- Unit tests in Node (SAB + Atomics available in Node 22+ without headers): SPSC correctness under concurrent producer/consumer, wrap-around handling, Atomics signaling, capacity checks
- Benchmark scenario in `benchmarks/scenarios/sab-transfer.bench.ts` comparing SAB path vs transferable path for binary payloads

This phase explicitly does NOT include:
- Real browser COOP/COEP testing — Phase 9 (Node SAB is functionally equivalent for correctness; browser-specific tuning can happen later)
- Multi-producer or multi-consumer (MPSC/MPMC) ring buffers — SPSC is sufficient for single-stream; multiplex (Phase 8) may revisit
- WASM-backed ring buffer — Phase 5 decision deferred WASM; SAB is pure JS
- Multi-hop relay over SAB — Phase 7 (relay treats SAB and postMessage paths uniformly via the same frame routing logic)

Requirements covered: FAST-04.

</domain>

<decisions>
## Implementation Decisions

### Capability probe

- `isSabCapable(endpoint)` returns `true` iff:
  1. `typeof SharedArrayBuffer !== 'undefined'`
  2. In browser: `crossOriginIsolated === true` (COOP: same-origin + COEP: require-corp headers set by caller's host). Missing in Node — skip the COI check in Node env.
  3. `endpoint.capabilities?.sabCapable !== false` — ServiceWorker adapters explicitly set this to `false`; everything else inherits `undefined` (treated as capable).
- Result cached on the Channel; negotiated once via CAPABILITY frame and never re-probed mid-channel.

### Ring buffer layout

Single-producer single-consumer (SPSC) pattern:
- Header (first 64 bytes): two Int32Atomics for `head` (producer position) and `tail` (consumer position), plus 2 reserved slots for future use
- Payload (remainder): byte buffer, default 1 MB, configurable via `channel.options.sabBufferSize`
- Producer writes to `(head % capacity)` and advances via `Atomics.store(header, 0, newHead)` + `Atomics.notify(header, 0)`
- Consumer reads from `(tail % capacity)` and advances similarly; blocks on empty via `Atomics.wait(header, 0, currentHead)`
- Wrap-around handled via modular arithmetic (mirrors Phase 1 seq arithmetic)

### Message framing over SAB

- SAB carries ONLY `DATA` frames (the hot path). All control frames (OPEN, OPEN_ACK, CREDIT, CLOSE, CANCEL, RESET, CAPABILITY) stay on postMessage for simplicity and because they're low-volume.
- Each SAB slot contains: [header: u32 length | u32 flags | u32 seq | payload bytes]
- Receiver reassembles chunks identically to the postMessage path (same Chunker module from Phase 2)

### Activation / fallback

- Caller opts in via `channel.options.sab = true`
- On CAPABILITY handshake, if BOTH sides probe `sab: true` AND the caller opted in, the Channel spins up a shared SAB ring buffer and sends its `SharedArrayBuffer` reference via a dedicated CAPABILITY extension OR via the existing CAPABILITY frame (choose — research decides)
- If negotiation fails at any point, both sides silently use the postMessage transferable path; no error

### Backpressure

- SAB ring buffer has fixed capacity — producer blocks on `Atomics.wait` when the buffer is full, consumer wakes on `Atomics.notify`
- Library credit-window still runs on top — credits gate at the session layer regardless of transport (SAB is just a faster DATA-frame transport, not a replacement for flow control)

### Testing

- Pure-Node unit tests for the ring buffer (Atomics, wrap, capacity)
- Integration test using two `Channel` instances over an SAB pair (synthesize a shared buffer in the test, wire both sides)
- Fallback test: feature-detect returns false, verify postMessage path is used, full stream succeeds
- Benchmark `sab-transfer.bench.ts` compares SAB vs transferable path — adds to `benchmarks/results/baseline.json`

### Claude's Discretion

- Exact SAB buffer default size (1 MB is reasonable)
- Whether to expose `channel.options.sabBufferSize` to callers
- Wire format of CAPABILITY-plus-SAB-buffer handshake (inline vs separate frame — recommend: send via CAPABILITY payload extension)

</decisions>

<code_context>
## Existing Code Insights

Phase 3 wired `sabCapable: false` default for ServiceWorker adapters. CAPABILITY frame shape allows extension with `sab: boolean` field. Channel.ts already caches `#localCap` and `#remoteCap` via `computeMergedCapability()`.

Phase 1 seq arithmetic (`src/transport/seq.ts`) is the pattern for wrap-safe comparison — useful for ring-buffer `head/tail` arithmetic.

Phase 2 Chunker handles DATA frame split/reassemble — SAB path reuses this logic unchanged.

Node 22 `node:worker_threads` exposes `Atomics`, `SharedArrayBuffer`, and can share SAB between main + workers. For tests, we spawn a worker thread and share the SAB.

</code_context>

<specifics>
## Specific Ideas

- The ring buffer header layout: `new Int32Array(sab, 0, 8)` — first 4 slots for head/tail, last 4 reserved.
- Use `Atomics.waitAsync` NOT `Atomics.wait` on the main thread to avoid blocking UI — available Node 22+, Chrome 97+.
- Fallback detection: if `Atomics.waitAsync` is unavailable, downgrade to postMessage silently — document.
- Benchmark expectation: SAB should beat transferable for large binary payloads because it avoids structured-clone wrapping entirely. If it doesn't, that's a surprising finding — document in a new decision doc `.planning/decisions/06-sab-benchmark.md`.

</specifics>

<deferred>
## Deferred Ideas

- Real browser COOP/COEP test (Phase 9 with Playwright)
- MPSC or MPMC ring buffer (future, if multiplex demands it)
- WASM ring buffer (deferred by Phase 5 decision)
- Dynamic resizing of SAB buffer — out of scope; fixed capacity is simpler

</deferred>
