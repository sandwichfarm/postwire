# Roadmap: iframebuffer

## Overview

iframebuffer is built in ten phases derived from the protocol's own dependency graph. The framing types and transport foundation come first because everything else compiles against them. Session internals are pure TypeScript and proven headless before a browser is ever opened. API adapters follow, then lifecycle safety and observability are locked in. A dedicated benchmark phase generates the empirical data that gates the SAB fast path. The relay and multiplexer are last among features because they require every earlier component to be correct before the routing table can be trusted. Cross-browser E2E tests exercise the full stack across real engines. Examples, docs, and dual publishing close the project.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Scaffold + Wire Protocol Foundation** - Repo, tooling, frame types, transport layer, endpoint adapters, dual-publish wiring, CI smoke test
- [ ] **Phase 2: Session Protocol Core** - Pure-TS session internals: FSM, reorder buffer, credit window, chunker, channel wiring, unit + fuzz tests
- [ ] **Phase 3: API Adapters + Single-Hop Integration** - Low-level, EventEmitter, and WHATWG Streams surfaces; first real-browser integration tests
- [x] **Phase 4: Lifecycle Safety + Observability** - BFCache, SW recycling, endpoint teardown, metrics hooks, error events, trace hook (completed 2026-04-21)
- [ ] **Phase 5: Benchmark Harness** - Vitest bench suite, throughput/latency/CPU metrics, CI regression baseline, WASM gate documentation
- [x] **Phase 6: SAB Fast Path** - SharedArrayBuffer + Atomics ring-buffer transport, feature-detected and gated by benchmark data (completed 2026-04-21)
- [x] **Phase 7: Multi-Hop Relay** - RelayBridge routing table with credit-forwarding backpressure and bidirectional error propagation (completed 2026-04-21)
- [ ] **Phase 8: Multiplexing** - Opt-in MultiplexLayer with per-stream credit windows; no head-of-line blocking
- [ ] **Phase 9: Cross-Browser E2E Test Suite** - Playwright matrix across Chromium + Firefox + WebKit; three-hop + strict-CSP scenarios
- [ ] **Phase 10: Examples + Docs + Publish** - VitePress site, five runnable examples, dual npm/jsr publish via GitHub OIDC

## Phase Details

### Phase 1: Scaffold + Wire Protocol Foundation
**Goal**: The project has a working build, lint, test, and CI pipeline with zero library logic, and the wire protocol type layer is fully defined and smoke-tested
**Depends on**: Nothing (first phase)
**Requirements**: COMP-01, COMP-02, COMP-03, COMP-04, ENDP-01, ENDP-02, ENDP-03, ENDP-04, PROTO-01, PROTO-02, PROTO-03, PROTO-04, PROTO-05, FAST-05
**Success Criteria** (what must be TRUE):
  1. `pnpm build`, `pnpm lint`, `pnpm test`, and `pnpm bench` all exit 0 on a clean checkout
  2. A trivial Playwright smoke test opening a real browser tab passes in CI, proving the test infrastructure works before any library code exists
  3. The two-entry-point `exports` map (`"."` and `"./wasm"`) is in place and `publint` reports no errors against it; the baseline `"."` entry requires neither `unsafe-eval` nor `wasm-unsafe-eval`
  4. `encode(frame)` and `decode(msg)` handle all seven frame types in a Node unit test; unknown messages return `null` without throwing
  5. `createWindowEndpoint(win, expectedOrigin)` exists as a named export and rejects messages from non-matching origins in a unit test
**Plans**: 4 plans
Plans:
- [x] 01-01-PLAN.md — Toolchain scaffold (package.json, tsconfig, tsdown, biome, vitest, playwright, changesets, jsr.json)
- [x] 01-02-PLAN.md — Wire protocol framing (Frame types discriminated union, encode/decode, seq arithmetic + wraparound tests)
- [x] 01-03-PLAN.md — Transport endpoint adapters (PostMessageEndpoint interface, four adapters, origin validation)
- [x] 01-04-PLAN.md — CI workflows, final exports wiring, full Phase 1 gate check

