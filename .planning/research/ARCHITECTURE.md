# Architecture Research

**Domain:** High-throughput postMessage streaming library (TypeScript, browser-only, zero runtime deps)
**Researched:** 2026-04-21
**Confidence:** HIGH for layers 1-3 (well-understood protocol territory); MEDIUM for SAB fast path (real-world availability narrower than docs suggest); MEDIUM for relay backpressure propagation (novel design, no direct prior art)

---

## System Overview

The library is a five-layer stack. Arrows show call direction (caller → callee). Each layer is a clean interface boundary; nothing above a layer reaches through to layers below.

```
┌──────────────────────────────────────────────────────────────────┐
│  LAYER 5: API ADAPTERS                                           │
│  ┌────────────────────┐  ┌─────────────────┐  ┌───────────────┐ │
│  │  WHATWG Streams    │  │  EventEmitter   │  │  Low-Level    │ │
│  │  { readable,       │  │  stream.on()    │  │  send/onChunk │ │
│  │    writable }      │  │  stream.write() │  │  (escape hatch│ │
│  │  (PRIMARY)         │  │  stream.end()   │  │   + foundation│ │
│  └─────────┬──────────┘  └────────┬────────┘  └──────┬────────┘ │
│            │                      │                   │          │
│            └──────────────────────┴───────────────────┘          │
│                                   │ calls                         │
├───────────────────────────────────▼──────────────────────────────┤
│  LAYER 4: STREAM SESSION                                         │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │  StreamSession  (one per logical stream)                  │   │
│  │  · seq counter + reorder buffer                           │   │
│  │  · credit window (send-side + recv-side)                  │   │
│  │  · lifecycle FSM: OPENING → OPEN → CLOSING → CLOSED/ERROR│   │
│  │  · chunk splitter (write-side) + reassembler (read-side)  │   │
│  └────────────────────────────┬──────────────────────────────┘   │
│                               │ calls                             │
├───────────────────────────────▼──────────────────────────────────┤
│  LAYER 3: CHANNEL                                                │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │  Channel  (one per postMessage boundary)                   │   │
│  │  · demuxes incoming frames to StreamSession map            │   │
│  │  · serialises outgoing frames to the transport             │   │
│  │  · optional: MultiplexLayer (stream ID routing)            │   │
│  └────────────────────────────┬──────────────────────────────┘   │
│                               │ calls                             │
├───────────────────────────────▼──────────────────────────────────┤
│  LAYER 2: FRAMING                                                │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │  Framing  (pure encode/decode, no I/O)                     │   │
│  │  · Frame type codec (DATA, CREDIT, OPEN, CLOSE, RESET,    │   │
│  │    CAPABILITY)                                             │   │
│  │  · Chunk type tag codec (binary/clone/stream-ref)          │   │
│  │  · No state — stateless encode(frame) / decode(msg)        │   │
│  └────────────────────────────┬──────────────────────────────┘   │
│                               │ calls                             │
├───────────────────────────────▼──────────────────────────────────┤
│  LAYER 1: TRANSPORT                                              │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │  Transport  (wraps caller-provided endpoint)               │   │
│  │  · PostMessageEndpoint interface (smallest caller contract)│   │
│  │  · fast-path selector: SAB → Transferable → clone         │   │
│  │  · capability probe (run once per channel open)            │   │
│  │  · send(frame, transferList?) / onFrame(handler)           │   │
│  └────────────────────────────┬──────────────────────────────┘   │
│                               │ wraps                             │
├───────────────────────────────▼──────────────────────────────────┤
│  CALLER-PROVIDED                                                  │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │  Any postMessage-compatible object                         │   │
│  │  (MessagePort, Worker, Window, ServiceWorker client,       │   │
│  │   DedicatedWorkerGlobalScope, custom relay adapter)        │   │
│  └───────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

Data flows downward when sending, upward when receiving. Every layer boundary is a TypeScript interface; layers never import from a layer more than one step away.

---

## Component Boundaries

| Component | Responsibility | Does NOT do | Talks to |
|-----------|----------------|-------------|----------|
| Transport | Wraps caller endpoint; selects fast path; emits/receives raw frames | Sequencing, flow control, stream state | Caller's endpoint object |
| Framing | Stateless encode/decode of frame types and chunk type tags | I/O, state management, sequencing | Nobody — pure functions |
| Channel | Demux incoming frames to the correct StreamSession; serialize outgoing frames; hold the StreamSession registry | Stream-level logic (flow control, ordering) | Transport (down), StreamSession map (horizontal) |
| StreamSession | Per-stream state: seq counter, reorder buffer, credit window, lifecycle FSM, chunk splitter + reassembler | Cross-stream routing, transport selection | Channel (up), Framing (down via Channel) |
| API Adapters | Thin wrappers that expose StreamSession over specific ergonomic interfaces (WHATWG Streams, EventEmitter, send/onChunk) | Protocol logic, buffering, flow control | StreamSession only |
| MultiplexLayer (optional) | Routes frames by stream ID within a Channel; per-stream credit accounting when mux is enabled | Transport, framing | Channel |
| RelayBridge (v1.x optional) | Connects two Channels for a multi-hop relay; propagates credits and error signals bidirectionally without inspecting payload | Reassembly, application logic | Two Channel instances |

---

## Endpoint Abstraction

### The Smallest Possible Caller Contract

Every postMessage boundary has these two things. Nothing more is required:

```typescript
interface PostMessageEndpoint {
  // Send data. The library fills in transfer when the fast path demands it.
  postMessage(message: unknown, transfer: Transferable[]): void;

