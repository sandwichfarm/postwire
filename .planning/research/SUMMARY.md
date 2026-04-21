# Project Research Summary

**Project:** iframebuffer (working name)
**Domain:** High-throughput postMessage streaming library — TypeScript, browser-only, zero runtime deps
**Researched:** 2026-04-21
**Confidence:** HIGH (stack and pitfalls verified against official sources; architecture HIGH for layers 1–3, MEDIUM for SAB fast path and relay backpressure; features HIGH for table stakes, MEDIUM for differentiator complexity estimates)

---

## Executive Summary

iframebuffer is a transport library, not an RPC library. The design space is genuinely novel: Comlink (12.5k stars) does RPC only; remote-web-streams (unmaintained) does WHATWG Streams over MessagePort but has no backpressure, no chunking, no relay, and no SAB fast path; post-message-stream (MetaMask) wraps Node-style streams but stays in structured-clone territory with no cross-context flow control. The library's reason to exist is the combination of things none of them do: automatic chunking of large ArrayBuffers (45x throughput improvement via Transferable vs. structured clone), credit-based backpressure that survives postMessage hops, and a relay mode where end-to-end backpressure propagates through an intermediary context without buffering. The project is framed as a full study — library + benchmarks + examples + docs — so the benchmark harness is a first-class deliverable, not an afterthought.

The recommended approach is a strict five-layer stack (Transport -> Framing -> Channel -> Session -> API Adapters) where each layer is a TypeScript interface boundary. The Framing layer is pure functions (no I/O), which makes it the natural seam for a future WASM codec. The Session layer is independently testable with plain objects; only the Transport and Adapter layers need a real browser. This architecture means the hardest features (credit-based backpressure, relay) can be built and validated in isolation before being integrated. The WHATWG Streams surface is the primary public API; EventEmitter and low-level send/onChunk are secondary surfaces built on the same session layer.

The key risks are all correctness traps, not implementation difficulty: (1) `controller.enqueue()` silently grows the receiver queue past any reasonable size if credits are not correctly wired to actual read() calls — this is the OOM risk; (2) the relay is a routing table, not a pipe — building it with WHATWG Streams pipeTo across a postMessage boundary produces an unbounded relay buffer that looks correct in tests and OOMs in production; (3) BFCache freezes the page but not workers, so all stall-detection timers and credit windows must be suspended on pagehide(persisted=true) and streams must be errored; (4) the SAB fast path is a performance ceiling, not a correctness requirement — the transferable ArrayBuffer fallback must be solid before SAB is added; (5) origin validation on Window endpoints is a security hard stop, not a polish item. The WASM decision is explicitly deferred to benchmarks: if JS-only hits a measurable ceiling, Rust + wasm-pack with a CSP-safe glue constraint is the chosen path.

---

## Key Findings

### Recommended Stack

The toolchain is greenfield-optimised for a zero-runtime-dep ESM library in 2026. tsdown (0.20.x, Rolldown-powered) replaces the abandoned tsup and produces correct DTS bundles faster. TypeScript 6.0.x with `moduleResolution: bundler` and `verbatimModuleSyntax` is the correct configuration. Vitest 4.1.x browser mode (stable as of v4.0) with the Playwright provider is the unit/benchmark harness; standalone Playwright 1.59.x handles multi-hop topology and CSP E2E tests. Biome 2.4.x replaces ESLint + Prettier. Changesets manages semver; a 10-line `sync-jsr-version.mjs` script keeps `jsr.json` in sync on every version bump. Dual publish to npm and JSR via GitHub Actions OIDC (no long-lived tokens). VitePress 1.6.x (stable) for docs and live examples. Real browsers are non-negotiable for testing: jsdom/happy-dom do not enforce structured-clone restrictions, do not detach ArrayBuffers on transfer, and have no concept of `crossOriginIsolated`. Every test that exercises the framing, transfer, or backpressure path must run in a real browser.