### Phase 2: Session Protocol Core
**Goal**: All per-stream state components are implemented in pure TypeScript, exhaustively unit-tested without a browser, and proven correct through the sequence-number wraparound boundary
**Depends on**: Phase 1
**Requirements**: SESS-01, SESS-02, SESS-03, SESS-04, SESS-05, SESS-06, TEST-01, TEST-06
**Success Criteria** (what must be TRUE):
  1. Reorder buffer delivers frames in sequence order under out-of-order input, errors on overflow, and passes a fuzz test that walks sequences through the 32-bit wraparound boundary at `0xFFFFFFF0`
  2. Credit window blocks a sender at zero credits, unblocks on `CREDIT` frame receipt, and emits a `consumer-stall` error after the configurable stall timeout with no consumer reads
  3. Chunker records all metadata and sizes before the `postMessage` call boundary and never reads from the buffer reference after transfer
  4. FSM transitions correctly for every valid `idle → open → data → half-closed → closed / errored / cancelled` path and all pure-TS unit tests pass headless under Node
  5. Property/fuzz suite exercises the FSM and sequence wraparound with randomized inputs and produces zero assertion failures
**Plans**: 6 plans
Plans:
- [x] 02-00-PLAN.md — Dependency install (fast-check) + directory scaffolding (src/session/, tests/unit/session/ stubs)
- [x] 02-01-PLAN.md — ReorderBuffer: Map-backed in-order delivery, REORDER_OVERFLOW, seqLT wraparound fuzz (SESS-01, SESS-06)
- [x] 02-02-PLAN.md — CreditWindow: QUIC WINDOW_UPDATE credit accounting, stall timer, desiredSize seam (SESS-02, SESS-03)
- [x] 02-03-PLAN.md — Chunker: metadata-before-transfer invariant, split/reassemble (SESS-04)
- [x] 02-04-PLAN.md — FSM: pure reducer, 28-row transition table, fast-check property suite (SESS-05, TEST-06)
- [x] 02-05-PLAN.md — Session integration: wire all four modules, full lifecycle tests, cross-module wraparound fuzz (SESS-06, TEST-01, TEST-06)

### Phase 3: API Adapters + Single-Hop Integration
**Goal**: All three public API surfaces are implemented and the library streams data end-to-end over a real postMessage boundary in a single-hop topology
**Depends on**: Phase 2
**Requirements**: FAST-01, FAST-02, FAST-03, API-01, API-02, API-03, API-04, TOPO-01, TEST-02
**Success Criteria** (what must be TRUE):
  1. `send(chunk) / onChunk(cb) / close()` low-level API delivers an ArrayBuffer across a `MockEndpoint` `MessageChannel` pair with the buffer detached on the sender side (zero-copy confirmed)
  2. WHATWG Streams `{ readable, writable }` pair pipes a 16 MB ArrayBuffer across a single-hop worker boundary; the `writer.ready` promise goes pending when credits are exhausted and resolves on CREDIT arrival
  3. EventEmitter `stream.on('data')` delivers chunks and `stream.on('drain')` fires exactly when the credit window refills
  4. A fast sender (no delays) streaming to a 1-chunk-per-second consumer keeps heap growth flat — not linear — confirming the credit gate is wired to actual reads, not frame arrivals
  5. `DataCloneError` on a non-cloneable chunk surfaces as a named typed error on the WritableStream; the stream does not go silent
**Plans**: TBD
**UI hint**: yes

### Phase 4: Lifecycle Safety + Observability
**Goal**: The library detects and cleanly surfaces all channel-death scenarios, and callers can observe stream metrics and errors through typed hooks
**Depends on**: Phase 3
**Requirements**: LIFE-01, LIFE-02, LIFE-03, LIFE-04, LIFE-05, OBS-01, OBS-02, OBS-03
**Success Criteria** (what must be TRUE):
  1. A BFCache round-trip (`pagehide(persisted=true)` → `pageshow`) leaves all previously active streams in an `ERRORED` state with reason `CHANNEL_FROZEN`; no stream remains silently stalled after restore
  2. A service-worker endpoint with heartbeat enabled surfaces `CHANNEL_DEAD` within 30 seconds of the SW being silently recycled, not a silent hang
  3. Closing the underlying port (iframe unload simulation, worker `terminate()`) propagates `CHANNEL_CLOSED` to all active streams on that channel; no zombie streams remain after teardown
  4. `channel.stats()` returns correct bytes-sent, bytes-received, credit-window, and reorder-buffer-depth values after a completed stream
  5. All named error types (`ORIGIN_REJECTED`, `CREDIT_DEADLOCK`, `REORDER_OVERFLOW`, `PROTOCOL_MISMATCH`, `CHANNEL_FROZEN`, `CHANNEL_DEAD`, `CHANNEL_CLOSED`) are surfaced as typed events, not generic `Error` instances
