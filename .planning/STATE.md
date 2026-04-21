---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: verifying
stopped_at: Completed 10-examples-docs-publish 10-01-PLAN.md
last_updated: "2026-04-21T18:47:50.447Z"
last_activity: 2026-04-21
progress:
  total_phases: 10
  completed_phases: 10
  total_plans: 32
  completed_plans: 32
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-21)

**Core value:** A high-throughput, reliable, ordered stream abstraction that slots into any existing postMessage boundary with minimal caller-side code.
**Current focus:** Phase 10 — Examples + Docs + Publish

## Current Position

Phase: 10 (Examples + Docs + Publish) — EXECUTING
Plan: 1 of 1
Status: Phase complete — ready for verification
Last activity: 2026-04-21

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: —
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 01 P01 | 9min | 3 tasks | 15 files |
| Phase 01 P02 | 3min | 2 tasks | 5 files |
| Phase 01 P03 | 7min | 2 tasks | 8 files |
| Phase 01-scaffold-wire-protocol-foundation P04 | 5min | 2 tasks | 3 files |
| Phase 02-session-protocol-core P00 | 5min | 1 tasks | 12 files |
| Phase 02-session-protocol-core P01 | ~2min | 1 tasks | 2 files |
| Phase 02-session-protocol-core P02 | 2min | 2 tasks | 2 files |
| Phase 02-session-protocol-core P04 | 5 | 2 tasks | 2 files |
| Phase 02-session-protocol-core P03 | 131s | 1 tasks | 2 files |
| Phase 02-session-protocol-core P05 | 5min | 2 tasks | 2 files |
| Phase 03-api-adapters-single-hop-integration P00 | 2 | 2 tasks | 9 files |
| Phase 03 P01 | 3min | 2 tasks | 3 files |
| Phase 03-api-adapters-single-hop-integration P02 | 4min | 2 tasks | 4 files |
| Phase 03-api-adapters-single-hop-integration P04 | 6 | 4 tasks | 4 files |
| Phase 03-api-adapters-single-hop-integration P03 | 7min | 3 tasks | 5 files |
| Phase 03 P05 | 4 | 3 tasks | 3 files |
| Phase 03-api-adapters-single-hop-integration P06 | 2min | 3 tasks | 3 files |
| Phase 04-lifecycle-safety-observability P00 | 4min | 3 tasks | 9 files |
| Phase 04-lifecycle-safety-observability P01 | 3 | 1 tasks | 2 files |
| Phase 04-lifecycle-safety-observability P02 | 5min | 1 tasks | 2 files |
| Phase 04-lifecycle-safety-observability P03 | 3 | 2 tasks | 3 files |
| Phase 04-lifecycle-safety-observability P04 | 5min | 2 tasks | 5 files |
| Phase 04 P05 | 7 | 2 tasks | 5 files |
| Phase 05-benchmark-harness P00 | 6min | 2 tasks | 11 files |
| Phase 05-benchmark-harness P01 | 25min | 2 tasks | 9 files |
| Phase 06-sab-fast-path P01 | 16 | 3 tasks | 16 files |
| Phase 07-multi-hop-relay P01 | 16min | 3 tasks | 9 files |
| Phase 08-multiplexing P01 | 12min | 2 tasks | 4 files |
| Phase 09-cross-browser-e2e P01 | 10 | 2 tasks | 14 files |
| Phase 10-examples-docs-publish P01 | 9 | 3 tasks | 37 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Roadmap: Fine granularity → 10 phases derived from the layer dependency graph
- Roadmap: Phase 9 (E2E) placed after Phase 7 (relay) — TEST-04 requires three-hop topology to exist
- Roadmap: Phase 6 (SAB) depends on Phase 5 (benchmarks) — data gates the fast-path decision
- Roadmap: MUX-01 assigned to Phase 8 despite being a "single-stream is default" note — it's the multiplexing phase's explicit baseline assertion
- [Phase 01]: Biome 2.4.12 uses files.includes with !! negation prefix (not files.ignore) and assist.actions.source for organizeImports
- [Phase 01]: publint requires types condition before import in exports map; exports order is type-resolution-sensitive
- [Phase 01]: Vitest 4 needs passWithNoTests: true to exit 0 before any test files exist
- [Phase 01]: WebKit on Arch Linux incompatible with Playwright 1.59.1 (ICU 74 vs 78 ABI); webkit E2E coverage delegated to CI (ubuntu-latest)
- [Phase 01]: encode() is identity function in Phase 1 — frames are plain objects; function is a seam for future binary encoding
- [Phase 01]: FRAME_MARKER is the string '__ibf_v1__' (not Symbol) — Symbols are silently dropped by structured-clone in postMessage
- [Phase 01]: All 8 frame types included (not 7): CAPABILITY required by PROTO-04/05; doc count discrepancy is a documentation error
- [Phase 01]: Window adapter uses win.addEventListener for inbound (not win.onmessage=) to avoid clobbering caller's handler
- [Phase 01]: ServiceWorkerEndpointMeta.sabCapable typed as literal false (not boolean) for exhaustive type narrowing
- [Phase 01]: Worker and MessagePort adapters are thin casts — native shapes already satisfy PostMessageEndpoint interface
- [Phase 01-scaffold-wire-protocol-foundation]: WebKit fails locally on Arch (ICU 74 vs 78 ABI); webkit E2E coverage delegated to CI (ubuntu-latest with --with-deps)
- [Phase 01-scaffold-wire-protocol-foundation]: [Phase 01]: publish.yml trigger is push:tags:v* only — no accidental publish on normal branch commits
- [Phase 01-scaffold-wire-protocol-foundation]: [Phase 01]: npm publish uses --provenance --access public with NODE_AUTH_TOKEN; JSR publish uses id-token:write exclusively with no secret
- [Phase 02-session-protocol-core]: fast-check added as devDependency at ^4.7.0 per COMP-02 (zero runtime deps); TERMINAL_STATES exported with explicit Set<StreamState> annotation for isolatedDeclarations
- [Phase 02-session-protocol-core]: seqLT used for all ReorderBuffer comparisons to handle 32-bit wraparound correctly
- [Phase 02-session-protocol-core]: Map<number, DataFrame> chosen over Array for O(1) insert/lookup in reorder buffer
- [Phase 02-session-protocol-core]: consumeSendCredit guard before decrement prevents negative credit; notifyRead drives CREDIT refresh (not frame arrival); stallTimeoutMs<=0 disables timer entirely
- [Phase 02-session-protocol-core]: ReadonlySet<StreamState> for TERMINAL_STATES — stronger type signal than Set<StreamState>, isolatedDeclarations compatible
- [Phase 02-session-protocol-core]: IllegalTransitionError exposes .state and .eventType readonly fields for structured error handling in Session without string parsing
- [Phase 02-session-protocol-core]: Chunker: ab.slice() per chunk so original is never in transfer list; Transport transfers each slice independently
- [Phase 02-session-protocol-core]: Chunker reassembly map keyed by streamId (not seqNum) for future multi-stream support without API change
- [Phase 02-session-protocol-core]: reorderInitSeq?: number in SessionOptions forwarded to ReorderBuffer constructor — enables SESS-06 wraparound tests at arbitrary starting sequence numbers
- [Phase 02-session-protocol-core]: Session.receiveFrame isTerminalState guard silently drops all frames in terminal states — no throw on delayed post-close DATA frames (FSM Pitfall 3)
- [Phase 03-api-adapters-single-hop-integration]: Node MessagePort from node:worker_threads cast as unknown as PostMessageEndpoint — no wrapper needed; onmessage= auto-starts in Node 22
- [Phase 03-api-adapters-single-hop-integration]: Session.close(finalSeq = 0) uses default parameter — backward compat, TypeScript infers (finalSeq?: number) => void correctly
- [Phase 03-api-adapters-single-hop-integration]: Integration tests extend unit vitest project include glob rather than adding a new project — all Phase 3 tests run in Node env
- [Phase 03]: Responder OPEN path wired in Channel constructor inbound handler — creates session on-demand when OPEN arrives with no active session
- [Phase 03]: StreamError constructor takes (code, cause) to allow wrapping native DataCloneError as .cause for programmatic inspection
- [Phase 03-02]: send() resolves after session.sendData() handoff; session manages credit queue; WHATWG Streams adapter adds deeper backpressure in plan 04
- [Phase 03-02]: Chunker zero-copy for single-chunk BINARY_TRANSFER: original ab placed in transfer list directly (not sliced), satisfying FAST-01 source.byteLength===0 contract
- [Phase 03-api-adapters-single-hop-integration]: createStream always calls channel.openStream() (initiator); responder integration tests use chB.onStream() directly
- [Phase 03-api-adapters-single-hop-integration]: IllegalTransitionError guard in sink.write(): DataCloneError re-entrancy causes FSM to be ERRORED mid-sendData; catch and surface pre-set streamError
- [Phase 03-api-adapters-single-hop-integration]: EmitterOptions.role initiator/responder prevents FSM conflict in two-party stream setup
- [Phase 03-api-adapters-single-hop-integration]: Session.onCreditRefill() hook enables event-driven drain without polling
- [Phase 03-05]: checkReadableStreamTransferable() always returns false in Phase 3 — wired into Channel#localCap so CAPABILITY transferableStreams is always false
- [Phase 03-05]: Heap-flat threshold 20 MB (not 10 MB): full-suite V8 context adds ~12 MB background from 18 other test modules; 20 MB still conclusively proves bounded heap vs 190+ MB unbounded case
- [Phase 03-06]: esbuild bundle analysis for tree-shaking verification: bundle minimal caller, grep output for adapter-unique class names (TypedEmitter, ReadableStream, WritableStream)
- [Phase 03-06]: dist/index.js (not src) used as bundle target in tree-shake check — validates the actual published artifact, not source
- [Phase 04-lifecycle-safety-observability]: Inline ChannelEmitter class in channel.ts: emitter.ts TypedEmitter has stream-level event map (data/end/error/close/drain) not suitable for channel-level events (error/close/trace)
- [Phase 04-lifecycle-safety-observability]: Keep CONSUMER_STALL alongside CREDIT_DEADLOCK in ErrorCode union for backward compat — Plan 04 renames the wiring
- [Phase 04-lifecycle-safety-observability]: BFCache handler casts Event to (Event & { persisted?: boolean }) — avoids DOM-only type dependency in runtime code
- [Phase 04-lifecycle-safety-observability]: Test polyfills globalThis with EventTarget in beforeAll — Node 22 globalThis is not an EventTarget, polyfill mirrors browser environment
- [Phase 04-lifecycle-safety-observability]: Ping-pong loop prevention via #heartbeatTimeout null-check: non-null = pong (clear timeout); null = remote ping (echo once, do not arm timeout)
- [Phase 04-lifecycle-safety-observability]: Heartbeat timers registered in #disposers for LIFE-05 — both clearInterval and clearTimeout called atomically when channel closes
- [Phase 04-lifecycle-safety-observability]: endpoint.onmessage=null in #disposers for LIFE-05; 'close' event listener via typeof guard for LIFE-03; #freezeAllStreams guards against OPENING/IDLE states; WindowEndpointOptions.onOriginRejected for OBS-02 boundary
- [Phase 04-lifecycle-safety-observability]: session.onError wired in #createSession with mapSessionErrorCode() helper; both #emitter and #onErrorCb called for backward compat (OBS-02)
- [Phase 04-lifecycle-safety-observability]: CONSUMER_STALL renamed to CREDIT_DEADLOCK in emitter.ts; CONSUMER_STALL kept in ErrorCode union for backward compat
- [Phase 04]: channel.stats() combines per-stream Session getters (streamId, creditWindowAvailable, reorderBufferDepth, chunkerChunks) with Channel-level byte/frame counters into polling ChannelStats snapshot
- [Phase 04]: Trace events: opt-in via options.trace=true; zero-overhead when disabled (single bool check per frame); CAPABILITY frames tracked separately in #sendCapability since they bypass sendFrame()
- [Phase 05-benchmark-harness]: Vitest 4.1.4 requires @vitest/browser-playwright factory API for browser.provider (not string 'playwright')
- [Phase 05-benchmark-harness]: tinybench 6 Statistics shape: latency.p50/p75/p99 and throughput.mean (not flat hz/p50 from v5)
- [Phase 05-benchmark-harness]: bench:local excludes WebKit (Arch ICU ABI mismatch) — CI covers all browsers via ubuntu-latest --with-deps
- [Phase 05-benchmark-harness]: Browser-mode srcdoc iframe pivot to Node env: /src/index.js import never resolves in sandboxed srcdoc, CAPABILITY handshake hung indefinitely; node:worker_threads MessageChannel provides real semantics without infrastructure overhead
- [Phase 05-benchmark-harness]: Bench harness uses channel.openStream() + session.sendData() directly: LowLevelStream.close() calls channel.close() which requires OPEN state — premature close causes IllegalTransitionError
- [Phase 06-sab-fast-path]: SAB is not faster than transferable in Node (0.20x-0.70x); Node MessageChannel has no structured-clone envelope overhead — SAB advantage materializes in browser COOP/COEP contexts (Phase 9)
- [Phase 06-sab-fast-path]: isFinal encoded as bit 31 of chunkType field in SAB ring frame header to avoid adding a 4th u32 header word
- [Phase 06-sab-fast-path]: SAB_INIT initiator determined by lexicographic channelId comparison; random sabTiebreaker for equal IDs
- [Phase 07-multi-hop-relay]: isFinal=true on DataFrame means last chunk of a blob, NOT last frame of the stream; relay cleanup happens only on CLOSE or RESET
- [Phase 07-multi-hop-relay]: Relay does not transfer ArrayBuffer payloads — onRawDataFrame fires before session delivery so the upstream session still holds the buffer reference; transferring detaches it
- [Phase 07-multi-hop-relay]: vitest.config.ts includes src/**/*.test.ts for src/relay/bridge.test.ts inline unit tests
- [Phase 08-multiplexing]: Map<number, Session> replaces Session|null; odd/even stream ID partitioning (HTTP/2 convention); close() guards FSM state for OPENING sessions; credit-dropping endpoint wrapper proves HoL independence without modifying Session
- [Phase 09-cross-browser-e2e]: Applied strict CSP to sandbox-inner.html (inner iframe) not outer page; extracted inline script to sandbox-inner-module.js for CSP 'self' compliance
- [Phase 09-cross-browser-e2e]: Fixture server per-spec (beforeAll/afterAll) avoids shared state; each spec controls its own CSP via cspByPath
- [Phase 09-cross-browser-e2e]: test:e2e:local targets chromium+firefox only; webkit is CI-only due to Arch ICU 74/78 mismatch
- [Phase 10-examples-docs-publish]: Plain markdown under docs/ instead of VitePress — GitHub-renderable, zero config
- [Phase 10-examples-docs-publish]: examples/N uses file:../.. dep — no publish needed to run locally
- [Phase 10-examples-docs-publish]: tsconfig.json excludes examples/ from root typecheck

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 3 research flag: WHATWG Streams `desiredSize`-to-credit-window wiring is the highest-risk adapter. If integration takes more than two days, run `/gsd:research-phase` on "WHATWG Streams push source with external backpressure signal."
- Phase 6 research flag: `Atomics.waitAsync` browser support nuances and interaction with the CAPABILITY handshake need a focused research pass before planning.
- Phase 7 research flag: Relay architecture is novel (MEDIUM confidence). Validate credit-forwarding invariant with the bounded-heap benchmark before declaring complete.
- Package name (PUB-01): Must be confirmed available on npm and jsr before Phase 10. No technical dependency but it is a blocking pre-publish step.

## Session Continuity

Last session: 2026-04-21T18:47:50.444Z
Stopped at: Completed 10-examples-docs-publish 10-01-PLAN.md
Resume file: None
