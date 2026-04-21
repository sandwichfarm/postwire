# Phase 8: Multiplexing - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning
**Mode:** Auto-generated (YOLO)

<domain>
## Phase Boundary

Multiple concurrent logical streams can share one endpoint in opt-in multiplex mode; each stream has an independent credit window so a stalled stream cannot block others.

This phase covers:
- Channel refactor: `#session: Session | null` → `#sessions: Map<number, Session>` with routing on incoming frame's `streamId`
- Stream allocator: `channel.openStream()` allocates a unique `streamId` in multiplex mode; defaults to 0 in single-stream mode
- `options.multiplex: boolean` opt-in (default false)
- Per-stream independence: HoL-blocking test — four streams, one stalled, others progress
- `channel.stats()` returns per-stream stats array when multiplex mode is active; single-stream shape unchanged when multiplex = false
- Wire format: frame `streamId` field already exists (Phase 1 PROTO-02) — no wire changes needed

This phase explicitly does NOT include:
- Multiplexed SAB transport (SPSC ring buffer is single-stream by design) — future
- Multiplexed relay (relay + multiplex is additive; composable once both exist) — follow-up

Requirements covered: MUX-01, MUX-02, MUX-03.

</domain>

<decisions>
## Implementation Decisions

### Single-stream invariant

When `options.multiplex !== true`, Channel behaves exactly as before — one session, `streamId = 0`, no extra overhead. Wire format unchanged (MUX-01). Tests for the default case must show byte-for-byte identical behavior.

### Multiplex activation

`createChannel(endpoint, { multiplex: true })` on both sides enables multiplex mode. Capability handshake negotiates `multiplex: boolean` via CAPABILITY frame; both must agree. One-sided opt-in falls back to single-stream (never silently accept multiplex with only one side ready).

### Stream allocator

- Initiator side allocates odd stream IDs (1, 3, 5, ...)
- Responder side allocates even stream IDs (2, 4, 6, ...)
- Convention mirrors HTTP/2 stream ID rules; avoids collision without an explicit handshake per stream

### Session lifecycle

- `channel.openStream()` returns a Session-like handle; under the hood, allocates a streamId, opens a new Session, stores in `#sessions.set(streamId, session)`
- Inbound OPEN creates a responder-side Session on demand and adds to the map; emits `'stream'` event for consumers
- On CLOSE/CANCEL/RESET, the Session is removed from the map after terminal state
- `channel.close()` closes all sessions and clears the map

### HoL-blocking test (MUX-02 proof)

Open 4 streams. Stream 2's consumer doesn't read any chunks (credit hits zero). Other 3 streams' consumers drain normally.

Measured: streams 1, 3, 4 complete; stream 2 reports credit_available=0 and no delivery progress. Time threshold: all non-stalled streams finish within 2 s of sending.

### Per-stream stats

`channel.stats()` already has a per-stream nested structure from Phase 4 (`streamStats: Map<streamId, StreamStats>`). Confirm it works for multiple concurrent streams. Add a dedicated test.

### Backwards compat

Every existing test (313-332 tests) must continue to pass. The default path (no multiplex option) is the golden path.

</decisions>

<code_context>
## Existing Code Insights

- src/channel/channel.ts currently has `#session: Session | null` — refactor to Map
- `onmessage` handler already routes frames by type; add streamId routing for DATA/CREDIT/CANCEL/RESET/CLOSE
- CAPABILITY frame's `capabilities` object can carry `multiplex: boolean`
- Session class is independent per-instance; no changes needed inside Session
- RelayBridge (Phase 7) already handles multiple streams via its translation table — relay will automatically work with multiplex because the stream-ID routing is already stream-aware

</code_context>

<specifics>
## Specific Ideas

- Stream ID allocator: `#nextStreamId: number` starts at 1 (initiator) or 2 (responder); increments by 2 per allocation
- Wrap concern: streamIds are 32-bit (same as seq numbers); allocation exhaustion at 2 billion streams per channel — not a realistic concern for v1
- Test strategy: single Node process, one MessageChannel pair, two Channels with multiplex enabled; open 4 streams concurrently, run HoL test

</specifics>

<deferred>
## Deferred Ideas

- Multiplex + SAB (complex design; single-stream SAB is enough for v1)
- Multiplex + Relay (additive; works with no extra code once both exist)
- Priority hinting across streams (fairness) — future feature
- Stream ID exhaustion recovery — not needed for v1 use cases

</deferred>