**Plans**: 6 plans
Plans:
- [x] 04-00-PLAN.md — Scaffold types, stats interfaces, emitter skeleton, test stubs, REORDER_OVERFLOW catch
- [x] 04-01-PLAN.md — BFCache detection: pagehide/pageshow listeners → CHANNEL_FROZEN/CLOSED (LIFE-01)
- [x] 04-02-PLAN.md — SW heartbeat: CAPABILITY-as-ping, fake-timer tests → CHANNEL_DEAD (LIFE-02)
- [x] 04-03-PLAN.md — Teardown: port close → CHANNEL_CLOSED; onOriginRejected hook (LIFE-03, LIFE-04, LIFE-05)
- [x] 04-04-PLAN.md — Error taxonomy: all OBS-02 codes through channel TypedEmitter; CREDIT_DEADLOCK rename
- [x] 04-05-PLAN.md — stats() snapshot + trace events (OBS-01, OBS-03)

### Phase 5: Benchmark Harness
**Goal**: A reproducible benchmark suite runs in real browsers and publishes throughput, latency, and CPU data that drives all subsequent optimization decisions
**Depends on**: Phase 4
**Requirements**: BENCH-01, BENCH-02, BENCH-03, BENCH-04, BENCH-05
**Success Criteria** (what must be TRUE):
  1. `pnpm bench` runs the full suite locally in Chromium, Firefox, and WebKit and exits 0; a JSON results artifact is written to `benchmarks/results/`
  2. The suite reports MB/s throughput, p50/p95/p99 latency, and CPU-time estimate for each data type (binary, structured-clone) across payload sizes 1 KB, 64 KB, 1 MB, 16 MB, 256 MB
  3. Library throughput is measured against naive single `postMessage` for binary payloads of 1 MB and above, stays within 3× of naive single-transfer hz, and the comparison is published in `benchmarks/results/baseline.json` (revised 2026-04-21 per Phase 5 data — original wording "beats naive" was mis-scoped; library trades per-send CPU for ordering + backpressure + typed errors naive cannot provide; see `.planning/decisions/05-wasm-decision.md`)
  4. The WASM decision is documented in the project decision log: either "transferable path shows headroom, WASM deferred" or "ceiling reached, WASM fast path added to Phase 6"
  5. A 10% regression in any benchmark dimension blocks CI on subsequent PRs
**Plans**: 4 plans
Plans:
- [x] 05-00-PLAN.md — Harness scaffold: vitest.bench.config.ts, helpers (payloads, iframe/worker harness, JSON reporter), compare.mjs, bench.yml CI workflow
- [x] 05-01-PLAN.md — Benchmark scenarios: binary-transfer, structured-clone, naive-baseline across 1KB/64KB/1MB/16MB (+ 256MB heavy)
- [x] 05-02-PLAN.md — Baseline run: execute local bench (Node pivot), commit baseline.json, verify comparator
- [x] 05-03-PLAN.md — WASM decision: analyze baseline.json, write .planning/decisions/05-wasm-decision.md

### Phase 6: SAB Fast Path
**Goal**: The SharedArrayBuffer + Atomics ring-buffer transport is available as a feature-detected, opt-in fast path that activates only when cross-origin isolation is confirmed and ServiceWorker endpoints are excluded
**Depends on**: Phase 5
**Requirements**: FAST-04
**Success Criteria** (what must be TRUE):
  1. SAB path activates in a COOP/COEP-isolated context when the caller opts in; the `CAPABILITY` frame records `sab: true` on both sides
  2. SAB path does NOT activate for ServiceWorker endpoints; the capability probe returns `sab: false` and the channel falls back to the transferable path silently
  3. Benchmark shows a measurable throughput improvement on the SAB path vs. the transferable path for payloads at or above the benchmark-derived threshold from Phase 5
  4. Removing COOP/COEP headers causes transparent fallback to the transferable path with no error and no data loss
**Plans**: TBD