**Core technologies (one-liner picks with why):**
- TypeScript 6.0.x: source language — `moduleResolution: bundler`, `verbatimModuleSyntax`, strict; TS 7 Go-native is preview-only
- tsdown 0.20.x: bundler — direct tsup replacement (tsup abandoned per author); Rolldown-powered, correct DTS, ~10x faster builds
- Vitest 4.1.x (browser mode): unit tests + benchmarks — browser mode stable in v4.0, tinybench built in, real browser via Playwright provider
- Playwright 1.59.x: E2E + multi-hop tests — only realistic option for real iframe + worker + SW topologies; SW routing Chromium-only
- Biome 2.4.x: lint + format — one Rust-based tool replaces ESLint + Prettier; type-aware rules without TS language service
- pnpm: package manager — strict hoisting prevents phantom deps; critical for a zero-runtime-dep library
- @changesets/cli: version/release management — human-reviewed changelogs, triggers npm + JSR publish
- VitePress 1.6.x: docs site — Vue-native, embeds live demos in Markdown, stable (v2.0 still alpha)
- WASM (deferred): Rust + wasm-pack if benchmarks justify; AssemblyScript fallback; CSP constraint requires wasm-bindgen glue to avoid js_sys::global

### Expected Features

**Must have — table stakes (v1):**
- Message envelope with frame namespace marker (`__ibf_v1__: 1`), stream ID, and sequence number per stream
- Stream lifecycle messages: OPEN / OPEN_ACK / DATA / CREDIT / CLOSE / CANCEL / RESET / CAPABILITY (8 frame types)
- Chunk type tag: BINARY_TRANSFER / STRUCTURED_CLONE / STREAM_REF / SAB_SIGNAL
- Transferable ArrayBuffer path — auto-detected via one-time CAPABILITY frame exchange, not per-chunk
- Feature detection with graceful fallback to structured-clone postMessage (priority: SAB -> Transferable -> clone)
- Automatic chunking of large ArrayBuffers + in-order reassembly via reorder buffer
- Credit-based backpressure — receiver grants credits; sender pauses at zero; credits issued on queue drain below 50% HWM
- WHATWG Streams surface: `{ readable: ReadableStream<T>, writable: WritableStream<T> }` — primary API
- EventEmitter surface: `stream.on('data', ...)` / `write()` / `end()` — secondary API
- Low-level `send(chunk, options?)` / `onChunk(handler)` — escape hatch and foundation for other surfaces
- Stream error propagation: sender abort -> receiver ReadableStream error; receiver cancel -> sender WritableStream abort
- Context termination detection: worker termination, iframe unload, port close -> all streams on channel -> ERRORED
- `PostMessageEndpoint` interface: `{ postMessage(data, transfer[]): void; onmessage: handler | null }` — accepts any postMessage-compatible object
- Stream ID field in wire format even in single-stream mode — forward-compatible with multiplexing
- `createWindowEndpoint(win, expectedOrigin)` adapter — origin-validated Window wrapper; security non-negotiable

**Should have — differentiators (v1.x):**
- SAB ring-buffer fast path — SPSC wait-free ring buffer; feature-detected; benchmarks must confirm headroom first
- Multi-hop relay (`relayBridge(upstreamChannel, downstreamChannel)`) — routing table design, not pipe; credit-forwarding backpressure end-to-end
- Backpressure and abort propagation through relay hops
- Native Transferable ReadableStream delegation — single-hop only; Safari stable support must land first
- Per-stream metrics: `stream.stats()` returning bytesSent, bytesReceived, chunksInFlight, creditWindow, estimatedRTT
- Debug mode: structured framing trace (tree-shaken in production)
- Configurable chunk size with benchmark-derived defaults (published in docs)

**Defer to v2+:**
- Optional multiplexer — conflicts with SPSC SAB fast path; needs API design from real usage evidence
- SharedWorker / BroadcastChannel — MPSC semantics conflict with SPSC SAB; BroadcastChannel has no Transferable support
- WASM compression module — only if benchmarks show channel saturation is achievable
- Node / Deno / Bun cross-runtime adapters

**Explicit anti-features (do not add — reasons are load-bearing):**
- RPC / request-response: separate protocol layered over stream; use LL surface to build a thin adapter if needed
- Automatic reconnection: requires session identity and in-flight recovery the library cannot own; surface clean errors, document reconnect pattern
- Channel discovery / handshake helpers: depends on host app lifecycle; incorrect origin validation is a security risk; provide a 20-line example instead
- Encryption / authentication: key management is a separate domain; document SubtleCrypto for callers who need it
- Compression in v1: compute overhead unvalidated; design LL surface so callers inject a TransformStream; add as separate entry point only if benchmarks show channel saturation

