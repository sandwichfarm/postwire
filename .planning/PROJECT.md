# iframebuffer *(working name)*

## What This Is

A JavaScript library (with WASM if benchmarks justify it) that streams arbitrary data at high bitrate over any postMessage boundary — iframe, web worker, service worker, MessageChannel. Consumers import it on both sides of a boundary and wire it into their existing postMessage handlers rather than replacing the channel. The library handles framing, chunking, ordering, and feature-detected fast paths (SharedArrayBuffer when available) so the caller gets stream semantics out of what's normally a one-shot message API.

The audience is developers who already have postMessage wiring — sandboxed iframes, worker pools, service-worker caches, cross-origin embeds — and want to push real data volume across it without reinventing framing each time.

## Core Value

**A high-throughput, reliable, ordered stream abstraction that slots into any existing postMessage boundary with minimal caller-side code.**

If everything else gets cut, these three properties must hold: (1) it works wherever postMessage works, (2) the caller wires it into their own channel, (3) it measurably beats naive postMessage chunking.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- Current scope. Building toward these. -->

- [ ] Stream primitive that wraps any caller-provided postMessage endpoint (iframe, worker, service worker, MessageChannel port)
- [ ] Reliable, ordered delivery (TCP-like semantics) for arbitrary chunks
- [ ] Handles binary (ArrayBuffer/TypedArray), streams (ReadableStream), and structured-clone payloads — fast path chosen per data type
- [ ] End-to-end stream semantics across proxy hops (worker → main-thread relay → sandboxed iframe presents as one logical stream)
- [ ] Feature-detected SharedArrayBuffer fast path, with postMessage-transferable fallback when cross-origin isolation / sandbox prevents SAB
- [ ] WHATWG Streams API surface (`{ readable, writable }`) as the primary ergonomics
- [ ] Node-style EventEmitter API surface as an alternate wrapper
- [ ] Low-level `send` / `onChunk` API surface for callers who want to build their own abstractions
- [ ] Optional multiplexing — multiple concurrent logical streams over one channel, with per-stream framing IDs
- [ ] Benchmark harness comparing the library against naive postMessage across data types, sizes, and topologies
- [ ] Example: basic two-party stream (iframe ↔ parent, worker ↔ main)
- [ ] Example: three-hop proxy (worker ingests live stream → main-thread relay → strict-CSP sandboxed iframe)
- [ ] Works across Chrome, Firefox, Safari (latest-2 evergreen)
- [ ] Shipped to npm and jsr under a short, available, catchy name *(name TBD — `iframebuffer` is a working placeholder)*
- [ ] Documentation covering API surfaces, topology patterns, and benchmark results
- [ ] Cross-context test suite (Playwright driving real iframes + workers)

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Encryption / authentication — origin isolation and caller-supplied crypto cover the threat model; adding it bloats scope and drags in key management.
- RPC / request-response — this is a stream library, not "comlink but faster." Mixing RPC complicates framing and tempts feature creep.
- Automatic reconnection — if the underlying channel dies (iframe unload, worker terminate), streams error out; the caller decides whether to re-open. Reconnection semantics belong to the caller because only they know session state.
- Channel discovery / handshake helpers — caller sets up the MessageChannel / Worker / iframe and hands us a wired endpoint. Bootstrapping belongs to the host application.
- Node / Deno / Bun workers in v1 — their `postMessage` shape is compatible and we should not actively break them, but v1 is browser-focused. Cross-runtime support is a future milestone.
- IE / legacy browsers — evergreen only. Structured clone, Transferable, ReadableStream, and ES modules are hard dependencies.

## Context

This is a **research / curiosity-driven full study**, not a product response to a specific pain point. The deliverable set is broader than a typical library: shippable package + benchmarks + examples + docs, so the project's worth is judged on "did we learn and document how fast postMessage can really go" as much as "did the library work."

**Technical environment:**