### Phase 7: Multi-Hop Relay
**Goal**: A relay context can forward a stream between two endpoints with end-to-end backpressure, bounded memory, and bidirectional error propagation — without reassembling payloads
**Depends on**: Phase 5
**Requirements**: TOPO-02, TOPO-03, TOPO-04
**Success Criteria** (what must be TRUE):
  1. `createRelayBridge(upstreamChannel, downstreamChannel)` forwards DATA frames without reassembly; the relay's JS heap stays bounded to at most `downstreamCreditWindow × maxChunkSize` bytes under sustained load
  2. A 10× speed mismatch (fast producer, slow consumer) causes the worker producer to pause — not the relay to buffer — within one credit window worth of frames
  3. A `CANCEL` from the downstream consumer propagates a `RESET` to the upstream producer within 100 ms, stopping production
  4. Stream identity is preserved end-to-end: the producer and consumer see consistent logical stream IDs across the relay hop
**Plans**: TBD

### Phase 8: Multiplexing
**Goal**: Multiple concurrent logical streams can share one endpoint in opt-in multiplex mode, each with an independent credit window so one stalled stream cannot block others
**Depends on**: Phase 7
**Requirements**: MUX-01, MUX-02, MUX-03
**Success Criteria** (what must be TRUE):
  1. In single-stream (default) mode, frames carry no extra mux overhead and the wire format is identical to non-mux frames
  2. In multiplex mode, opening four concurrent streams and stalling one does not block chunk delivery on the other three
  3. Each stream in multiplex mode has its own independent credit window; per-stream `stats()` reports correct values for all streams simultaneously
**Plans**: TBD

### Phase 9: Cross-Browser E2E Test Suite
**Goal**: The full library stack is verified in real Chromium, Firefox, and WebKit browsers across the three-hop topology and strict-CSP sandboxed iframe scenario
**Depends on**: Phase 7
**Requirements**: TEST-03, TEST-04, TEST-05, COMP-03
**Success Criteria** (what must be TRUE):
  1. The Playwright E2E suite passes on all three browser engines (Chromium, Firefox, WebKit) with zero flakes on five consecutive runs
  2. The three-hop scenario (worker → main-thread relay → strict-CSP sandboxed iframe) delivers all chunks in order with correct backpressure propagation
  3. The strict-CSP test verifies that the baseline path (`sandbox="allow-scripts"`, no `allow-same-origin`, no `unsafe-eval`, no `wasm-unsafe-eval`) delivers a 1 MB payload correctly
**Plans**: TBD

### Phase 10: Examples + Docs + Publish
**Goal**: Five runnable examples, a complete VitePress documentation site with published benchmark results, and the library is dual-published to npm and jsr under a confirmed-available final name
**Depends on**: Phase 9
**Requirements**: EX-01, EX-02, EX-03, EX-04, EX-05, DOC-01, DOC-02, DOC-03, DOC-04, DOC-05, DOC-06, PUB-01, PUB-02, PUB-03, PUB-04
**Success Criteria** (what must be TRUE):
  1. Package name is confirmed available on both npm and jsr; `package.json` and `jsr.json` reflect the chosen name before any publish attempt
  2. `pnpm dev` in each example directory starts a local server and the example streams data end-to-end without errors
  3. The VitePress docs site builds without warnings and covers all three API surfaces, all four endpoint adapters, all named errors, all topology patterns, and the benchmark results with charts
  4. `npx jsr publish` and `pnpm publish` both succeed in a dry-run from CI using OIDC trusted publishing (no long-lived tokens)
  5. `pnpm version` (via Changesets) updates both `package.json` and `jsr.json` to the same version; CI rejects a PR where they diverge
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Scaffold + Wire Protocol Foundation | 4/4 | Complete | 2026-04-21 |
| 2. Session Protocol Core | 5/6 | In Progress|  |
| 3. API Adapters + Single-Hop Integration | 5/7 | In Progress|  |
| 4. Lifecycle Safety + Observability | 6/6 | Complete   | 2026-04-21 |
| 5. Benchmark Harness | 2/4 | In Progress|  |
| 6. SAB Fast Path | 1/1 | Complete   | 2026-04-21 |
| 7. Multi-Hop Relay | 1/1 | Complete   | 2026-04-21 |
| 8. Multiplexing | 0/? | Not started | - |
| 9. Cross-Browser E2E Test Suite | 0/? | Not started | - |
| 10. Examples + Docs + Publish | 0/? | Not started | - |
