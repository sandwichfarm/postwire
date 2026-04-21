# Phase 7: Multi-Hop Relay - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning
**Mode:** Auto-generated with grey-area defaults (YOLO)

<domain>
## Phase Boundary

A relay context can forward a stream between two endpoints with end-to-end backpressure, bounded memory, and bidirectional error propagation — without reassembling payloads.

This phase covers:
- `src/relay/bridge.ts` — `createRelayBridge(upstream: Channel, downstream: Channel, options?) → RelayBridge` that routes DATA frames between the two channels in both directions
- Frame routing table — stream IDs from the upstream side are mapped to stream IDs on the downstream side (and vice-versa); the relay presents as one logical stream to the endpoint consumers
- Credit forwarding — the relay's outbound credit window is bounded by `min(upstreamCreditWindow, downstreamCreditWindow)`; when downstream issues CREDIT, relay propagates upstream; when upstream would produce but downstream window is empty, the relay STALLS, not buffers
- No reassembly — DATA frames pass through as serialized binary chunks; the relay NEVER calls `Chunker.reassemble` on upstream chunks before forwarding. Each chunk is written to downstream exactly as received.
- Cancel / reset propagation — a CANCEL from downstream triggers RESET upstream within 100 ms; RESET from upstream surfaces as error on downstream
- End-to-end FSM — stream state is preserved across the hop: OPEN on upstream triggers OPEN on downstream with the same logical identity; CLOSE on either propagates

This phase explicitly does NOT include:
- Multi-hop chains longer than two (a->relay->b->relay->c) — Phase 8 multiplex may explore; otherwise callers compose bridges manually
- Browser-side relay tests (real iframe + worker + main-thread relay in a browser) — Phase 9 Playwright scenarios
- Relay over SAB fast path — possible but deferred; Phase 7 uses postMessage transport only (relay buffers are tiny, SAB doesn't help here)
- Multiplexing — Phase 8

Requirements covered: TOPO-02, TOPO-03, TOPO-04.

</domain>

<decisions>
## Implementation Decisions

### Stream identity across the hop

The relay maintains a stream-ID translation table: each upstream stream gets a separate downstream stream ID. The table is `Map<upstreamStreamId, downstreamStreamId>` + reverse map. This keeps wire-protocol invariants clean (both channels negotiate their own OPEN/OPEN_ACK with their own stream IDs) while the RELAY presents as one logical stream to callers.

For TOPO-04: at the public API surface (if one is exposed), the relay exposes a single logical `streamId` that maps to both channel sides. The caller can trace a chunk end-to-end by this logical ID even though internally two different IDs are used.

### Credit forwarding

- Relay subscribes to CREDIT frames on the downstream channel
- When downstream issues CREDIT(n), relay forwards an equivalent CREDIT to upstream (after subtracting any credits the relay has already committed for in-flight frames)
- Relay's own bounded memory is at most `downstreamCredit * maxChunkSize` — typically 128 * 64 KB = 8 MB
- Relay never enqueues beyond this bound; if the downstream side doesn't accept a frame (full buffer), relay doesn't pull from upstream

### Frame pass-through

- Relay listens for `channel.on('trace', ...)` or a new channel-internal hook `channel.onForeignFrame(cb)` to observe raw DATA frames without reassembly
- For this phase, the cleanest path is to add an internal `Channel.onRawFrame(cb)` that fires for DATA frames after framing but before session delivery; the relay uses it to pick up each frame and re-emit on the other side via a parallel `Channel.sendRawFrame(frame)` method
- This respects the existing session layer — relay doesn't bypass framing, it bypasses reassembly

### Cancel / reset

- Downstream `session.cancel(streamId)` → relay catches the CANCEL frame via `onRawFrame` and emits RESET upstream via `sendRawFrame` within the same tick (target < 100 ms)
- Upstream `session.reset(streamId)` → relay propagates as error to downstream (via the existing error event path)

### Error surface

- Both channels have `channel.on('error', ...)` from Phase 4. Relay listens to both; on either side erroring, propagate to the other via session.reset(streamId) or appropriate error code.
- Relay exposes its own `bridge.on('error', handler)` event for bridge-level failures (both channels dead simultaneously, routing table corruption, etc.)

### Testing

- Pure Node with MessageChannel triplet (three Channel instances, three endpoints): producer → relay → consumer
- 10 MB stream transfer end-to-end
- Heap-flat test: producer writes as fast as possible, consumer reads 1 chunk/sec; relay heap stays bounded regardless of producer rate
- Cancel propagation timing test: 100 ms latency budget verified
- FSM consistency: both producer and consumer see expected state transitions

### Claude's Discretion

- Exact internal method names, whether `onRawFrame` is a public Channel addition or a relay-only hook, whether to expose `bridge.stats()` (probably yes, mirrors channel.stats)
- Default credit pass-through ratio (1:1 recommended; anything else complicates the FSM)

</decisions>

<code_context>
## Existing Code Insights

Phase 3's Channel already separates framing from session delivery. Phase 4's stats/trace infrastructure covers the observability we need for the relay. Phase 6's SAB is orthogonal — relay goes over postMessage only in v1.

The ARCHITECTURE.md design for relay explicitly said: "routing table, not a pipe; never call `.pipeTo()` across the relay boundary; credit-forwarding table; 30-50 lines of code once Channel exists". The minimal implementation is small; the tests are the hard part.

</code_context>

<specifics>
## Specific Ideas

- Prefer a single `src/relay/bridge.ts` file with the `RelayBridge` class — no separate modules for routing table, credit window, etc. They're all internal.
- Test with TWO Node MessageChannel pairs and THREE Channel instances: `A ↔ Mup ↔ Mdown ↔ B` where the middle Channel relays.
- The heap-flat test is the most important one — it's what differentiates this relay design from a naive buffering relay.

</specifics>

<deferred>
## Deferred Ideas

- Real-browser three-hop topology (worker → main-thread relay → sandboxed iframe) — Phase 9
- Relay over SAB — future
- Multiplexed relay (many streams over one relay) — Phase 8 explores multiplex; relay + multiplex is additive

</deferred>