- postMessage is the universal cross-context boundary in the browser. Its shape (structured clone + Transferable) varies meaningfully by context: same-origin iframe can share memory via SAB given COOP/COEP, strict-CSP sandboxed iframes usually cannot, workers vary.
- `SharedArrayBuffer` + `Atomics.wait/notify` unlock shared-memory transport but require cross-origin isolation — strict-CSP sandboxed iframes are the hardest case and likely have to use postMessage-transferable fallback.
- `ReadableStream` is itself transferable in modern browsers (2022+), which opens a zero-copy single-stream path that predates anything we'd build — the library must justify its existence against this.
- WASM's role is an open question. JS is likely fast enough for framing; WASM may pay off in optional compression (zstd/lz4) if benchmarks show channel saturation is achievable and compute becomes the next bottleneck.

**Intellectual prior work to look at:**

- `comlink` (Google) — RPC over postMessage, structurally similar wiring model
- `postmate` — parent/child iframe handshake library
- WHATWG Streams spec and its structured-clone/transferable semantics
- Existing SAB + Atomics ring-buffer patterns (e.g., audio worklet → main thread examples)

**Known hard cases to validate against:**

- Three-hop worker → main-thread proxy → strict-CSP sandboxed iframe with no COEP. End-to-end ordering and backpressure must hold even when the middle hop is just a router.
- Large binary payloads (hundreds of MB) where naive postMessage structured-clone melts the GC.
- Live streams where backpressure correctness matters more than raw throughput.

## Constraints

- **Tech stack**: TypeScript source, ESM-first distribution — types shipped, CJS only if cheap. Rationale: modern ecosystem, JSR-native, fewer packaging footguns.
- **Runtime**: Browser-only for v1 (Chrome, Firefox, Safari — latest-2 evergreen). Rationale: focus; cross-runtime is a separate milestone.
- **Dependencies**: Keep runtime deps near-zero. Benchmarks and tests can have dev deps. Rationale: library is meant to slot into security-sensitive contexts (sandboxed iframes, CSP-restricted pages) where each transitive dep is audit surface.
- **Testing**: Cross-context tests must use real browsers via Playwright (browser-harness is already available on this system); mocked postMessage is not sufficient because structured-clone behavior and Transferable semantics vary by real engine.
- **Compatibility**: Must work under strict CSP (`unsafe-eval` and `wasm-unsafe-eval` forbidden) in the postMessage-only fallback path. WASM / SAB paths may relax this with explicit caller opt-in.
- **Performance**: Must materially beat naive postMessage chunking on at least binary payloads — if the benchmark doesn't show a clear win, the library has no reason to exist.
- **Publishing**: Final package name must be available on both npm and jsr. Picking the name is a pre-v1 deliverable.

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Project is research/curiosity-driven, not responding to a specific product need | User framed it as exploring how fast postMessage can go | — Pending |
| Ship as full study: library + benchmarks + examples + docs | Value is as much in the learning artifact as in the package | — Pending |
| Proxy topology uses end-to-end stream semantics (not chained hops) | Cleaner consumer API; the multi-hop case is what pushes the design | — Pending |
| Reliable + ordered delivery only (TCP-like) | Simplifies v1; best-effort / unordered modes are a future milestone if demand emerges | — Pending |
| Feature-detect SharedArrayBuffer, fall back to postMessage transferables | Uncapped ceiling where available, universal fallback where not | — Pending |
| Three API surfaces: WHATWG Streams (primary) + Node EventEmitter + low-level send/recv | Idiomatic composition for each ecosystem; primary is WHATWG | — Pending |
| Multiplexing is optional, not default | Single-stream is the common case and has simpler framing; multiplex is opt-in | — Pending |
| WASM decision deferred to benchmark data | Don't reach for WASM until JS-only hits a measurable ceiling | — Pending |
| No encryption, no RPC, no reconnection, no handshake helpers | Explicit scope boundaries — caller owns those concerns | — Pending |
| Browser-only in v1 (Node / Deno / Bun deferred) | Focus; cross-runtime is a separate milestone | — Pending |
| TypeScript + ESM-first; Playwright for cross-context E2E | Modern defaults; real-browser tests are non-negotiable for this domain | — Pending |
| Package name TBD — must be short, catchy, available on npm and jsr | User preference; pick before v1 publish | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-21 after Phase 10 completion — all 69 v1 requirements shipped. Examples, docs, publish pipeline ready.*