  // Receive data. Library sets this; must not be overwritten after handoff.
  onmessage: ((event: MessageEvent) => void) | null;
}
```

### Why This Is Enough (and No More Is Needed)

- `Worker`, `MessagePort`, `DedicatedWorkerGlobalScope`, and `Window` all have exactly these two members.
- `ServiceWorker` (sending side from a page to a registered SW) also matches: `navigator.serviceWorker.controller.postMessage(msg, transfer)` and the page listens on `navigator.serviceWorker.onmessage`.
- The _inside-service-worker_ direction (SW → client window) uses `client.postMessage(msg, transfer)` — which also matches.
- `BroadcastChannel` does NOT match because it has no `onmessage` setter that can be replaced without a wrapper; it uses `addEventListener`. A caller-supplied thin adapter works around this, but BroadcastChannel is out-of-scope for v1.

### Wrapping Quirks (Handled Inside the Transport Layer)

| Endpoint | Quirk | Transport layer handling |
|----------|-------|--------------------------|
| `Window` | Requires `targetOrigin` as second argument, not `transfer` | Caller passes a pre-bound adapter: `{ postMessage: (msg, t) => win.postMessage(msg, origin, t), onmessage: null }` — 2 lines, not the library's concern |
| `ServiceWorker` | SAB cannot cross agent cluster boundary; DataCloneError on SAB transfer attempt | Transport's capability probe must skip SAB probe for ServiceWorker endpoints (detect via `instanceof ServiceWorker` or a `noSAB: true` hint from the caller) |
| `MessagePort` | Must call `.start()` before messages are received | Not the library's concern; caller's setup step, documented in examples |

### Capability Probe Return Type

```typescript
interface TransportCapabilities {
  sab: boolean;          // SharedArrayBuffer + Atomics available and transferable
  transferable: boolean; // ArrayBuffer transferable (always true in target browsers)
  streams: boolean;      // ReadableStream/WritableStream transferable
}
```

The probe runs once on channel open as a `CAPABILITY` frame exchange (see Frame Types below). Both sides record the result. The fast path used for the entire stream lifetime is `min(local, remote)` — the intersection of what both ends support.

---

## Frame Types and Wire Protocol

Conceptual frame types only — no byte layout here. Each frame is a plain JS object sent via postMessage. The Framing layer validates and serializes them.

### Frame Taxonomy

```
Frame
├── OPEN       — stream handshake (initiator → responder)
├── OPEN_ACK   — stream handshake accept (responder → initiator)
├── DATA       — payload chunk (either direction)
├── CREDIT     — flow control credit grant (receiver → sender)
├── CLOSE      — graceful end of stream (sender → receiver)
├── CANCEL     — consumer-side abort (receiver → sender)
├── RESET      — hard abort with reason (either direction)
└── CAPABILITY — transport capability advertisement (both, on channel open)
```

### Field Schema per Frame Type

| Frame | Fields |
|-------|--------|
| `OPEN` | `{ type: 'OPEN', streamId, initSeq, chunkType, metadata? }` |
| `OPEN_ACK` | `{ type: 'OPEN_ACK', streamId, initCredit }` |
| `DATA` | `{ type: 'DATA', streamId, seq, chunkType, payload }` |
| `CREDIT` | `{ type: 'CREDIT', streamId, grant }` |
| `CLOSE` | `{ type: 'CLOSE', streamId, finalSeq }` |
| `CANCEL` | `{ type: 'CANCEL', streamId, reason? }` |
| `RESET` | `{ type: 'RESET', streamId, reason? }` |
| `CAPABILITY` | `{ type: 'CAPABILITY', sab, transferable, streams, version }` |

### chunkType Enum

```
BINARY_TRANSFER  — ArrayBuffer or TypedArray, sent with transferList
STRUCTURED_CLONE — any structured-cloneable value
STREAM_REF       — Transferable ReadableStream (single-hop native delegation)
SAB_SIGNAL       — ring-buffer offset notification (used by SAB fast path only)
```

### Lifecycle State Machine (per StreamSession)

```
         OPEN frame sent/received
IDLE ─────────────────────────────► OPENING
                                       │
                         OPEN_ACK received/sent
                                       │
                                       ▼
              DATA / CREDIT frames ◄─ OPEN ─► DATA / CREDIT frames
                                       │
                    CLOSE sent/received│      RESET sent/received
                                       │
                            ┌──────────┴──────────┐
                            ▼                     ▼
                         CLOSING               RESETTING
                            │                     │
               final seq    │      both sides ack │
                delivered   │            error    │
                            ▼                     ▼
                          CLOSED               ERRORED
