# Feature Research

**Domain:** High-throughput postMessage streaming library (browser-only, cross-context: iframe / worker / service worker / MessageChannel)
**Researched:** 2026-04-21
**Confidence:** HIGH for table stakes (grounded in comparable library analysis and browser platform realities); MEDIUM for differentiator complexity estimates (novel territory with few direct comparisons)

---

## Comparable Library Survey

Before feature categorization, here is what the ecosystem actually provides today — evidence base for every table-stakes and differentiator call below.

### Comlink (GoogleChromeLabs, 12.5k stars)
**What it is:** RPC over postMessage using ES6 Proxies. 1.1 kB.
**What it offers:** `expose()`/`wrap()` API, structured-clone transfer by default, `Comlink.transfer()` for explicit Transferable opt-in, `Comlink.proxy()` for shared references / callbacks, custom transfer handlers, `windowEndpoint()` for cross-window/iframe, TypeScript `Remote<T>` types, SharedWorker support via `.port`, WeakRef-based proxy auto-cleanup.
**What it lacks:** No stream semantics at all. No backpressure. No chunking. No framing. No ordering guarantees beyond what postMessage provides on a single channel. No multi-hop relay support. No SAB fast path. Serialization is copy-by-default (structured clone). Large binary payloads fully serialize — no zero-copy path beyond explicit `transfer()` which the caller must manage.
**API surface influence:** The `expose(endpoint)` / `wrap(endpoint)` two-sided wiring pattern is a good ergonomics reference. The caller hands both sides the same endpoint type rather than configuring a "server" and a "client."

