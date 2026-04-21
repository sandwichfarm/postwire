# Phase 7 Research — Multi-Hop Relay

**Written:** 2026-04-21 (inline, no agent)
**Scope:** TOPO-02, TOPO-03, TOPO-04

## Architecture

The relay is a routing table with credit forwarding — NOT a pipe. It never calls `pipeTo`, never reassembles chunks, never holds more than one credit window of in-flight frames.

```
                  ┌───────────────┐
  Producer (A) ↔  │ Channel Mup   │  ↔  (relay side A)
                  └───────┬───────┘
                          │ RelayBridge
                          │ (routing table +
                          │  credit forwarding)
                          │
                  ┌───────▼───────┐
  (relay side B) ↔│ Channel Mdown │  ↔ Consumer (B)
                  └───────────────┘
```

## Channel additions

Add to `src/channel/channel.ts`:

```ts
/**
 * Subscribe to raw DATA frames as they arrive from the endpoint, BEFORE
 * session-layer reassembly. Used by relay bridges to forward frames
 * without reassembly. Fires once per inbound DATA frame.
 */
onRawDataFrame(cb: (frame: DataFrame) => void): () => void;

/**
 * Subscribe to raw control frames (CREDIT, CANCEL, RESET, CLOSE) as they
 * arrive. Relay uses this for credit forwarding and cancel/reset propagation.
 */
onRawControlFrame(cb: (frame: Frame) => void): () => void;

/**
 * Send a raw frame bypassing the session layer. Used by the relay to
 * forward frames to the peer without going through our own session FSM.
 * The frame is encoded and handed to the endpoint directly.
 */
sendRawFrame(frame: Frame, transfer?: Transferable[]): void;
```

These hooks live alongside the existing session-delivery path. They fire IN ADDITION to the session layer, not INSTEAD OF. The relay disables session ownership by never opening its own streams on the channel; it just observes and forwards.

## RelayBridge implementation

```ts
// src/relay/bridge.ts

export interface RelayBridgeOptions {
  /** Timeout for credit forwarding deadlock detection, default 30s */
  heartbeatMs?: number;
}

export interface RelayBridge {
  /** Observable stats: frames forwarded, credits in flight, streams active */
  stats(): RelayStats;
  /** Dispose all listeners; does not close the underlying channels */
  close(): void;
  on(event: 'error' | 'close', handler: (payload: unknown) => void): void;
}

export function createRelayBridge(
  upstream: Channel,
  downstream: Channel,
  options: RelayBridgeOptions = {},
): RelayBridge {
  const upstreamToDown = new Map<number, number>();
  const downToUpstream = new Map<number, number>();
  const disposers: (() => void)[] = [];

  // Route A→B (upstream data to downstream consumer)
  disposers.push(upstream.onRawDataFrame((frame) => {
    let downStreamId = upstreamToDown.get(frame.streamId);
    if (downStreamId === undefined) {
      // First DATA frame for this stream — allocate downstream side
      downStreamId = nextStreamId();
      upstreamToDown.set(frame.streamId, downStreamId);
      downToUpstream.set(downStreamId, frame.streamId);
      // Open a corresponding downstream stream via raw frame
      downstream.sendRawFrame({ ...OPEN_FRAME, streamId: downStreamId });
    }
    downstream.sendRawFrame({ ...frame, streamId: downStreamId });
  }));

  // Route B→A (consumer cancel/close to producer)
  disposers.push(downstream.onRawControlFrame((frame) => {
    if (frame.type === 'CANCEL' || frame.type === 'RESET') {
      const upStreamId = downToUpstream.get(frame.streamId);
      if (upStreamId !== undefined) {
        upstream.sendRawFrame({ ...frame, type: 'RESET', streamId: upStreamId });
      }
    }
  }));

  // Credit forwarding: downstream CREDIT → upstream CREDIT
  disposers.push(downstream.onRawControlFrame((frame) => {
    if (frame.type === 'CREDIT') {
      const upStreamId = downToUpstream.get(frame.streamId);
      if (upStreamId !== undefined) {
        upstream.sendRawFrame({ ...frame, streamId: upStreamId });
      }
    }
  }));

  // ... (OPEN_ACK, CLOSE propagation, error handling)

  return { stats, close, on };
}
```

## Why heap stays bounded

The relay never buffers. Each frame from upstream is handed to downstream immediately via `sendRawFrame`. If downstream's underlying endpoint backpressures (postMessage channel is full, kernel buffer overrun), that's the OS's problem — the library gives up its reference immediately.

Credit forwarding means: relay does not pull from upstream until downstream has available credit. The whole credit window flows end-to-end through the two channels; the relay is just a translator.

## Cancel propagation timing

CANCEL arriving on downstream triggers `upstream.sendRawFrame` synchronously within the same tick. Measurement target: microseconds, NOT ~100ms. The 100ms budget in SC3 is generous — accounts for event loop scheduling.

## Tests

**`tests/integration/relay-bridge.test.ts`:**
1. Three-endpoint topology: producer A ↔ MessageChannel ↔ relay ↔ MessageChannel ↔ consumer B
2. Send 10 MB binary via producer; assert consumer receives all bytes in order
3. Check relay stats: frames forwarded > 0, streams active during the transfer, stream-ID mapping established
4. After completion: both sides' FSMs are in CLOSED state

**`tests/integration/relay-backpressure.test.ts`:**
1. Producer writes 64 KB chunks as fast as possible for 3 seconds
2. Consumer reads 1 chunk per second (slow consumer)
3. Measure relay heap delta via `process.memoryUsage().heapUsed` before/after
4. Assert delta < 15 MB (upper bound: credit window * chunk size + Vitest overhead)
5. Assert producer-side credit window goes to zero (confirmed via `channel.stats().creditWindowAvailable`)

**`tests/integration/relay-cancel.test.ts`:**
1. Set up three-endpoint topology
2. Producer starts writing a large stream
3. Consumer calls `stream.cancel()` after 5 chunks received
4. Measure time from `cancel()` invocation to producer's `onCancel` handler firing
5. Assert < 100 ms

## Risks

| Risk | Mitigation |
|------|-----------|
| Stream-ID collision between upstream and downstream | Separate maps, each Channel generates its own IDs |
| CLOSE frame not reaching both sides atomically | Propagate CLOSE via `sendRawFrame`; peer FSM handles idempotent close |
| CREDIT frame re-sent causes double-credit | Credit frames are idempotent replays — peer's credit window either bumps or discards duplicates (need to verify Phase 2 CreditWindow handles duplicate CREDIT) |
| Relay never sees CAPABILITY handshake | CAPABILITY is negotiated per-channel, not per-stream — relay doesn't care, each channel has its own |

## Validation Architecture

- `tests/integration/relay-bridge.test.ts` — happy path, 10 MB end-to-end
- `tests/integration/relay-backpressure.test.ts` — TOPO-03 heap-bounded proof (CRITICAL test)
- `tests/integration/relay-cancel.test.ts` — TOPO-02 cancel/reset propagation < 100 ms

All three are pure Node with `node:worker_threads` `MessageChannel`. No browser tests in Phase 7; Phase 9 adds real iframe + worker real-world topology.

## Coverage targets

- 100% on the stream-ID mapping logic
- 100% on credit-forwarding code path
- Fuzz test with random producer/consumer/relay ordering not required (the code is deterministic)