```

CANCEL is treated as a RESET from the receiver side — transitions OPEN → RESETTING on the sender.

---

## Fast-Path Selection

### Decision at Channel Open, Not Per-Chunk

The capability negotiation is a **one-time handshake** at channel open via `CAPABILITY` frame exchange. Both sides advertise their feature set; the Transport layer picks the best fast path that both support and caches it for the channel lifetime.

Per-chunk fast-path selection is wrong: it adds decision overhead on every write, makes the wire protocol non-uniform, and makes debugging harder. The exception is `STREAM_REF` (native Transferable Streams), which is chosen only if both sides have `streams: true` _and_ the topology is confirmed to be single-hop (no relay bridge in the path). The channel signals single-hop status via a flag set at construction time.

### Negotiation Rules

```
1. Both sides send CAPABILITY frame immediately on channel open.
2. Each side waits for the remote CAPABILITY frame before opening any stream.
3. Selected path = best path both sides support:
   SAB    (requires sab_local AND sab_remote AND !isServiceWorker)
   XFER   (requires transferable_local AND transferable_remote — always true in target browsers)
   CLONE  (unconditional fallback)
4. STREAM_REF delegation: requires streams_local AND streams_remote AND singleHop flag.
5. Selected path is immutable for the channel lifetime.
```

### Fallback on Mid-Channel Capability Change

postMessage channels over `MessagePort` are stable for the channel's lifetime; there is no mid-stream capability change on a single port. The scenario where capabilities can change is cross-origin iframe navigation: if the iframe navigates away, the port is gone entirely and all active streams on the channel emit `RESET` with reason `"channel-closed"`. The caller is responsible for re-establishing the channel (PROJECT.md explicit scope boundary). The Transport layer detects this via a `messageerror` event or timeout on the port and fires the channel-level teardown path.

### Feature Detection Code Pattern (inside Transport)

```typescript
function probeCapabilities(): TransportCapabilities {
  return {
    sab:        typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated === true,
    transferable: true, // always in ES2022+ evergreen target
    streams:    typeof ReadableStream !== 'undefined' &&
                ReadableStream.prototype[Symbol.for('nodejs.rejection')] === undefined &&
                // Transferable ReadableStream requires Chrome 87+, Firefox (partial), Safari TP only
                // Use the try-transfer probe below at runtime:
                checkReadableStreamTransferable(),
  };
}

function checkReadableStreamTransferable(): boolean {
  try {
    const { port1, port2 } = new MessageChannel();
    const rs = new ReadableStream();
    port1.postMessage(rs, [rs as unknown as Transferable]);
    port1.close(); port2.close();
    return true;
  } catch {
    return false;
  }
}
```

The `checkReadableStreamTransferable` probe is the only reliable way to detect stream transferability cross-browser; the DOM type signature does not reflect it.

---

## Multi-Hop Relay Architecture

### Topology

```
┌──────────────┐        ┌──────────────────────────────┐        ┌──────────────────┐
│   Worker     │        │        Main Thread            │        │  Sandboxed iframe │
│              │        │                               │        │                   │
│  Channel A ──┼────────┼──► Channel A (upstream)      │        │                   │
│  (producer)  │        │    RelayBridge                │        │                   │
│              │        │    Channel B (downstream) ────┼────────┼──► Channel B      │
│              │        │                               │        │    (consumer)      │
└──────────────┘        └──────────────────────────────┘        └──────────────────┘
```

### RelayBridge Invariants

1. **Frames pass through without reassembly.** The relay never combines `DATA` frames into a complete payload. It forwards `DATA` frames from Channel A to Channel B with stream ID remapping if needed (in case stream IDs collide across boundaries — the relay maintains an ID translation table).

2. **Backpressure propagates end-to-end.** The relay does NOT automatically forward credits from downstream to upstream. Instead:
   - The relay opens Channel B with an initial credit of 0.
   - As Channel B issues `CREDIT` frames (downstream consumer draining), the relay translates those into `CREDIT` frames on Channel A (upstream producer).
   - The relay never holds more than `downstreamCreditWindow` frames buffered; if Channel B credit runs out, Channel A receives no new credits and the producer pauses.
   - This means the relay's in-memory buffer is bounded to at most `downstreamCreditWindow` frames at any time.

3. **Error signals propagate bidirectionally.**
   - Upstream `RESET` → relay forwards `RESET` to downstream, tears down translation entry.
   - Downstream `CANCEL` → relay forwards `RESET` to upstream (the producer must stop), tears down translation entry.
   - If the relay context itself dies, all active channels see port closure → all StreamSessions transition to ERRORED.

### Credit Flow Across Hops (Detailed)

```
Worker (producer)          Main Thread (relay)             iframe (consumer)
     │                           │                                │
     │  OPEN(streamId=1)         │                                │
     │ ──────────────────────►   │                                │
     │                           │  OPEN(streamId=7) [remapped]   │
     │                           │ ────────────────────────────►  │
     │                           │                                │
     │                           │  OPEN_ACK(streamId=7,          │
     │                           │           initCredit=8)        │
     │                           │  ◄────────────────────────── │
     │  OPEN_ACK(streamId=1,     │                                │
     │           initCredit=8)   │   relay holds credit=8 for     │
     │  ◄──────────────────────  │   stream 1↔7 translation       │
     │                           │                                │
     │  DATA(streamId=1,seq=0)   │                                │
     │ ──────────────────────►   │  DATA(streamId=7,seq=0)        │
     │                           │ ────────────────────────────►  │
     │                           │  [relay credit for 1↔7: 7]     │
     │  ...7 more DATA frames... │  ...forwarded...               │
     │                           │  [relay credit for 1↔7: 0]     │
     │                           │  producer now paused            │
     │                           │                                │
     │                           │  CREDIT(streamId=7, grant=4)   │
     │                           │  ◄────────────────────────── │
     │  CREDIT(streamId=1,       │  [relay credit for 1↔7: 4]     │
     │         grant=4)          │                                │
     │  ◄──────────────────────  │                                │
     │  [producer resumes with   │                                │
     │   4 new credits]          │                                │
