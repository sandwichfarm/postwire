# Milestones

## v1.0 iframebuffer v1.0 (Shipped: 2026-04-21)

**Phases completed:** 10 phases, 32 plans, 56 tasks

**Key accomplishments:**

- Complete TypeScript library toolchain bootstrapped: tsdown 0.21.9 + Vitest 4 + Playwright 1.59.1 + Biome 2.4.12 + Changesets, producing publint-clean two-entry ESM package with zero runtime deps
- 8-type Frame discriminated union with FRAME_MARKER sentinel, encode()/decode() pure functions, and TCP-style 32-bit wraparound-safe seq arithmetic — 40 unit tests all green
- PostMessageEndpoint interface defined with origin-validating Window adapter, three thin-cast adapters, and sabCapable:false ServiceWorker metadata; all Phase 1 public exports wired in src/index.ts
- GitHub Actions CI and OIDC dual-publish workflows wired; all five Phase 1 ROADMAP success criteria verified green with chromium+firefox E2E passing and webkit delegated to CI
- One-liner:
- One-liner:
- One-liner:
- One-liner:
- One-liner:
- One-liner:
- Phase 3 directory scaffold + MockEndpoint helper + Session.close(finalSeq?) patch enabling correct CLOSE frame emission from the Channel layer
- Channel class with CAPABILITY handshake, frame routing, encode/decode wiring; StreamError typed error class
- createLowLevelStream factory with BINARY_TRANSFER zero-copy path — FAST-01 proven via real Node MessageChannel detach semantics
- Node-style EventEmitter adapter with in-module TypedEmitter (~40 LoC), drain event via Session.onCreditRefill(), and initiator/responder role option for two-party stream setup
- WHATWG Streams adapter (`createStream`) with full backpressure wiring via `desiredSize↔credit` and DataCloneError routing to typed `StreamError{code:'DataCloneError'}`
- Heap-flat slow-consumer test proving credit window bounds memory growth (SESS-03/TEST-02) and transferable ReadableStream probe (FAST-02) disabled in Phase 3
- Named exports wired for all three adapters + Channel + StreamError; esbuild bundle analysis confirms tree-shaking eliminates unused adapters
- 1. [Rule 2 - Missing functionality] Added `#options` field to Channel
- RED:
- Implementation in `src/channel/channel.ts`:
- MessagePort 'close' event wired to CHANNEL_CLOSED via disposers; LIFE-05 onmessage cleanup; WindowEndpointOptions.onOriginRejected hook for OBS-02
- All OBS-02 error codes (PROTOCOL_MISMATCH, DataCloneError, CREDIT_DEADLOCK, REORDER_OVERFLOW) routed through channel.on('error') as typed StreamError; CONSUMER_STALL renamed to CREDIT_DEADLOCK
- channel.stats() returns ChannelStats with bytesSent, bytesReceived, frameCountsByType, creditWindowAvailable, and reorderBufferDepth; trace events fire on every inbound/outbound frame when options.trace=true
- Vitest 4 browser-mode bench harness with three-browser config, chunked-getRandomValues payload factories, iframe/worker context harnesses, JSON reporter, regression comparator, and nightly CI workflow
- Node-mode benchmark scenarios replacing browser-mode harness — three scenario families running in < 30s locally using node:worker_threads MessageChannel
- `deferred`
- One-liner:
- Raw-frame hooks on Channel (onRawDataFrame/onRawControlFrame/sendRawFrame) + RelayBridge routing table with end-to-end credit forwarding, proven by 10 MB relay test, 8.76 MB heap bound, and 0.32 ms cancel latency
- Channel refactored to Map<number, Session> with odd/even stream ID allocation; HoL-blocking proved via credit-dropping endpoint — stalled stream 3 (credit=0) cannot block streams 1, 5, 7 (each delivering 32 chunks in 2 s)
- Playwright E2E suite covering iframe/worker two-party, three-hop relay, and strict-CSP scenarios across Chromium and Firefox (10 tests, all passing)
- README + 10 markdown doc pages + 5 vite-runnable examples + npm/jsr publish dry-run pipeline with CI version-sync

---