### Architecture Approach

The library is a five-layer stack where each layer is a TypeScript interface boundary and no layer reaches through to a non-adjacent layer. Transport (layer 1) wraps the caller-provided endpoint and owns fast-path selection via a one-time CAPABILITY frame exchange — path is cached for channel lifetime, never decided per-chunk. Framing (layer 2) is stateless pure functions: `encode(frame)` / `decode(msg)` — no I/O, zero state, natural WASM replacement seam. Channel (layer 3) demuxes incoming frames to the StreamSession registry and serializes outgoing frames. Session (layer 4) owns all per-stream state: sequence counter, reorder buffer, credit window, lifecycle FSM, chunk splitter. Adapters (layer 5) are thin wrappers over Session that expose the three public API surfaces. RelayBridge and MultiplexLayer are optional components that connect two Channels; they hold no application state and forward frames without reassembly.

**Layer dependency graph / build order:**
1. `framing/types.ts` + `framing/index.ts` — Frame union type + pure encode/decode; blocks everything; testable with zero setup
2. `transport/endpoint.ts` + `transport/capability.ts` + `transport/index.ts` — PostMessageEndpoint interface, CAPABILITY frame, Transport class wrapping endpoint
3. `session/fsm.ts` + `session/reorder-buffer.ts` + `session/credit-window.ts` + `session/chunker.ts` — pure session internals; all independently unit-testable without a browser
4. `session/index.ts` + `channel/index.ts` — wires session internals; first integration point
5. `adapters/lowlevel.ts` -> `adapters/emitter.ts` -> `adapters/streams.ts` — public API surfaces; build LL first, Streams last (most complex backpressure wiring)
6. `relay/index.ts` + `transport/sab-ring-buffer.ts` + `channel/mux.ts` — deferred; require Phase 5 to be stable and benchmarks to inform design

### Critical Pitfalls

1. **`controller.enqueue()` ignores backpressure -> OOM** (CRITICAL, Phases 3+5): `desiredSize` is advisory; calling `enqueue()` on every arriving DATA frame without a credit gate produces unbounded queue growth. Credits MUST be issued on actual `read()` calls, not on frame arrival. Wire `desiredSize` to the credit window: `creditGrant = Math.floor(desiredSize / chunkSize)` when `desiredSize > 0`. Add a test: fast sender, slow consumer (1 chunk/second), assert heap stays flat.

2. **Relay built with `pipeTo` -> unbounded relay buffer** (CRITICAL, Phase 6): WHATWG Streams backpressure does not cross a postMessage boundary. A pipeTo relay accumulates all upstream data in the relay context's heap while the downstream consumer is slow. The relay must be a routing table: hold upstream credits equal to what downstream has granted; forward DATA frames only within that window; never buffer reassembled payloads.

3. **DataCloneError silently drops stream frames** (CRITICAL, Phase 1): `postMessage` throws `DataCloneError` synchronously for Functions, DOM Nodes, SAB-backed TypedArrays into a different agent cluster. Without a try/catch in Transport, the stream goes quiet with no error. Transport must catch DataCloneError, emit a RESET frame, and transition StreamSession to ERRORED with the original error as cause.

4. **Detached ArrayBuffer read after transfer** (CRITICAL, Phase 1+3): After `postMessage(msg, [buffer])`, `buffer.byteLength === 0`. All size/metadata reads, logging, and chunker bookkeeping must happen before the postMessage call. The chunker must record chunk sizes before transfer, never after.

5. **Origin not validated on Window endpoints -> XSS escalation** (CRITICAL, Phase 1): `Window.onmessage` receives messages from any origin. Any cross-origin frame can inject crafted `__ibf_v1__` frames. Provide `createWindowEndpoint(win, expectedOrigin)` as a named export and show it in every Window-using example. Never use raw Window as an endpoint in library code or docs.