```

This makes end-to-end backpressure a mechanical consequence of the translation table and the rule "relay only grants upstream credits equal to what the downstream has granted."

### Relay Frame Processing (No Reassembly, No Inspection)

The relay's `onFrame` handler for Channel A looks like:

```typescript
channelA.onFrame((frame) => {
  if (frame.type === 'DATA' || frame.type === 'CLOSE' || frame.type === 'RESET') {
    const downstreamStreamId = translationTable.upToDown(frame.streamId);
    channelB.sendFrame({ ...frame, streamId: downstreamStreamId });
  }
  if (frame.type === 'CREDIT') {
    // upstream is sending credit to us? Shouldn't happen in normal flow,
    // but handle as no-op (relay does not consume from the stream)
  }
});

channelB.onFrame((frame) => {
  if (frame.type === 'CREDIT') {
    const upstreamStreamId = translationTable.downToUp(frame.streamId);
    // Forward the exact grant amount upstream
    channelA.sendFrame({ type: 'CREDIT', streamId: upstreamStreamId, grant: frame.grant });
  }
  if (frame.type === 'CANCEL') {
    const upstreamStreamId = translationTable.downToUp(frame.streamId);
    channelA.sendFrame({ type: 'RESET', streamId: upstreamStreamId, reason: frame.reason });
    translationTable.remove(frame.streamId);
  }
});
```

The relay is a thin routing table plus frame rewrite. The payload bytes never touch the relay's JS heap — only the frame envelope (a small object with a few integer fields) is created.

---

## Lifecycle and Error Propagation

### Stream Lifecycle

```
Initiator side                      Responder side
─────────────────────               ─────────────────────
open() called
  → creates StreamSession
  → sends OPEN frame
                                    OPEN frame arrives
                                    → creates StreamSession
                                    → sends OPEN_ACK with initCredit
  OPEN_ACK arrives
  → stream is OPEN
  → write() calls enqueue DATA frames
    (respecting credit window)
                                    DATA frames arrive
                                    → reassemble + deliver to consumer
                                    → when queue drains, send CREDIT
  CREDIT arrives
  → increment send window
  → resume write() calls
...
  write() finishes → close()
  → sends CLOSE(finalSeq)
                                    CLOSE arrives after finalSeq delivered
                                    → consumer sees end-of-stream
                                    → may send final CREDIT (no-op if window)
  [Both sides: CLOSED]