### Postmate (dollarshaveclub, 2.0k stars, unmaintained)
**What it is:** Promise-based parent/child iframe handshake + model access. ~1.6 kB.
**What it offers:** Secure two-way handshake with origin validation, child exposes a model the parent can `.get()`, child emits events the parent can listen to.
**What it lacks:** No streaming. No binary data. No workers. Iframe-only. No multiplexing. No backpressure. Unmaintained. Error propagation on model `.get()` calls is broken (thrown errors don't reject the promise).
**Relevance:** Shows what "handshake + discovery" looks like; the iframebuffer PROJECT.md explicitly scopes this out (caller sets up the channel).

### @metamask/post-message-stream
**What it is:** Node.js duplex stream interface over various IPC channels (window.postMessage, Web Worker, Node worker_threads, child_process).
**What it offers:** Unified duplex stream abstraction, multiple context types (`WindowPostMessageStream`, `WebWorkerParentPostMessageStream`, etc.), name-based stream targeting.
**What it lacks:** Node-style streams only (no WHATWG Streams API surface). No SAB fast path. No backpressure signaling back through postMessage. No multiplexing. No multi-hop relay. No chunking of large payloads. Limited to dedicated workers (SharedWorker untested). Breaks in Electron when `window` is proxied.
**Relevance:** Shows the "thin wrapper that adds named stream types over postMessage" pattern. iframebuffer goes further by handling framing, chunking, ordering, and fast-path selection that this library leaves to the caller.

### remote-web-streams (MattiasBuelens, v0.2.0, last published 2 years ago)
**What it is:** WHATWG Streams that work across web workers and iframes using MessagePort as the transport.
**What it offers:** `RemoteReadableStream` / `RemoteWritableStream` constructor pairs, `fromReadablePort()` / `fromWritablePort()` for the receiving side, MessagePort ownership transfer, native WHATWG Streams composition (pipe chains, TransformStream).
**What it lacks:** No framing protocol — each chunk is one postMessage. No chunking of large payloads. No SAB fast path. No multiplexing. No multi-hop relay. No ordering/sequence guarantees beyond single-channel FIFO. No explicit backpressure across context boundaries (relies on WHATWG internal queue signaling which does not propagate over postMessage). Unmaintained.
**Relevance:** Closest ancestor in design space. iframebuffer addresses its gaps: explicit framing, chunking, SAB fast path, multi-hop relay.

### ringbuf.js (padenot, audio worklet canonical example)
**What it is:** Wait-free SPSC ring buffer over SharedArrayBuffer. TypeScript as of v0.4.0.
**What it offers:** Zero-allocation read/write after setup, `Atomics.wait`/`notify`-free path (wait-free), integer and float typed arrays, interleaved audio stream adapter, parameter change adapter.
**What it lacks:** SAB required — no fallback. SPSC only (no MPSC, no SPMC). No stream API surface. No framing, no chunking, no multiplexing. Strictly audio-worklet-oriented data types (no structured-clone payloads). No multi-hop relay.
**Relevance:** The SAB ring-buffer design in iframebuffer's fast path should follow ringbuf.js patterns for the wait-free SPSC case. The key lesson: the ring buffer itself is simple; the hard parts are feature detection and fallback.

### Transferable ReadableStream (browser platform, 2022+)
**What it is:** Native browser feature: ReadableStream, WritableStream, TransformStream are Transferable as of Chrome 87+, Firefox (varying), Safari Technology Preview 238 (February 2026 — not yet in stable Safari as of research date).
**What it offers:** Zero-copy stream transfer for single-hop, single-stream case. The browser's own piping engine handles backpressure.
**What it lacks:** Safari stable support not yet confirmed for 2026. No multi-hop relay. No multiplexing over a single channel. No SAB acceleration. No chunking of structured-clone payloads. No framing control.
**Relevance:** The library must justify its existence against native Transferable Streams for the single-hop binary case. The justification is: (a) multi-hop topology is genuinely unsolved by the platform, (b) SAB fast path beats even transferable streams on throughput for live feeds, (c) structured-clone payloads have no platform-level streaming equivalent, (d) Safari stable gaps remain.

---

## Feature Landscape

Features are grouped by domain and tagged:
- **[TS]** = Table Stakes
- **[D]** = Differentiator
- **[AF]** = Anti-Feature
- **Complexity** = S (days) / M (1-2 weeks) / L (weeks+)
- **API** = which of the three API surfaces it affects: `Streams` (WHATWG), `EE` (EventEmitter), `LL` (low-level send/recv)

---

### Category 1: Framing

The wire protocol layer. Without this, nothing else works.

#### [TS] Message envelope with type tag and stream ID

Every message sent over postMessage must carry a header distinguishing library control messages from user data and identifying which logical stream the chunk belongs to. Without this, multiplexed streams are impossible and host application messages cannot coexist on the same channel.

| Attribute | Value |
|-----------|-------|
| Complexity | S |
| Depends on | Nothing — this is foundational |
| API surfaces | LL (defined here; Streams and EE sit on top) |
| Why table stakes | Every comparable library (post-message-stream, remote-web-streams, Comlink) has some form of envelope. Without it the library cannot share a channel with the host application's own messages. |

#### [TS] Sequence numbering per stream

Each chunk in a stream carries a monotonically incrementing sequence number scoped to the stream ID. Required for in-order reassembly and detecting gaps.

| Attribute | Value |
|-----------|-------|
| Complexity | S |
| Depends on | Message envelope |
| API surfaces | LL |
| Why table stakes | postMessage is FIFO on a single MessagePort but not across multiple ports or across proxy hops. Sequence numbers enable reordering on multi-hop topologies and are the basis for any future gap detection. |

#### [TS] Stream lifecycle control messages (open, data, end, error)

Four message types: stream-open (negotiates stream ID and metadata), data (carries a chunk), end (graceful close / EOF), error (abort with reason). Mirrors TCP's SYN, data, FIN, RST.

| Attribute | Value |
|-----------|-------|
| Complexity | S |
| Depends on | Message envelope, Sequence numbering |
| API surfaces | LL; maps to ReadableStream close/error on Streams surface; `end`/`error` events on EE surface |
| Why table stakes | Without explicit end and error signals, consumers cannot distinguish "stream finished" from "channel went quiet." All existing libraries implement this in some form. |

#### [D] Chunk type tag (binary / structured-clone / stream-ref)

The envelope includes a tag indicating the data representation: raw binary (ArrayBuffer/TypedArray), structured-clone-serializable object, or a platform ReadableStream reference (for browsers that support Transferable Streams). Enables the receiver to handle each type correctly without probing.

| Attribute | Value |
|-----------|-------|
| Complexity | S |
| Depends on | Message envelope |
| API surfaces | LL; transparent to Streams and EE surfaces |
| Why differentiator | Comparable libraries either force structured clone (Comlink, post-message-stream) or force explicit `Comlink.transfer()`. None auto-tag and auto-route per data type. This is what enables the fast-path selection described in the next category. |

---

### Category 2: Fast-Path Selection

The performance-critical capability that differentiates the library from naive postMessage.

#### [TS] Transferable ArrayBuffer path (zero-copy binary)

When the chunk is an ArrayBuffer or TypedArray and the transport is a MessagePort/Worker, send it with the transferList argument. This avoids structured-clone serialization cost (32 MB: 302 ms clone vs. 6.6 ms transfer — 45x difference per surma.dev/nolanlawson benchmarks).

| Attribute | Value |
|-----------|-------|
| Complexity | S |
| Depends on | Chunk type tag, Message envelope |
| API surfaces | LL; visible as throughput improvement on all surfaces |
| Why table stakes | Without this, the library cannot claim to beat naive postMessage for binary payloads. This is the minimum viable performance claim. |

#### [D] SAB ring-buffer fast path (feature-detected, shared memory)

When cross-origin isolation is available (COOP + COEP headers present), allocate a SharedArrayBuffer ring buffer and use Atomics for signaling rather than postMessage. Inspired by ringbuf.js SPSC design. The ring buffer enables throughput limited by memory bandwidth rather than by postMessage dispatch latency.

Callers who cannot set COOP/COEP (strict-CSP sandboxed iframes) automatically fall back to the transferable path. Feature detection is runtime, not build-time.

| Attribute | Value |
|-----------|-------|
| Complexity | L |
| Depends on | Transferable ArrayBuffer path (fallback must exist first), Message envelope (for signaling alongside the ring buffer) |
| API surfaces | LL; fully transparent to Streams and EE surfaces |
| Why differentiator | No comparable postMessage library has this. ringbuf.js implements it but is not a general-purpose postMessage transport. This is the primary claim to "measurably beats naive postMessage." |
| Confidence | MEDIUM — SAB availability in real deployed environments (especially sandboxed iframes in CDN contexts) is narrower than docs suggest. The fallback correctness matters as much as the fast path. |

#### [D] Native Transferable ReadableStream delegation (single-hop only)

When the platform supports Transferable ReadableStream (Chrome 87+; Safari TP 238 but not stable as of April 2026; Firefox) and the topology is a single hop, detect and delegate to the platform's native stream transfer. The library's overhead is zero for this case; it becomes a thin detection wrapper.

| Attribute | Value |
|-----------|-------|
| Complexity | M |
| Depends on | Feature detection, Chunk type tag |
| API surfaces | Streams (primary); invisible to EE and LL |
| Why differentiator | Avoids reinventing what the platform already does well. The library gracefully degrades to its own framing protocol when the native path is unavailable (Safari stable, multi-hop, sandboxed iframe). |

#### [TS] Feature detection that fails gracefully to postMessage-clone

The fast-path selection must never throw or silently corrupt data on a path the browser does not support. Priority order: SAB ring buffer → transferable ArrayBuffer → native Transferable Stream → structured-clone postMessage. Each level is a runtime feature-detect.

| Attribute | Value |
|-----------|-------|
| Complexity | M |
| Depends on | All fast-path options above |
| API surfaces | LL; transparent to callers |
| Why table stakes | Without this, the library fails in strict-CSP environments (the hardest and most common production case for iframes). This is non-negotiable. |

---

### Category 3: Chunking

Breaking large payloads across multiple messages to bound memory and GC pressure.

#### [TS] Automatic chunking of large ArrayBuffers

Large ArrayBuffers (e.g., hundreds of MB) must not be sent as a single structured-clone message (causes GC spike, may exceed V8's message size limit). The library slices into chunks of a configurable size (default: tuned by benchmark, likely 64 KB–1 MB depending on path), sends each as a separate transferable fragment, reassembles in order on the receiver using sequence numbers.

| Attribute | Value |
|-----------|-------|
| Complexity | M |
| Depends on | Transferable ArrayBuffer path, Sequence numbering |
| API surfaces | LL; transparent to Streams and EE |
| Why table stakes | This is the primary "hard case" in PROJECT.md. Without chunking, the library cannot handle hundreds-of-MB payloads. Any library that cannot do this has no practical advantage over a single postMessage call. |

#### [TS] Chunk reassembly with in-order delivery guarantee

The receiver buffers out-of-order chunks (possible on multi-hop) and delivers them to the consumer strictly in sequence-number order. Buffering is bounded to avoid unbounded memory growth during a stall.

| Attribute | Value |
|-----------|-------|
| Complexity | M |
| Depends on | Sequence numbering, Chunking |
| API surfaces | LL; Streams surface exposes this as ReadableStream that only yields in-order chunks |
| Why table stakes | The PROJECT.md constraint is "TCP-like semantics." In-order delivery is the definition of that. |

#### [D] Configurable chunk size (with benchmark-driven defaults)

Expose a `chunkSize` option so callers can tune for their topology. The default is a benchmark-derived value (likely different for SAB path vs. transferable path vs. structured-clone path). Provide a tuning guide in documentation.

| Attribute | Value |
|-----------|-------|
| Complexity | S |
| Depends on | Chunking |
| API surfaces | LL (config option); exposed as init option on Streams and EE surfaces |
| Why differentiator | No comparable library exposes this. remote-web-streams and post-message-stream assume the caller controls chunk size by calling `.write()` appropriately, which shifts a critical performance decision to the caller. |

---

### Category 4: Flow Control and Backpressure

Without backpressure, a fast sender will exhaust memory in a slow receiver.

#### [TS] Credit-based backpressure signaling over postMessage

Because postMessage does not support backpressure natively (the sender cannot block), the library implements a credit window: the receiver grants N chunks-worth of credit; the sender pauses when credits are exhausted; the receiver sends ACK/credit-refresh messages when its queue drains. This is the TCP sliding window adapted for postMessage.

| Attribute | Value |
|-----------|-------|
| Complexity | M |
| Depends on | Message envelope, Sequence numbering, Chunk reassembly |
| API surfaces | LL (protocol); manifests as ReadableStream backpressure (desiredSize) on Streams surface; `drain` event on EE surface |
| Why table stakes | Without backpressure, the library fails the live-stream case in PROJECT.md. A fast worker producing a ReadableStream will OOM a slow sandboxed iframe consumer. None of the comparable libraries (remote-web-streams, post-message-stream) implement cross-context backpressure signaling — this is the gap. |

#### [TS] WHATWG Streams native backpressure integration

The WritableStream surface reflects sender-side pressure from the credit window as `desiredSize` and `ready` promise. The ReadableStream surface signals consumer-side pressure via its internal queue's `desiredSize`. These must be wired to the credit window so that the Streams pipeline engine propagates backpressure through pipe chains naturally.

| Attribute | Value |
|-----------|-------|
| Complexity | M |
| Depends on | Credit-based backpressure, Streams API surface |
| API surfaces | Streams only |
| Why table stakes | If the Streams surface does not wire backpressure correctly, piping through a TransformStream will not propagate pressure — defeating the purpose of WHATWG Streams composition. remote-web-streams explicitly mentions this is a gap in their design. |

#### [D] Backpressure propagation through relay hops

In the three-hop topology (worker → main relay → sandboxed iframe), the relay must propagate the sandboxed iframe's backpressure signal back to the worker. This requires the relay to hold credits from the downstream consumer before forwarding credits to the upstream producer.

| Attribute | Value |
|-----------|-------|
| Complexity | L |
| Depends on | Credit-based backpressure, Multi-hop relay |
| API surfaces | LL (relay mode); transparent to Streams and EE on the end-to-end view |
| Why differentiator | No comparable library addresses multi-hop backpressure. This is the hardest feature in the project and directly addresses the "known hard case" in PROJECT.md. |

---

### Category 5: Ordering and Reliability

#### [TS] Ordered delivery (in-order chunk delivery to consumer)

As covered under Chunk Reassembly — the consumer receives chunks in send order regardless of message arrival order. On single-hop MessagePort this is trivially guaranteed by the channel. On multi-hop proxies it requires the reorder buffer.

| Attribute | Value |
|-----------|-------|
| Complexity | M |
| Depends on | Sequence numbering, Chunk reassembly |
| API surfaces | All |
| Why table stakes | PROJECT.md requires "TCP-like semantics." Ordering is the T in TCP. |

#### [TS] Reliable delivery (detect loss, surface errors)

postMessage over MessagePort does not lose messages in normal operation but a proxy relay can. The library must detect sequence gaps (unexpected seq number jump) and surface them as stream errors rather than silently delivering a corrupt sequence. "Reliable" here means: deliver in order or error — not retransmit (postMessage has no loss, only ordering hazard on multi-hop).

| Attribute | Value |
|-----------|-------|
| Complexity | S |
| Depends on | Sequence numbering |
| API surfaces | LL; Streams surface surfaces as ReadableStream error; EE surface as `error` event |
| Why table stakes | Without gap detection, a relay bug silently delivers corrupted streams. The caller must know if the stream is invalid. |

#### [D] Graceful stream abort with error propagation to all hops

When the sender aborts (calls `abort()` on WritableStream or emits an error), the abort reason must propagate to the receiver as a ReadableStream error — and in the multi-hop case, must propagate through all relay hops to the final consumer. This includes propagating downstream abort back to the upstream producer (reader cancellation).

| Attribute | Value |
|-----------|-------|
| Complexity | M |
| Depends on | Stream lifecycle messages (open/data/end/error), Multi-hop relay |
| API surfaces | Streams (`cancel()`, `abort()`); EE (`error` event); LL (error envelope) |
| Why differentiator | remote-web-streams and post-message-stream do not propagate errors bidirectionally. Comlink re-throws errors at the RPC layer but has no stream concept. Correct end-to-end error propagation across proxy hops is genuinely novel. |

---

### Category 6: Multiplexing

#### [TS] Stream ID framing for future multiplexing (even when mux is disabled)

The framing protocol must include a stream ID field even in single-stream mode. This means the v1 wire format is forwards-compatible with multiplexing without a breaking change.

| Attribute | Value |
|-----------|-------|
| Complexity | S |
| Depends on | Message envelope |
| API surfaces | LL only |
| Why table stakes | If stream IDs are omitted now, enabling multiplexing later requires a breaking wire format change. The field cost is negligible (a small integer). |

#### [D] Optional multiplexer: multiple logical streams over one channel

When the caller opts in to multiplexing, multiple concurrent logical streams share one underlying postMessage channel. Each stream has its own sequence space and backpressure credit window. Streams are independent — a blocked stream does not head-of-line block other streams (unlike TCP, similar to QUIC/HTTP3 stream independence).

| Attribute | Value |
|-----------|-------|
| Complexity | L |
| Depends on | Stream ID framing, Credit-based backpressure (per-stream), Sequence numbering (per-stream) |
| API surfaces | LL (mux layer); Streams surface exposes as `mux.createStream()` → `{ readable, writable }`; EE surface exposes as `mux.createChannel()` |
| Why differentiator | No postMessage library has this. WebRTC DataChannels on a single RTCPeerConnection offer something similar but require ICE/DTLS overhead. QUIC/HTTP3 stream independence is the design inspiration — each stream has its own flow-control window. |

---

### Category 7: API Surfaces

Three distinct surfaces over the same underlying protocol.

#### [TS] WHATWG Streams surface: `{ readable: ReadableStream, writable: WritableStream }` pair

The primary API. `connect(endpoint)` returns a `{ readable, writable }` pair. The caller reads from `readable` and writes to `writable` using the standard WHATWG Streams API. Backpressure, piping, TransformStream composition, `pipeTo`, `pipeThrough` all work natively.

| Attribute | Value |
|-----------|-------|
| Complexity | M |
| Depends on | All framing + flow control features; WHATWG Streams native backpressure integration |
| API surfaces | Streams |
| Why table stakes | PROJECT.md specifies this as the primary surface. It is also the ergonomically correct 2026 browser streams API — enables composition with Fetch API streams, WebCodecs, and TransformStreams without adapters. |

#### [TS] Node-style EventEmitter surface: `stream.on('data', ...)`, `stream.write(...)`, `stream.end()`

Alternate API for callers who prefer the Node.js stream model. `on('data', cb)`, `on('end', cb)`, `on('error', cb)`, `write(chunk)`, `end()`. This surface is a thin wrapper over the low-level send/recv API.

| Attribute | Value |
|-----------|-------|
| Complexity | S |
| Depends on | Low-level send/recv API |
| API surfaces | EE |
| Why table stakes | PROJECT.md specifies this as an alternate surface. Many existing worker and service worker codebases use Node-style streams conventions. Provides a migration path for consumers of post-message-stream. |

#### [TS] Low-level `send(chunk, options?)` / `onChunk(handler)` API

The escape hatch for callers who want to build their own abstractions (custom multiplexing, custom serialization, custom backpressure signals). Exposes the framing and transport primitives directly.

| Attribute | Value |
|-----------|-------|
| Complexity | S |
| Depends on | Message envelope, Fast-path selection |
| API surfaces | LL |
| Why table stakes | PROJECT.md specifies this as the third surface. It is also necessary for building the Streams and EE surfaces on top. Without it, the library cannot be composed or extended. |

#### [D] Symmetric two-sided wiring: same API on both sides of the boundary

Both the sender and receiver call the same `connect(endpoint)` function (or equivalent). There is no "server" and "client" — the endpoint role is the same from both sides. Comlink's `expose`/`wrap` asymmetry is a DX friction point; this library avoids it.

| Attribute | Value |
|-----------|-------|
| Complexity | S (design decision, not extra code) |
| Depends on | All API surfaces |
| API surfaces | All |
| Why differentiator | Comlink requires distinguishing `expose` from `wrap`. postmate requires distinguishing parent from child. iframebuffer's symmetric model means the same code snippet works on either side of any boundary. |

#### [D] TypeScript generic types: `Stream<T>` where T is the chunk type

The Streams surface is typed: `ReadableStream<Uint8Array>`, `WritableStream<{ type: 'event', data: unknown }>`, etc. Type flows through pipe chains. The LL surface also exposes generic types on `send<T>` and `onChunk<T>`.

| Attribute | Value |
|-----------|-------|
| Complexity | S |
| Depends on | All API surfaces |
| API surfaces | All |
| Why differentiator | post-message-stream has no generics. remote-web-streams has basic generics but no carry-through on pipe chains. A well-typed library reduces integration bugs — important for the security-sensitive contexts (sandboxed iframes) this library targets. |

---

### Category 8: Topology and Multi-Hop Relay

#### [D] Transparent multi-hop relay mode

A relay is a context that forwards a stream from one endpoint to another without consuming its contents. The relay receives chunks from an upstream endpoint and forwards them to a downstream endpoint with no knowledge of the payload. Backpressure flows backwards through the relay. Error signals propagate in both directions.

The caller instantiates the relay by connecting two endpoints:
```
relayStream(upstreamEndpoint, downstreamEndpoint, options?)
```

This covers the worker → main-thread → sandboxed iframe topology in PROJECT.md.

| Attribute | Value |
|-----------|-------|
| Complexity | L |
| Depends on | Credit-based backpressure (bidirectional), Stream lifecycle messages, Framing |
| API surfaces | LL (relay function); Streams surface exposes as `pipeThrough` composition if caller wants to inspect/transform in the relay |
| Why differentiator | No comparable library supports this. It is the single hardest design challenge and the explicit "known hard case" in PROJECT.md. |

#### [D] Endpoint type abstraction (`PostMessageEndpoint` interface)

Define a minimal interface `{ postMessage(data, transfer?): void; onmessage: (e: MessageEvent) => void }` that covers `MessagePort`, `Worker`, `ServiceWorker`, `Window`, `DedicatedWorkerGlobalScope`. The caller wires their existing channel by passing an object implementing this interface. The library does not care whether the endpoint is a worker or an iframe.

| Attribute | Value |
|-----------|-------|
| Complexity | S |
| Depends on | Message envelope |
| API surfaces | All |
| Why differentiator | @metamask/post-message-stream requires choosing the specific stream class per context type (`WindowPostMessageStream` vs `WebWorkerPostMessageStream`). iframebuffer's single interface accepts any postMessage-compatible endpoint, including custom relay adapters. |

---

### Category 9: Observability and Diagnostics

#### [D] Per-stream metrics: bytes sent/received, chunks in-flight, credit window, round-trip latency estimate

Expose a `stream.stats()` call returning counters: `bytesSent`, `bytesReceived`, `chunksInFlight`, `creditWindow`, `estimatedRTT`. These are the minimum for diagnosing throughput and backpressure issues.

| Attribute | Value |
|-----------|-------|
| Complexity | M |
| Depends on | All framing, flow control, and chunking features |
| API surfaces | All (`.stats()` method or EventEmitter `stats` event) |
| Why differentiator | No comparable library exposes this. Without metrics, callers cannot tune chunk size or diagnose backpressure stalls. Metrics also enable the benchmark harness (PROJECT.md requirement) to run inside the library rather than externally instrumented. |

#### [D] Debug mode: verbose framing trace (dev-only, tree-shaken in production)

A `debug: true` option that emits structured log events (stream ID, sequence number, chunk type, credits sent/received) through a caller-provided logger or `console.debug`. Must be fully tree-shaken when `debug: false` or in production builds (no runtime cost when off).

| Attribute | Value |
|-----------|-------|
| Complexity | S |
| Depends on | All framing features |
| API surfaces | All (init option) |
| Why differentiator | Multi-hop topologies are notoriously hard to debug with browser DevTools. A structured trace of the framing protocol makes integration debugging tractable. No comparable library offers this. |

---

### Category 10: Error Handling

#### [TS] Stream error propagation: sender abort → receiver error, receiver cancel → sender abort

If the sender aborts the WritableStream, the receiver's ReadableStream must error with the abort reason. If the receiver cancels the ReadableStream, the sender's WritableStream must abort. This is the WHATWG Streams contract — but it must be implemented over postMessage, which means explicit error/cancel control messages.

| Attribute | Value |
|-----------|-------|
| Complexity | S |
| Depends on | Stream lifecycle messages (error type) |
| API surfaces | Streams (cancel/abort); EE (error event); LL (error envelope) |
| Why table stakes | Without this, stream errors are silent. Postmate's `.get()` error-swallowing bug is a known user complaint precisely because of this gap. |

#### [TS] Context termination detection (worker terminated, iframe unloaded)

When the underlying context disappears (worker is terminated, iframe is removed from DOM, service worker is killed), the library must detect this and error all active streams rather than leaving them stalled indefinitely. Mechanism: message timeout + explicit teardown message on `beforeunload`/`unload`/worker `terminate`.

| Attribute | Value |
|-----------|-------|
| Complexity | M |
| Depends on | Stream lifecycle messages |
| API surfaces | All |
| Why table stakes | PROJECT.md explicitly states that streams must error out when the channel dies (reconnection is the caller's job). Without detection, a terminated worker results in silently stalled streams — a production failure mode. |

---

## Anti-Features

Features to explicitly not build — with reasoning to prevent re-adding.

### [AF] RPC / Request-Response

| Field | Value |
|-------|-------|
| Why requested | Comlink is popular; callers naturally want `await remoteFunction()` ergonomics |
| Why it is an anti-feature | RPC requires matching a request to a response, which means correlation IDs, timeout semantics, cancellation, and error unwrapping — an entirely separate protocol layered over the stream. It also tempts consumers to use the library as a Comlink replacement rather than a data transport. Stream-vs-RPC is a category distinction, not a feature flag. If RPC is wanted, the caller can build it on top of the low-level `send`/`onChunk` surface. |
| Alternative | Use the LL surface to build a thin RPC adapter. Comlink itself can be used alongside for RPC; this library handles the data transfer. |

### [AF] Automatic reconnection

| Field | Value |
|-------|-------|
| Why requested | When a worker crashes or an iframe reloads, callers don't want to wire up a new stream manually |
| Why it is an anti-feature | Reconnection requires session identity, state recovery semantics, and knowledge of what in-flight data was lost — none of which the library has access to. A reconnected stream cannot resume mid-chunk without application-layer coordination. Caller decides whether to re-establish and whether to replay. Building reconnect into the library creates false guarantees and unpredictable behavior on context lifecycle events. |
| Alternative | Surface clean error events on context death. Document the reconnect pattern (create a new stream) in examples. |

### [AF] Channel discovery / handshake helpers

| Field | Value |
|-------|-------|
| Why requested | Postmate does this; callers want "just give me the iframe and get a stream" ergonomics |
| Why it is an anti-feature | Discovery requires polling, handshake timing logic, origin validation strategy, and iframe load sequencing — all of which depend on the host application's lifecycle. Doing this incorrectly is a security risk (origin spoofing). The caller already manages the iframe/worker lifecycle; having the library also manage it creates unclear ownership. |
| Alternative | Provide a short (< 20 lines) code example showing how to wire up postMessage on both sides and pass the endpoint to the library. |

### [AF] Encryption / authentication

| Field | Value |
|-------|-------|
| Why requested | Cross-origin data in sandboxed iframes raises security concerns |
| Why it is an anti-feature | The browser's origin model already provides isolation. Adding encryption without key management is security theater (where does the key come from?). Key management is a complex separate domain. Adding it bloats scope, adds auditable crypto code, and creates a false sense of security that may lead callers to skip proper CORS/CSP configuration. |
| Alternative | Document the threat model (origin isolation, CSP) and recommend SubtleCrypto for callers who genuinely need end-to-end encryption at the application layer. |

### [AF] Compression

| Field | Value |
|-------|-------|
| Why requested | High-bitrate streams of compressible data (JSON events, text) would benefit from compression |
| Why it is an anti-feature in v1 | Compression requires compute (even fast codecs like LZ4 take CPU cycles). For binary payloads (the primary use case) data is typically already compressed. For structured-clone payloads (JSON-like), the browser's own structured-clone encoding is compact. Adding WASM compression increases bundle size, CSP requirements, and complexity. The benchmark must first show that channel bandwidth (not compute) is the bottleneck before compression is justified. |
| Alternative | Design the LL surface so callers can inject a TransformStream that compresses before passing to `send()`. If benchmarks in a later milestone show channel saturation, add an optional WASM compression module as a separate entry point. |

### [AF] SharedWorker / BroadcastChannel support in v1

| Field | Value |
|-------|-------|
| Why requested | SharedWorker enables many-tab architectures; BroadcastChannel is postMessage-like |
| Why it is an anti-feature in v1 | BroadcastChannel has no Transferable support and always structured-clones — the fast path does not apply. SharedWorker's `.port` interface requires MPSC semantics which conflict with the SPSC SAB fast path. Both contexts add significant complexity to the framing and multiplexing layer for marginal initial value. |
| Alternative | The `PostMessageEndpoint` abstraction is designed to accept a SharedWorker's `.port`. Explicitly mark as untested in v1 docs. Promote to supported in v1.x after the core is stable. |

### [AF] Node / Deno / Bun support in v1

| Field | Value |
|-------|-------|
| Why requested | The API is plausibly portable to `worker_threads` postMessage |
| Why it is an anti-feature in v1 | Node worker_threads `postMessage` has different Transferable semantics. SAB behavior differs. Service worker and iframe concepts do not exist. Cross-runtime support requires a separate test matrix, different feature detection paths, and different build outputs. |
| Alternative | Ensure the `PostMessageEndpoint` interface is generic enough that a Node adapter is plausible. Do not actively break Node compatibility. Do not test or document it. |

---

## Feature Dependencies

```
Message envelope (framing)
    ├──requires──> Sequence numbering
    │                  ├──requires──> Chunk reassembly (in-order delivery)
    │                  │                  └──requires──> Credit-based backpressure
    │                  │                                     └──requires──> WHATWG Streams backpressure integration
    │                  └──requires──> Gap detection (reliability)
    ├──requires──> Stream lifecycle messages (open/data/end/error)
    │                  ├──requires──> Error propagation (abort/cancel)
    │                  └──requires──> Context termination detection
    └──requires──> Chunk type tag
                       ├──requires──> Transferable ArrayBuffer path
                       │                  └──enhances──> SAB ring-buffer fast path (optional)
                       └──requires──> Native Transferable Stream delegation (optional)

Credit-based backpressure
    └──enhances──> Backpressure propagation through relay hops
                       └──requires──> Multi-hop relay (relayStream)

Stream ID framing
    └──enables──> Optional multiplexer (per-stream credit windows + sequence spaces)

Low-level send/onChunk API
    └──enables──> EventEmitter surface
    └──enables──> WHATWG Streams surface

WHATWG Streams surface
    └──requires──> WHATWG Streams backpressure integration

PostMessageEndpoint interface
    └──enables──> Multi-hop relay (relay connects two endpoints)
    └──enables──> Symmetric two-sided wiring

Per-stream metrics
    └──requires──> All framing + flow control features (reads their counters)
```

### Dependency Notes

- **SAB ring-buffer fast path requires transferable path**: The fallback must be fully correct before the fast path is built. Fast path correctness relies on the fallback being tested first.
- **Multi-hop relay requires credit-based backpressure**: A relay without backpressure propagation is a buffer bomb — it will accumulate unbounded data in the relay context. Build backpressure first.
- **WHATWG Streams backpressure integration requires credit-based backpressure**: The Streams surface is a thin adapter over the LL protocol. The credit window is the LL primitive that drives `desiredSize` on the Streams surface.
- **Optional multiplexer conflicts with SPSC SAB fast path**: The SAB ring buffer is strictly single-producer/single-consumer. Multiplexing over a shared SAB requires either per-stream SABs or demultiplexing in the ring buffer itself. This is why multiplexing is optional and deferred — it forces a different fast-path architecture.

---

## MVP Definition

### Launch With (v1)

Core features required to validate the primary thesis: "beats naive postMessage for binary payloads, works across topologies."

- [ ] Message envelope with type tag and stream ID — framing foundation
- [ ] Sequence numbering per stream — ordering foundation
- [ ] Stream lifecycle messages (open/data/end/error) — stream lifecycle
- [ ] Chunk type tag (binary / structured-clone) — fast-path routing
- [ ] Transferable ArrayBuffer path — primary performance claim
- [ ] Feature detection failing gracefully to structured-clone postMessage — CSP safety guarantee
- [ ] Automatic chunking of large ArrayBuffers — handles hundreds-of-MB payloads
- [ ] Chunk reassembly with in-order delivery — TCP-like semantics
- [ ] Credit-based backpressure signaling — live stream correctness
- [ ] WHATWG Streams surface (`{ readable, writable }` pair) — primary API surface
- [ ] Node-style EventEmitter surface — alternate API surface
- [ ] Low-level `send` / `onChunk` API — escape hatch + foundation for other surfaces
- [ ] Stream error propagation (abort → error, cancel → abort) — observable errors
- [ ] Context termination detection — observable channel death
- [ ] PostMessageEndpoint interface — works with any postMessage-compatible object
- [ ] Stream ID framing field (even in single-stream mode) — wire-format forwards compatibility

### Add After Validation (v1.x)

Features that require the core to be stable before they can be correctly designed.

- [ ] SAB ring-buffer fast path — benchmarks must first confirm transferable path headroom
- [ ] Multi-hop relay (`relayStream`) — hardest feature; requires backpressure to be rock-solid first
- [ ] Backpressure propagation through relay hops — depends on relay
- [ ] Graceful abort propagation through relay hops — depends on relay
- [ ] Per-stream metrics (`stream.stats()`) — useful once core is stable
- [ ] Debug mode (verbose framing trace) — useful for integration support once users appear
- [ ] Native Transferable ReadableStream delegation — Safari stable support needs to land first
- [ ] Configurable chunk size with benchmark-derived defaults — needs benchmark data from v1

### Future Consideration (v2+)

Features to defer until product-market fit and use-case evidence.

- [ ] Optional multiplexer — design conflicts with SAB fast path; needs careful API design based on real usage
- [ ] SharedWorker / BroadcastChannel support — different MPSC semantics; defer to v2
- [ ] WASM compression as optional entry point — only if benchmarks show channel saturation
- [ ] Cross-runtime (Node / Deno / Bun) adapters — separate milestone per PROJECT.md

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Transferable ArrayBuffer path | HIGH (primary perf claim) | LOW | P1 |
| Automatic chunking + reassembly | HIGH (large payload support) | MEDIUM | P1 |
| Credit-based backpressure | HIGH (live stream correctness) | MEDIUM | P1 |
| WHATWG Streams surface | HIGH (primary API) | MEDIUM | P1 |
| Stream lifecycle + error propagation | HIGH (observable correctness) | LOW | P1 |
| Feature detection + graceful fallback | HIGH (CSP safety) | MEDIUM | P1 |
| PostMessageEndpoint interface | HIGH (topology flexibility) | LOW | P1 |
| EventEmitter surface | MEDIUM (migration path) | LOW | P1 |
| Low-level send/onChunk | MEDIUM (extensibility) | LOW | P1 |
| Context termination detection | MEDIUM (production robustness) | MEDIUM | P1 |
| SAB ring-buffer fast path | HIGH (perf ceiling) | HIGH | P2 |
| Multi-hop relay | HIGH (project hard case) | HIGH | P2 |
| Per-stream metrics | MEDIUM (observability) | MEDIUM | P2 |
| Debug trace mode | MEDIUM (DX) | LOW | P2 |
| Native Transferable Stream delegation | MEDIUM (Safari parity) | MEDIUM | P2 |
| Configurable chunk size | LOW (tuning) | LOW | P2 |
| Optional multiplexer | MEDIUM (advanced use cases) | HIGH | P3 |
| WASM compression module | LOW (conditional on benchmarks) | HIGH | P3 |

---

## Competitor Feature Analysis

| Feature | Comlink | post-message-stream (MetaMask) | remote-web-streams | iframebuffer |
|---------|---------|-------------------------------|-------------------|-------------|
| Framing protocol | RPC envelope only | Named duplex stream wrapper | MessagePort chunk-per-write | Full framing: type tag, seq num, stream ID, lifecycle |
| Large binary chunking | No | No | No | Yes (automatic, configurable) |
| Transferable ArrayBuffer | Manual (`Comlink.transfer()`) | No | Per-write (caller controls) | Auto-detected per chunk |
| SAB fast path | No | No | No | Yes (feature-detected, SPSC) |
| Native Transferable Stream | No | No | No | Yes (feature-detected, single-hop) |
| Backpressure | No | Node stream highWaterMark (intra-process) | None across context boundary | Credit-based cross-context window |
| WHATWG Streams surface | No | No | Yes (primary) | Yes (primary) |
| Node EventEmitter surface | No | Yes (primary) | No | Yes (alternate) |
| Low-level send/recv | No | No | No (port exposed) | Yes (explicit) |
| Multi-hop relay | No | No | No | Yes (v1.x) |
| Ordered delivery | postMessage FIFO only | postMessage FIFO only | postMessage FIFO only | Yes (reorder buffer on multi-hop) |
| Error propagation | RPC exceptions re-thrown | Node stream error events | None explicit | Bidirectional, through relay hops |
| Context termination | No | No | No | Yes (timeout + unload hook) |
| Multiplexing | One proxy per RPC call | Named streams (separate ports) | One stream per port pair | Optional (v2) |
| TypeScript generics | `Remote<T>` (best-effort) | No | Basic | Full generic types |
| Symmetric API | No (expose vs wrap) | No (Parent vs Worker class) | No (Remote vs from*Port) | Yes |
| Zero runtime deps | No (uses Proxy) | No | No | Yes |

---

## Sources

- GitHub: GoogleChromeLabs/comlink README (verified via WebFetch) — RPC features, `transfer()`, custom handlers, WeakRef proxy
- GitHub: MetaMask/post-message-stream README (verified via WebFetch) — stream types, Node duplex wrapper, Electron limitation
- GitHub: MattiasBuelens/remote-web-streams README (verified via WebFetch) — WHATWG Streams design, MessagePort transport, backpressure gap admission
- GitHub: padenot/ringbuf.js README (verified via WebFetch) — SPSC SAB ring buffer, wait-free design, SPSC constraint
- WebKit blog: Safari Technology Preview 238 (Feb 26 2026) — ReadableStream postMessage transfer support confirmed (not yet in stable Safari)
- Chrome Developers blog (transferable-objects-lightning-fast) — 32 MB: 302 ms structured-clone vs 6.6 ms transferable benchmark data
- surma.dev "Is postMessage slow?" — postMessage overhead analysis, transfer vs clone decision factors
- WHATWG Streams spec issue #244 — cross-worker backpressure design challenges; two-stage plan for transferable + backpressure
- Chrome Status: Streams API transferable streams (feature/5298733486964736) — browser support status
- MDN: SharedArrayBuffer — COOP/COEP requirements for SAB availability
- MDN: Transferable objects — browser support matrix for ArrayBuffer, MessagePort, ReadableStream, WritableStream
- RFC 9000 (QUIC) — stream ID framing design, per-stream flow control, head-of-line blocking independence
- GitHub: dollarshaveclub/postmate README — handshake pattern, iframe-only limitation, error-swallowing bug

---

*Feature research for: iframebuffer — postMessage streaming library*
*Researched: 2026-04-21*