**Additional HIGH pitfalls:**
- **Credit window deadlock** (Phase 3+4): sender at zero credits, receiver's ReadableStream has no consumer, no CREDIT frames ever issued. Add stall timeout (default 5s) that emits RESET with `reason: 'consumer-stall'`. Relay must not issue upstream credits before downstream OPEN_ACK arrives.
- **BFCache zombie channels** (Phase 4): `pagehide(persisted=true)` must RESET all active streams and suspend stall timers.
- **Service worker silent recycling** (Phase 1): Browser terminates idle SWs after ~30s with no notification. SW endpoints require heartbeat opt-in (PING/PONG every 20s).
- **MessagePort GC with no close event** (Phase 1): Port in a local variable is eligible for GC; messages silently stop. Channel must hold a strong reference to the endpoint.
- **Sequence number modular arithmetic** (Phase 3): Raw `seq > expected` comparison fails at 32-bit wraparound. Use `((seqA - seqB) >>> 0) < HALF_WINDOW`. Write the wraparound test in Phase 3 before integration.

---

## Implications for Roadmap

The ARCHITECTURE.md build order (layers 1-6) maps cleanly to roadmap phases. The layer dependency graph is the constraint: nothing above a layer can exist before the layer below is solid. The critical path spine is `framing/types.ts` -> `session/credit-window.ts` -> `adapters/streams.ts`; everything else hangs off it.

### Phase 1: Project Scaffold + Wire Protocol Foundation

**Rationale:** Everything depends on frame type definitions and the Transport layer. Pitfalls 1, 2, 5, 11, 12, 14, 16, 17 all live in the Transport/endpoint layer — addressing them here prevents cascading correctness debt. The two-entry-point `exports` structure (baseline + WASM slot) must be established before any code exists; retrofitting it later risks breaking the CSP-safe guarantee.

**Delivers:** Configured repo (tsdown + Vitest + Playwright + Biome + Changesets); `PostMessageEndpoint` interface; `framing/types.ts` (Frame union) + `framing/index.ts` (encode/decode pure functions); `transport/capability.ts` (capability probe + CAPABILITY frame); `transport/index.ts` (Transport class, DataCloneError handling, strong endpoint reference); `createWindowEndpoint(win, origin)` adapter; CI rule excluding jsdom from protocol tests; two-entry-point `exports` map.

**Features addressed:** Message envelope / frame namespace marker; chunk type tag; feature detection + CSP-safe structure; PostMessageEndpoint interface.

**Pitfalls addressed:** DataCloneError swallowed (P1); post-transfer detach test (P2); origin injection (P5 — createWindowEndpoint); port GC (P11 — strong ref); wasm-unsafe-eval exports structure (P12); SAB false positive ServiceWorker check (P14); onmessage contract (P16); jsdom CI rule (P17).

**Research flag:** Standard patterns. No research phase needed.

---

### Phase 2: Session Protocol Core

**Rationale:** Session internals (reorder buffer, credit window, chunker, FSM) are pure TypeScript with no browser dependencies. Build and exhaustively test in Node 18+ before any real browser integration. Sequence wraparound correctness must be established here — adding it later to an integrated system is harder. The credit window is the most load-bearing component in the library; it must be provably correct before the Streams adapter is built on top.

**Delivers:** `session/fsm.ts`; `session/reorder-buffer.ts` (modular seq arithmetic + wraparound test at 0xFFFFFFF0); `session/credit-window.ts` (send/recv credit accounting + stall detection timer); `session/chunker.ts` (records sizes before transfer); `channel/index.ts` (demux/mux, monotonic stream ID allocation); `session/index.ts` (wires all session components).

**Features addressed:** Sequence numbering; stream lifecycle FSM; chunk reassembly; credit-based backpressure; gap detection; stream ID forward-compatibility field.

**Pitfalls addressed:** Credit deadlock stall timeout (P3); backpressure OOM credits-on-drain (P4 partial); seq wraparound modular arithmetic (P9); duplicate frames on reconnect monotonic IDs (P15); async iterator cancel handler in FSM (P18 partial).

**Research flag:** Standard patterns. Credit window follows QUIC RFC 9000. Wraparound arithmetic is a known TCP pattern. No research phase needed.

---

### Phase 3: API Surfaces + Single-Hop Integration

**Rationale:** With the session layer solid, the three API surfaces are thin wrappers. Build LL first (foundation for others), then EventEmitter (simple), then WHATWG Streams (hardest — desiredSize-to-credit-window wiring is the most critical correctness property of the library). First phase requiring a real browser (Vitest browser mode). Single-hop worker <-> main and iframe <-> parent tests validate the full stack before relay complexity.