```

### Error Routes

| Trigger | Who generates | Frame sent | Effect on each end |
|---------|--------------|------------|-------------------|
| Sender `abort(reason)` | Sender StreamSession | `RESET` | Sender: ERRORED. Receiver: ReadableStream errors with reason |
| Receiver `cancel(reason)` | Receiver StreamSession | `CANCEL` | Receiver: ReadableStream cancels. Sender: WritableStream aborts |
| Sequence gap detected | Receiver StreamSession | `RESET` | Both: ERRORED with reason "seq-gap" |
| Context death (port closed) | Transport layer | — (no frame possible) | Channel fires `channel-error`; all StreamSessions on channel → ERRORED |
| Relay context dies | Transport on both Channel A and Channel B | — | Both upstream producer and downstream consumer → ERRORED |
| `DataCloneError` on send | Transport layer | `RESET` (if port still alive) | Both: ERRORED with "serialize-failed" |

### Backpressure Surface to Callers

**WHATWG Streams surface:**
- Write-side: `writable.getWriter().write(chunk)` returns a Promise. The WritableStreamDefaultController's `desiredSize` is wired to the credit window. When `creditsRemaining === 0`, the controller signals backpressure → `writer.ready` is pending. The library resumes the writer when `CREDIT` arrives.
- Read-side: `ReadableStreamDefaultController.desiredSize` reflects how many chunks the reorder buffer is willing to accept without the consumer reading. When `desiredSize <= 0`, the library stops granting credits to the sender.

**EventEmitter surface:**
- `drain` event fires when the send credit window refills after being exhausted (mirrors Node.js stream `drain`).
- `data` event fires per in-order chunk. If the consumer calls `stream.pause()`, the library holds incoming credits until `stream.resume()`.

**Low-level surface:**
- `send()` returns `{ ok: boolean, backpressured: boolean }`. When `backpressured: true`, the caller must wait for the `credit` event before calling `send()` again.

---

## Recommended Project Structure

```
src/
├── transport/
│   ├── index.ts              # Transport class: wraps PostMessageEndpoint
│   ├── endpoint.ts           # PostMessageEndpoint interface + endpoint adapters
│   ├── capability.ts         # Capability probe + CAPABILITY frame encode/decode
│   └── sab-ring-buffer.ts    # SAB fast path (DEFERRED to v1.x)
├── framing/
│   ├── index.ts              # encode(frame) / decode(msg) — pure functions
│   ├── types.ts              # Frame union type, chunkType enum
│   └── codec.ts              # Serialization helpers (could be WASM boundary later)
├── channel/
│   ├── index.ts              # Channel class: demux/mux, StreamSession registry
│   └── mux.ts                # MultiplexLayer (DEFERRED to v2)
├── session/
│   ├── index.ts              # StreamSession class
│   ├── reorder-buffer.ts     # In-order reassembly with bounded buffer
│   ├── credit-window.ts      # Credit accounting (send-side + recv-side)
│   ├── chunker.ts            # Chunk splitter (write-side)
│   └── fsm.ts                # Lifecycle state machine
├── adapters/
│   ├── streams.ts            # WHATWG Streams surface (primary)
│   ├── emitter.ts            # Node-style EventEmitter surface
│   └── lowlevel.ts           # send/onChunk surface
├── relay/
│   └── index.ts              # RelayBridge (DEFERRED to v1.x)
├── index.ts                  # Public API re-exports
└── types.ts                  # Exported TypeScript types + interfaces
```

### Structure Rationale

- **transport/**: The only layer that knows about `postMessage`. Isolating it here means unit tests of all higher layers never need a real browser API — they accept a mock Transport.
- **framing/**: Pure functions only. Import anywhere in the stack, test with zero setup. The boundary where a future WASM codec would slot in.
- **channel/**: Owns the StreamSession registry and demux logic. The natural seam where multiplexing plugs in (mux.ts) without touching Transport or Session.
- **session/**: The heart of the protocol. reorder-buffer, credit-window, and fsm are each independently unit-testable with plain JS objects.
- **adapters/**: Zero protocol logic. These are the public API; they call StreamSession and nothing else.
- **relay/**: A thin glue file connecting two Channel instances. Minimal enough to be deferrable to v1.x without touching the rest.

---

## Architectural Patterns

### Pattern 1: Caller-Provided Endpoint (Inversion of Control)

**What:** The library never creates a `Worker`, `iframe`, or `MessageChannel`. Callers pass an object implementing `PostMessageEndpoint`. The library sets `endpoint.onmessage`.

**When to use:** Always. This is the design — not a pattern to choose.

**Trade-offs:** Callers must do their own bootstrap wiring (2–5 lines per topology), but the library can be tested with a pair of in-memory `MessageChannel` ports without any browser API involvement.

### Pattern 2: Symmetric Two-Sided API

**What:** Both sides of a boundary call the same `createChannel(endpoint)` function. There is no "server" or "client" role at the library level. The OPEN handshake is initiated by whichever side calls `channel.openStream()` first.

**When to use:** Always. Asymmetric APIs (Comlink `expose`/`wrap`) leak implementation detail to callers and force them to decide roles that the library should handle transparently.

**Trade-offs:** Both sides must initialize their Channel before either side can open a stream. This means a coordination concern shifts to the caller for the startup sequence (caller already controls this since they create the Worker / iframe).

### Pattern 3: Pull-Based Backpressure via Credit Window

**What:** Instead of the sender pushing until the receiver signals stop, the receiver advertises available capacity as credits upfront. The sender pauses when credits reach zero, without polling. Credits are issued as `CREDIT` frames when the receiver's queue drains below half its high-water mark (mirrors QUIC's window-update heuristic).

**When to use:** Always. Push-based flow control (stop-and-wait) requires round trips per pause/resume cycle. Credit-based flow keeps the pipe full without unbounded buffering.

**Trade-offs:** Requires receiver to accurately estimate its queue capacity (high-water mark). An over-generous initial credit can buffer too much in the receiver before backpressure kicks in. A too-small initial credit introduces startup latency (sender exhausts credits before the first `CREDIT` frame arrives). `initCredit` in `OPEN_ACK` is tunable; default should be benchmark-derived (likely 8–16 chunks).

### Pattern 4: Stateless Framing Layer

**What:** The `framing/` module is purely functional: `encode(Frame): unknown` and `decode(MessageEvent): Frame | null`. No state, no side effects.

**When to use:** Always.

**Trade-offs:** Forces all state into StreamSession and Channel (which is correct). Makes the framing layer trivially unit-testable and a safe boundary for a WASM codec replacement in a later milestone.

---

## Data Flow

### Send Path (WHATWG Streams → postMessage)

```
caller writes chunk to WritableStream
    ↓
adapters/streams.ts: write(chunk) handler
    → check credit window via session/credit-window.ts
    → if credits = 0: block (return pending Promise, register for CREDIT event)
    → if credits > 0: proceed
    ↓
session/chunker.ts: split chunk into ≤chunkSize fragments
    ↓
session/index.ts: assign seq numbers, wrap in DATA frames
    ↓
channel/index.ts: route to Transport (stream ID header already in frame)
    ↓
framing/index.ts: encode(frame) → plain JS object
    ↓
transport/index.ts: choose transferList based on cached capabilities
    → endpoint.postMessage(encoded, transfer)
    → (SAB path: write to ring buffer, send SAB_SIGNAL frame instead)
```

### Receive Path (postMessage → WHATWG Streams)

```
endpoint.onmessage fires (in receiver context)
    ↓
transport/index.ts: receives raw MessageEvent
    ↓
framing/index.ts: decode(event) → Frame | null
    → null: library frame but unrecognized version, or not a library frame → pass through
    ↓
channel/index.ts: demux by streamId → find StreamSession
    → CAPABILITY: update capabilities, do not forward
    → OPEN: create new StreamSession, send OPEN_ACK
    → DATA/CREDIT/CLOSE/RESET/CANCEL: dispatch to StreamSession
    ↓
