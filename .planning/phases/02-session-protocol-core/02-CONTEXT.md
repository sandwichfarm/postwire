# Phase 2: Session Protocol Core - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — no grey-area questioning)

<domain>
## Phase Boundary

All per-stream state components are implemented in pure TypeScript, exhaustively unit-tested without a browser, and proven correct through the sequence-number wraparound boundary.

This phase covers:
- `src/session/reorder-buffer.ts` — sequence-ordered delivery with configurable `maxReorderBuffer`, overflow error, wraparound-safe compare via `seqLT`/`seqGT` from Phase 1
- `src/session/credit-window.ts` — QUIC WINDOW_UPDATE-style credit accounting; blocks sender at zero, refreshes credits when receiver drains below half the high-water mark, emits `consumer-stall` on timeout
- `src/session/chunker.ts` — splits oversized payloads into protocol-sized chunks; records all metadata BEFORE `postMessage` so the post-transfer ArrayBuffer is never read again (PITFALLS item 2)
- `src/session/fsm.ts` — per-stream FSM: `idle → open → data → half-closed → closed | errored | cancelled`; explicit `CANCEL` and `RESET` transitions; well-defined for every source/destination pair
- `src/session/index.ts` — pulls the above into a `Session` entity consumers will use from Phase 3 upward (but no real postMessage wiring — that's Phase 3)
- Unit tests: reorder buffer (in-order, out-of-order, overflow, wrap fuzz at `0xFFFFFFF0`), credit window (block/unblock/refresh at half-HWM/stall timeout/consumer-drain trigger), chunker (metadata-before-transfer invariant, chunk sizing, reassembly map), FSM (every valid transition, invalid transitions rejected, `CANCEL` and `RESET` behaviors)
- Property/fuzz tests for the FSM (randomized event sequences preserve invariants) and for sequence wraparound (already partly covered in Phase 1 seq fuzz)

This phase explicitly does NOT include:
- Any `PostMessageEndpoint` wiring or real-browser tests — Phase 3
- Any API adapter (low-level / EventEmitter / WHATWG Streams) — Phase 3
- SAB fast path logic — Phase 6
- Relay / multi-hop logic — Phase 7
- Multiplexing — Phase 8

Requirements covered: SESS-01, SESS-02, SESS-03, SESS-04, SESS-05, SESS-06, TEST-01, TEST-06.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion

This is a pure-TypeScript infrastructure phase. The design is locked by `.planning/research/ARCHITECTURE.md` (Session layer), REQUIREMENTS.md (SESS-01..06), and Phase 1's framing/seq exports. All choices are at Claude's discretion within those constraints:

- Reorder buffer: Map or Array-backed — pick whichever gives cleaner `seqLT` comparisons and bounded worst-case
- Credit window: high-water-mark default configurable; pick 128 or similar as a reasonable default (will be tuned in Phase 5 benchmarks)
- FSM: discriminated union + reducer is idiomatic TypeScript; use a state-transition table to document every valid edge
- Property/fuzz tests: use `fast-check` ONLY IF it qualifies as a **dev** dependency (COMP-02 forbids only *runtime* deps). Adding `fast-check` as a devDependency is acceptable. Otherwise roll a simple deterministic-seed fuzzer.
- Chunker: `maxChunkSize` default to 64 KB (matches typical postMessage optimal size per research); configurable
- Consumer-stall timeout: default 30 seconds; configurable; no timer if `stallTimeoutMs <= 0`
- All session code runs in Node (Vitest node env) — no DOM / no postMessage — this phase must be able to run under `pnpm test` with no browser

Zero-runtime-dep rule still applies (COMP-02). Test-only deps (fast-check, etc.) are fine.

</decisions>

<code_context>
## Existing Code Insights

Phase 1 delivered:
- `src/framing/types.ts` — all 8 Frame types (OPEN, OPEN_ACK, DATA, CREDIT, CLOSE, CANCEL, RESET, CAPABILITY), `FRAME_MARKER`, `PROTOCOL_VERSION`, `ChunkType`, `BaseFrame`
- `src/framing/encode-decode.ts` — `encode(frame): unknown` / `decode(msg): Frame | null` pure functions
- `src/transport/seq.ts` — `seqLT`, `seqGT`, `seqLTE`, `seqNext`, `seqMask` over 32-bit modular arithmetic; `SEQ_BITS`, `SEQ_MASK`, `HALF_WINDOW` constants
- `src/transport/endpoint.ts` — `PostMessageEndpoint` interface (Phase 2 does NOT consume this; Phase 3 does)
- `src/transport/adapters/*` — four adapters (Phase 2 does NOT consume these)

Phase 2 builds on the framing + seq modules only. Do NOT import from `src/transport/adapters/*` in this phase — session logic should be endpoint-agnostic (it accepts Frames and emits Frames, nothing more).

Established patterns from Phase 1:
- ESM imports use `.js` extension in source (TypeScript `moduleResolution: "bundler"` conventions; matches tsdown output)
- Discriminated unions on `.type` tag (see `Frame` union)
- Pure functions where possible; no classes for stateless logic
- Tests colocated under `tests/unit/<module>/`
- Biome + TypeScript 6 strict + `isolatedDeclarations: true` — all exported types must be explicit
- `pnpm vitest run` (no watch mode) for CI-like behavior

</code_context>

<specifics>
## Specific Ideas

- The FSM should be representable as a pure reducer: `reduce(state, event): state | error` so property tests can randomize event sequences cleanly.
- Credit window should expose `desiredSize`-like accessor so Phase 3's WHATWG Streams adapter can wire it directly without plumbing (SESS-03 requirement).
- The chunker must capture `byteLength` BEFORE the user hands us the buffer, because reading after `postMessage(msg, [buf])` would hit a detached-buffer error. Unit tests should prove this invariant — wrap a test in a guard that attempts to access the source after simulated transfer and assert it's handled.
- Reorder buffer's wrap fuzz: extend the Phase 1 seq fuzz into a reorder-buffer scenario where ~64 frames cross `0xFFFFFFF0 → 0x00000010`.
- FSM `CANCEL` vs `RESET` differ in semantics: `CANCEL` is initiated by consumer (discard remaining data); `RESET` is initiated by producer or an error condition (drop and emit error). Document explicitly.
- Property test style: if not using `fast-check`, seed deterministic RNGs from a constant and log any failure's seed for reproducibility.

</specifics>

<deferred>
## Deferred Ideas

- Wiring `Session` into a real `PostMessageEndpoint` — Phase 3
- WHATWG Streams adapter (uses `desiredSize` from credit window) — Phase 3
- SAB ring buffer + Atomics wait — Phase 6
- Relay bridge and credit-forwarding — Phase 7
- Multiplexer (per-stream credit windows over one channel) — Phase 8
- Observability hooks — Phase 4 (but leave clean extension points here)

</deferred>