**Delivers:** `adapters/lowlevel.ts`; `adapters/emitter.ts`; `adapters/streams.ts` (desiredSize-to-credit-window wiring); `src/index.ts` (public re-exports); TypeScript generics `Stream<T>` throughout; symmetric `createChannel(endpoint)` API; single-hop Vitest browser mode tests; context termination detection (BFCache pagehide/pageshow, port close -> ERRORED); heartbeat opt-in for SW endpoints.

**Features addressed:** WHATWG Streams primary surface; EventEmitter alternate surface; low-level surface; symmetric two-sided API; TypeScript generics; stream error propagation; context termination detection.

**Pitfalls addressed:** Backpressure OOM desiredSize wiring (P4 — fast-sender/slow-consumer heap test); BFCache zombie pagehide handler (P7); SW recycling heartbeat (P8); async iterator cancel in streams adapter (P18).

**Research flag:** WHATWG Streams backpressure wiring is the highest-risk adapter. If the desiredSize/credit-window integration takes more than 2 days, run `/gsd:research-phase` on "WHATWG Streams push source + external backpressure signal."

---

### Phase 4: Benchmark Harness + Performance Validation

**Rationale:** This is a research project. The benchmark harness is a first-class deliverable. Before the SAB fast path is built, benchmarks must confirm whether the transferable path leaves headroom worth optimizing. Before chunk sizes are documented, benchmarks must derive the correct defaults. CI regression guard (10% threshold) established here. Phase deliberately precedes SAB and relay so data informs those decisions.

**Delivers:** Vitest bench suite covering: naive postMessage vs library (ArrayBuffer 64KB/1MB/32MB/256MB x 1-hop); structured-clone large graph vs ArrayBuffer same byte size; chunk size sweep (1KB to 4MB); backpressure correctness test (fast sender, 1-chunk/second consumer, heap stays flat); throughput reported as MB/s via custom reporter; CI artifact baseline; `stream.stats()` per-stream metrics; debug mode verbose trace.

**Features addressed:** Benchmark harness (PROJECT.md first-class deliverable); configurable chunk size (defaults derived empirically); per-stream metrics; debug mode.

**Pitfalls addressed:** Structured clone cost cliff published results (P10); chunk size sweep derives correct defaults (P13).

**Research flag:** Open empirical questions resolved here (see Gaps section). Results determine whether WASM compression or SAB fast path is the next investment. No research phase needed — standard benchmark methodology.

---

### Phase 5: SAB Fast Path + Multi-Hop Relay

**Rationale:** Both features require Phase 3 to be proven correct and Phase 4 benchmark data to guide design. SAB fast path requires the transferable fallback to be solid (it is the safety net). The relay requires credit-based backpressure proven correct in single-hop tests before trusting it across hops — building the relay on unproven backpressure is the unbounded-buffer trap. These are deferred v1.x features; grouped because the relay depends on the same CAPABILITY negotiation infrastructure the SAB path extends.

**Delivers:** `transport/sab-ring-buffer.ts` (SPSC wait-free ring buffer, SAB_SIGNAL frame type, Atomics.waitAsync on receiver — NOT Atomics.wait which throws RangeError on main thread); `relay/index.ts` (RelayBridge: routing table + credit-forwarding, zero reassembly, stream ID translation table); backpressure-through-relay test (worker -> main relay -> sandboxed iframe, verify worker pauses when iframe consumer stalls); Playwright cross-browser matrix (Chrome + Firefox + WebKit); strict-CSP Playwright test (sandbox="allow-scripts", no allow-same-origin, verify fallback delivers all chunks in order); error propagation through relay test (CANCEL from iframe propagates RESET to worker within 100ms).

**Features addressed:** SAB ring-buffer fast path; multi-hop relay; backpressure propagation through relay hops; graceful abort propagation through relay hops; Native Transferable ReadableStream delegation (if Safari stable has landed).

**Pitfalls addressed:** Relay OOM credit-forwarding model enforced, pipeTo forbidden in RelayBridge, bounded relay buffer test (P6); SAB capability test with SW endpoint (P14).