session/index.ts:
    DATA frame:
        → insert into reorder-buffer by seq
        → deliver in-order chunks to consumer
        → update recv credit accounting
        → if recv queue below half HWM: send CREDIT(grant = HWM/2)
    CREDIT frame:
        → add grant to send-side credit counter
        → fire 'credit' event → unblock blocked write() calls
    CLOSE frame:
        → transition to CLOSING, deliver remaining buffered chunks, then CLOSED
    RESET/CANCEL:
        → transition to ERRORED, fire error to consumer
    ↓
adapters/streams.ts: ReadableStreamDefaultController.enqueue(chunk)
    → WHATWG Streams engine notifies reader / pipeTo chain
```

### Relay Data Flow

```
[Worker context] ──DATA──► transport/channel A receive
                               ↓
                           relay/index.ts:
                             look up downstream streamId
                             forward DATA frame to channel B
                               ↓
                           transport/channel B send
                               ↓
[iframe context] ◄──DATA── endpoint.postMessage

[iframe context] ──CREDIT──► transport/channel B receive
                               ↓
                           relay/index.ts:
                             look up upstream streamId
                             forward CREDIT frame to channel A
                               ↓
                           transport/channel A send
                               ↓
[Worker context] ◄──CREDIT── endpoint.postMessage
```

---

## Build Order (Critical Path)

The dependency graph drives sequencing. Items on the same level can be built in parallel.

```
Phase 1 (Critical Path — nothing else works without these):
  ├── transport/endpoint.ts       (PostMessageEndpoint interface + Window adapter)
  ├── framing/types.ts            (Frame union type, chunkType enum)
  └── framing/index.ts            (encode/decode — pure functions)

Phase 2 (Channel foundation — depends on Phase 1):
  ├── transport/capability.ts     (probe + CAPABILITY frame encode/decode)
  ├── transport/index.ts          (Transport class, wraps endpoint, sends/receives frames)
  └── session/fsm.ts              (lifecycle state machine — pure, no I/O)

Phase 3 (Session core — depends on Phases 1 + 2):
  ├── session/reorder-buffer.ts   (in-order reassembly — pure, testable standalone)
  ├── session/credit-window.ts    (credit accounting — pure, testable standalone)
  └── session/chunker.ts          (chunk splitter — pure, testable standalone)

Phase 4 (Integration — depends on Phase 3):
  ├── session/index.ts            (StreamSession: wires fsm + reorder + credit + chunker)
  └── channel/index.ts            (Channel: demux/mux, StreamSession registry)

Phase 5 (Public API surfaces — depends on Phase 4):
  ├── adapters/lowlevel.ts        (send/onChunk — thin wrapper, build first as foundation)
  ├── adapters/emitter.ts         (EventEmitter surface — wraps lowlevel)
  └── adapters/streams.ts         (WHATWG Streams surface — PRIMARY, most complex adapter)

Phase 6 (Optional/Deferred — depends on Phase 5 being stable):
  ├── transport/sab-ring-buffer.ts  (SAB fast path)
  ├── relay/index.ts               (RelayBridge — multi-hop)
  └── channel/mux.ts               (multiplexer — v2)