**Research flag:** SAB fast path needs `/gsd:research-phase` during planning. `Atomics.waitAsync` browser support nuances and interaction with the CAPABILITY handshake. ringbuf.js is the reference but does not address the postMessage framing layer alongside the ring buffer. Relay architecture is novel — treat as MEDIUM confidence and validate with the bounded-heap benchmark before declaring complete.

---

### Phase 6: Examples + Documentation Site + Publish

**Rationale:** Everything else must be working and benchmarked before examples are written — examples are the proof the library works as claimed. Documentation covers API surfaces, topology patterns, and published benchmark results. This is the final deliverable of the full study. Package name selection is a pre-publish blocker.

**Delivers:** VitePress docs site with API reference, topology guide (single-hop, three-hop relay, strict-CSP iframe), and published benchmark results; live runnable examples embedded in docs; example: basic two-party stream (iframe <-> parent, worker <-> main); example: three-hop relay (worker -> main relay -> strict-CSP sandboxed iframe); example: createWindowEndpoint with origin validation; publint + attw validation in publish CI; npm + JSR publish via GitHub Actions OIDC; sync-jsr-version.mjs script; final package name confirmed available on both registries.

**Features addressed:** Documentation deliverable; examples deliverable; npm + JSR dual publish; publint + attw validation.

**Research flag:** Standard patterns. VitePress, Changesets, and OIDC publish are all well-documented. Package name availability check is a manual pre-publish step.

---

### Phase Ordering Rationale

- **Layer dependency graph drives order.** Framing types block everything. Transport + session internals are pure and fully testable before browser integration. Adapters are built last because they are thin; getting them wrong is cheap to fix.
- **Correctness before performance.** Transferable ArrayBuffer path must be solid and benchmarked before SAB is added. Single-hop backpressure must be proven before relay backpressure is trusted.
- **Benchmarks before optimization decisions.** Phase 4 precedes Phase 5 so SAB and WASM are data-driven decisions, not assumptions.
- **Critical pitfalls front-loaded.** DataCloneError handling, strong endpoint references, origin validation, and the two-entry-point exports structure are all in Phase 1. These are hard to retrofit and have cascading correctness implications.
- **Relay is last non-docs feature** because it requires every earlier component to be correct. The relay is a thin routing table over proven components; building it early on unproven components would mask bugs.

### Research Flags

Phases needing deeper research during planning:
- **Phase 3 (WHATWG Streams backpressure wiring):** If the desiredSize-to-credit-window integration is non-trivial in practice, run `/gsd:research-phase` on "WHATWG Streams push source with external backpressure signal."
- **Phase 5 (SAB fast path):** `Atomics.waitAsync` browser support and interaction with the CAPABILITY handshake needs a focused research pass. ringbuf.js is the reference but does not address the postMessage framing layer alongside the ring buffer.
- **Phase 5 (Relay architecture):** Novel design with no direct prior art. Treat as MEDIUM confidence. Validate credit-forwarding invariant with the bounded-heap benchmark before calling it done.

Phases with standard patterns (skip research phase):
- **Phase 1:** All tools documented; stack choices confirmed; PostMessageEndpoint interface is straightforward.
- **Phase 2:** Credit window follows QUIC RFC 9000. Reorder buffer is a standard sliding-window problem.
- **Phase 4:** Vitest bench + tinybench are documented; benchmark methodology is straightforward.
- **Phase 6:** VitePress, Changesets, OIDC publish are all well-documented.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All tool choices verified against official docs and release notes; version numbers confirmed current as of 2026-04-21 |
| Features | HIGH (table stakes) / MEDIUM (differentiators) | Table stakes grounded in comparable library analysis; SAB availability in real deployed environments is narrower than docs suggest |
| Architecture | HIGH (layers 1-3) / MEDIUM (SAB fast path, relay backpressure) | Layers 1-3 well-understood protocol territory; relay backpressure is novel design with no direct prior art |
| Pitfalls | HIGH | All CRITICAL pitfalls verified against official specs, MDN, or real browser bug trackers |

**Overall confidence:** HIGH for v1 (layers 1-5 without SAB and relay). MEDIUM for v1.x (SAB fast path and relay) — correct design is specified but novel; empirical validation required.

### Gaps to Address

- **Optimal chunk sizes:** Documented estimates (256 KB transferable, 64 KB structured-clone) are extrapolated from external benchmarks. Phase 4 must measure and publish the actual values for this library's framing overhead. Treat chunk size defaults as TBD until Phase 4 completes.

- **SAB availability in real deployed environments:** `crossOriginIsolated` requires COOP + COEP headers, which many CDN-served iframe embeddings cannot set. The SAB fast path may be exercised in under 10% of real deployments. Phase 4 should measure the transferable-path headroom gap relative to SAB; if small, drop SAB milestone priority.

- **Transferable ReadableStream Safari stable timeline:** Safari TP 238 (February 2026) has support; stable has not shipped as of research date. Native stream delegation is blocked on this. Phase 5 should check Safari stable status before investing in the detection path.

- **`initCredit` default value:** Relay and single-hop defaults need to balance startup latency (too small) vs. receiver buffer size (too large). ARCHITECTURE.md suggests 8-16 chunks as a starting estimate. Phase 4 should sweep initCredit values and document the tradeoff.

- **Package name availability:** Must be confirmed available on both npm and jsr before Phase 6. Blocking pre-publish step with no technical dependency.

- **WASM decision trigger:** Explicitly deferred to Phase 4 benchmark data. If Phase 4 shows the transferable path is compute-bound (not bandwidth-bound), the WASM milestone moves to Phase 5 or adds a Phase 5b. If bandwidth saturation is achievable without WASM, compression is deferred to v2+.

---

## Sources

### Primary (HIGH confidence)
- WHATWG Streams specification (streams.spec.whatwg.org) — desiredSize semantics, enqueue advisory behavior, cancel/abort contract
- RFC 9000 (QUIC) — per-stream flow control, credit-based window, WINDOW_UPDATE heuristic, modular sequence comparison
- MDN: Transferable objects, SharedArrayBuffer, ServiceWorker.postMessage — transfer semantics, SAB agent cluster constraints, SW postMessage shape
- MDN: Structured clone algorithm — DataCloneError trigger types
- web.dev/articles/bfcache — BFCache freeze semantics, pagehide/pageshow, workers continue during freeze
- Playwright official docs — SW routing Chromium-only limitation confirmed
- Vitest v4.0 release announcement — browser mode stable, bench/tinybench support
- wasm-bindgen CSP issues #1641, #1647, #3098 — js_sys::global CSP risk documented
- MSRC blog "postMessaged and Compromised" (August 2025) — Window.postMessage origin injection in real supply chain attack
- surma.dev "Is postMessage slow?" — 32 MB: 302ms structured-clone vs 6.6ms transferable benchmark data
- Chrome Developers blog: transferable-objects — 45x clone vs transfer performance difference
- GitHub padenot/ringbuf.js README — SPSC SAB ring buffer, wait-free design, SPSC constraint, TypeScript since v0.4.0

### Secondary (MEDIUM confidence)
- GoogleChromeLabs/comlink README — RPC features, WeakRef proxy, transfer() API (verified via WebFetch)
- MetaMask/post-message-stream README — stream types, Node duplex wrapper, Electron limitation (verified via WebFetch)
- MattiasBuelens/remote-web-streams README — WHATWG Streams design, backpressure gap admission (verified via WebFetch)
- WebKit TP 238 (February 2026) — ReadableStream postMessage transfer in Safari TP (not stable)
- Chrome Status: Streams API transferable streams — browser support status
- GitHub w3c/ServiceWorker #980, mswjs/msw #2115 — Chrome 30s SW idle timeout (real-world observations)
- GitHub fergald/explainer-messageport-close — MessagePort GC with no close event (proposal stage)
- tsdown official docs (tsdown.dev) — bundler choice, Rolldown relationship
- JSR publishing docs — OIDC tokenless publish, jsr.json format
- npm trusted publishing docs — OIDC, id-token:write, provenance auto-generation

### Tertiary (needs empirical validation)
- SAB availability in real iframe deployments: narrow in practice; COOP/COEP required — validate in Phase 4
- `initCredit` optimal default: 8-16 range is an estimate from QUIC design discussion — validate in Phase 4
- Chunk size defaults (256 KB / 64 KB): external benchmark extrapolation — validate in Phase 4

---

*Research completed: 2026-04-21*
*Ready for roadmap: yes*