```

### Critical Path Nodes

- `framing/types.ts` blocks everything — define Frame types first.
- `session/credit-window.ts` blocks the WHATWG Streams adapter — `desiredSize` wiring requires credit semantics to be solid.
- `adapters/streams.ts` is the hardest adapter to get right (WHATWG Streams backpressure integration is non-trivial); build `lowlevel.ts` and `emitter.ts` first to validate the session layer works.
- `relay/index.ts` is a Phase 6 item: it requires credit-window to be proven correct in single-hop tests before trusting it across hops.

### Optional/Additive Nodes (do not block v1)

| Module | Why Deferrable |
|--------|---------------|
| `sab-ring-buffer.ts` | Fallback (transferable path) is fully functional; SAB is a performance ceiling, not a correctness requirement |
| `relay/index.ts` | Single-hop streams work without it; relay requires backpressure correctness proven first |
| `channel/mux.ts` | Single-stream is the default; mux conflicts with SPSC SAB path |

---

## Testing Architecture

### Test Seam Hierarchy

The layered architecture creates natural seams where mocks replace real browser APIs:

```
Layer              Real browser needed?    Mock substitute
─────────────────────────────────────────────────────────────
framing/*          NO                      None needed (pure functions)
session/reorder*   NO                      None needed (pure data structure)
session/credit*    NO                      None needed (pure accounting)
session/chunker*   NO                      None needed (pure splitting)
session/fsm*       NO                      None needed (pure state machine)
session/index      NO                      Pass in mock Channel.sendFrame()
channel/index      NO                      Pass in mock Transport
transport/index    YES (for true semantics) MockEndpoint (pair of EventTargets)
adapters/*         YES (for WHATWG Streams) Real ReadableStream/WritableStream exist in browsers;
                                           can test with real Streams in Node 18+ too
relay/index        NO (relay logic)        Two MockChannel instances
                   YES (E2E correctness)   Real worker + real iframe in Playwright
```

### Unit Test Strategy (No Real Browser)

All of Phase 3 (session internals) and Phase 2 partial (framing, FSM) are pure TypeScript. They can run in Vitest with `environment: 'node'` or Node 18+ (which has WHATWG Streams globally). These tests are fast and give high confidence in the protocol logic.

A `MockEndpoint` pair is a `MessageChannel` with the receive side synchronous (no event loop hop) for deterministic test ordering:

```typescript
// tests/helpers/mock-endpoint.ts
export function makeMockEndpointPair(): [PostMessageEndpoint, PostMessageEndpoint] {
  const ch = new MessageChannel();
  const a: PostMessageEndpoint = {
    postMessage: (msg, t) => ch.port1.postMessage(msg, t),
    onmessage: null,
  };
  const b: PostMessageEndpoint = {
    postMessage: (msg, t) => ch.port2.postMessage(msg, t),
    onmessage: null,
  };
  ch.port1.onmessage = (e) => a.onmessage?.(e);
  ch.port2.onmessage = (e) => b.onmessage?.(e);
  ch.port1.start(); ch.port2.start();
  return [a, b];
}
```

This pairs with a real `MessageChannel` and gets real structured-clone behavior in a Node 18+ or browser context — real enough for session-layer tests without spinning up Workers.

### Vitest Browser Mode — Single-Hop Tests

Use Vitest browser mode (Playwright provider) for:
- Confirming Transferable ArrayBuffer semantics (zero-copy semantics need the real GC)
- Confirming SAB availability under `crossOriginIsolated` (requires real COOP/COEP headers)
- Single-hop Worker ↔ main and iframe ↔ parent tests

### Playwright Standalone — Multi-Hop and CSP Tests

Use standalone Playwright test suite for:
- Three-hop topology: worker → main relay → sandboxed iframe
- CSP correctness: `sandbox="allow-scripts"` iframe, no SAB, verify fallback path delivers all chunks in order
- Service worker topology (Chromium only)
- Cross-browser matrix (Chrome, Firefox, WebKit)

### Test Fixture Server Pattern

Playwright tests use `page.route()` to serve synthetic HTML/JS fixtures inline — no external HTTP server needed. The fixture sets up the topology; the test orchestrates it via `page.evaluate()` + `page.exposeFunction()`.

For CSP testing:

```typescript
// Serve the sandboxed iframe with correct headers
await page.route('/sandboxed-iframe.html', (route) => {
  route.fulfill({
    contentType: 'text/html',
    headers: {
      'Content-Security-Policy': "default-src 'none'; script-src 'self'",
    },
    body: iframeFixtureHtml,
  });
});
```

### What Cannot Be Unit-Tested (Must Be E2E)

| Concern | Why needs real browser |
|---------|----------------------|
| Structured-clone fidelity for complex objects | jsdom/happy-dom incomplete clone implementation |
| Transferable zero-copy (ArrayBuffer detach) | Node MessageChannel doesn't detach ArrayBuffers |
| SAB availability under crossOriginIsolated | Requires real COOP/COEP header enforcement |
| Service worker lifecycle + postMessage | Only Playwright/Chromium can drive SW activation |
| Cross-browser Transferable Stream support | Safari vs Chrome behaviors diverge |
| Backpressure propagation across worker boundary | Real event loop hop semantics matter |

---

## Anti-Patterns

### Anti-Pattern 1: Owning the Channel (Library Creates the Worker/iframe)

**What people do:** Provide a helper `createWorkerStream('/worker.js')` that both creates the Worker and returns a stream.

**Why it's wrong:** The library cannot know the worker's lifecycle, whether to terminate it on stream close, or how to share a worker across multiple streams. It creates hidden ownership that produces mysterious bugs when the caller also holds a reference to the worker.

**Do this instead:** Caller creates `const w = new Worker('/worker.js')` and passes it: `createChannel(w)`. The library only touches `w.postMessage` and `w.onmessage`.

### Anti-Pattern 2: Per-Chunk Fast-Path Selection

**What people do:** Inspect each chunk's type on every `send()` call and pick SAB vs Transferable vs clone per-chunk.

**Why it's wrong:** Adds decision overhead on the hot path. Produces an inconsistent wire protocol (different chunks on the same stream use different transports). Makes debugging impossible (you can't reason about stream behavior without knowing which path each chunk took).

**Do this instead:** One capability negotiation at channel open. Cache the result. Every chunk on a channel uses the same transport path.

### Anti-Pattern 3: Unbounded Relay Buffer

**What people do:** Build the relay by piping a ReadableStream to a WritableStream between two Channels, using WHATWG Streams' native piping.

**Why it's wrong:** WHATWG Streams piping across a postMessage boundary cannot propagate backpressure across the boundary. The relay's WritableStream on the upstream side will accept data from the worker as fast as the worker writes, regardless of whether the iframe consumer is keeping up. The relay buffers everything in memory until the iframe catches up (or runs out of memory).

**Do this instead:** The relay uses the credit-forwarding model described above. No WHATWG Streams piping inside the relay. The relay is a routing table, not a pipe.

### Anti-Pattern 4: Single-Level Message Namespace

**What people do:** Send library frames as raw `{ type, ... }` objects, hoping callers won't use a message type named `DATA` or `OPEN`.

**Why it's wrong:** Guaranteed namespace collision in real applications. The library must share the postMessage channel with the caller's own messages.

**Do this instead:** The outermost frame field is a branded namespace marker:

```typescript
const FRAME_MARKER = Symbol.for('iframebuffer.v1');
// encoded frame: { [FRAME_MARKER]: true, type: 'DATA', ... }
// decode: if !(FRAME_MARKER in msg) return null (not a library frame)
```

Since Symbols are not structured-cloneable, use a string sentinel instead (the Symbol approach would fail across contexts):

```typescript
const FRAME_MARKER = '__ibf_v1__';
// encode: { __ibf_v1__: 1, type: 'DATA', ... }
// decode: if (msg.__ibf_v1__ !== 1) return null;
```

### Anti-Pattern 5: Global onmessage Replacement Without Multiplexing

**What people do:** Set `worker.onmessage = libraryHandler` which silently drops all messages the caller was previously receiving.

**Why it's wrong:** Callers already have message handlers on their workers. Replacing `onmessage` breaks the rest of their application.

**Do this instead:** The Transport layer sets `endpoint.onmessage`, but the caller is expected to have wired the endpoint specifically for the library (via a `MessagePort` extracted from their channel). The library contract: the `PostMessageEndpoint` you pass to the library is used exclusively by the library. For `Worker.onmessage` sharing, the caller wraps their worker in a thin dispatcher before passing it — documented in examples.

---

## Integration Points

### Internal Boundaries (Library Modules)

| Boundary | Direction | Contract |
|----------|-----------|----------|
| Transport → framing | Transport calls `decode()` on raw events, `encode()` on outgoing frames | Pure function calls — no state shared |
| Channel → Transport | Channel calls `transport.send(frame)` and registers `transport.onFrame(handler)` | Single method + single callback |
| StreamSession → Channel | Session calls `channel.sendFrame(frame)` and receives frames via a per-session dispatcher | Channel owns the dispatch loop |
| Adapters → StreamSession | Adapters call `session.write(chunk)`, `session.close()`, etc.; receive chunks via callback | Session never knows which adapter wraps it |
| RelayBridge → Channel | Relay reads Channel A's frames, writes to Channel B, and vice versa for credits | RelayBridge holds two Channel references; Channels don't know they're relayed |

### External Integration (Callers)

| Context | Wiring Pattern | Notes |
|---------|---------------|-------|
| Worker ↔ main thread | `const ch = createChannel(worker)` on main; `const ch = createChannel(self)` in worker | `self` in a dedicated worker is the `DedicatedWorkerGlobalScope` |
| iframe ↔ parent | Use a `MessageChannel`; transfer one port to the iframe; pass each port to `createChannel()` | Avoids `window.postMessage` origin management at the library level |
| ServiceWorker ↔ page | Page: `createChannel(navigator.serviceWorker.controller)`; SW: `createChannel(event.source)` in activate/message handler | SAB unavailable (different agent cluster); library auto-detects |
| Three-hop relay | Main thread: `createRelayBridge(channelToWorker, channelToIframe)` | RelayBridge is v1.x |

---

## Scalability Considerations

This library is not a server. Scale refers to stream count and payload volume per-browser-tab.

| Scenario | Concern | Approach |
|----------|---------|----------|
| Single large binary transfer (100s of MB) | GC spike from structured clone | Chunk into transferable ArrayBuffer fragments — transferable path eliminates clone cost |
| Many concurrent streams over one channel | Head-of-line blocking | Each stream has its own credit window; a paused stream doesn't block credits for other streams (this is the QUIC lesson) |
| Live stream at sustained high bitrate | Memory accumulation in reorder buffer | Reorder buffer is bounded by `maxReorderBuffer` (default: 64 frames); frames beyond that window trigger a `RESET` |
| Relay under high load | Relay memory accumulation | Relay buffer bounded by downstream credit window — relay holds at most `initCredit` frames in memory |
| Large number of open streams (mux mode) | StreamSession object count | StreamSessions are cheap (~5 fields each); 1000 concurrent streams is fine; 100,000+ would need pooling (out of scope for v1) |

---

## Sources

- WHATWG Streams specification (streams.spec.whatwg.org) — `desiredSize`, `pull()` contract, backpressure model — HIGH confidence
- MDN: ServiceWorker.postMessage, Client.postMessage — SAB-across-agent-cluster DataCloneError confirmed — HIGH confidence
- MDN: Window.postMessage, MessagePort.postMessage — signature differences, targetOrigin requirement — HIGH confidence
- RFC 9000 (QUIC) — per-stream flow control, WINDOW_UPDATE trigger heuristic (send update when window falls below 50%), BLOCKED frame — HIGH confidence
- Google QUIC flow control design doc — auto-tuning, double-on-saturation window algorithm — MEDIUM confidence (internal design doc, not spec)
- blog.paul.cx ringbuf.js — SPSC design, wait-free properties, no fallback for non-SAB contexts (confirmed: lib has no fallback) — HIGH confidence
- GitHub padenot/ringbuf.js README — TypeScript since v0.4.0, SPSC constraint — HIGH confidence
- WebFetch: WHATWG Streams spec — `pull()` backpressure integration, `desiredSize` semantics — HIGH confidence
- WebSearch: `crossOriginIsolated` feature detection pattern — HIGH confidence (verified against MDN)
- WebSearch: Transferable ReadableStream — Chrome 87+, Safari TP only as of April 2026, Firefox partial — MEDIUM confidence (feature detection probe more reliable than version tables)

---

*Architecture research for: iframebuffer — postMessage streaming library*
*Researched: 2026-04-21*
