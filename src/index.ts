/**
 * # postwire
 *
 * A high-throughput, reliable, ordered stream abstraction that slots into any
 * existing `postMessage` boundary — iframes, web workers, service workers,
 * `MessageChannel`, `BroadcastChannel` — with credit-based backpressure and
 * zero runtime dependencies.
 *
 * The library does not own the channel. Consumers wire it into their existing
 * `postMessage` code by handing it an endpoint (a `PostMessageEndpoint` — any
 * object with `postMessage` and a way to receive messages).
 *
 * Three API surfaces are provided, each tree-shakeable so callers only pay for
 * what they import:
 *
 * - {@link createLowLevelStream} — minimal `send(chunk, transfer?)` /
 *   `onChunk(cb)` primitive
 * - {@link createEmitterStream} — Node-style `EventEmitter` wrapper
 * - {@link createStream} — WHATWG Streams `{ readable, writable }` pair with
 *   `desiredSize` wired to the credit window for end-to-end backpressure
 *
 * Higher-level topologies:
 *
 * - {@link createChannel} — bidirectional channel over a single endpoint
 * - {@link createRelayBridge} — multi-hop relay (worker → main → iframe)
 *   with end-to-end credit forwarding and no reassembly buffers
 *
 * Feature-detected fast paths:
 *
 * - Transferable `ArrayBuffer` / `TypedArray` (zero-copy)
 * - `SharedArrayBuffer` + `Atomics.waitAsync` ring buffer when
 *   cross-origin-isolated (opt-in via `channel.options.sab`)
 *
 * @example Basic two-party stream over a `MessageChannel` pair
 * ```ts
 * import { createChannel, createStream } from "@sandwich/postwire";
 *
 * const { port1, port2 } = new MessageChannel();
 * const a = createChannel(port1);
 * const b = createChannel(port2);
 *
 * // consumer side
 * b.onStream((handle) => {
 *   const { readable } = createStream(b, { handle });
 *   readable.pipeTo(new WritableStream({
 *     write(chunk) { console.log("got", chunk); },
 *   }));
 * });
 *
 * // producer side
 * const { writable } = createStream(a);
 * const writer = writable.getWriter();
 * await writer.write(new Uint8Array([1, 2, 3]));
 * await writer.close();
 * ```
 *
 * @packageDocumentation
 * @module
 */

// ---------------------------------------------------------------------------
// Phase 1: Framing types and encode/decode
// ---------------------------------------------------------------------------

export { decode, encode } from "./framing/encode-decode.js";
export type {
  BaseFrame,
  CancelFrame,
  CapabilityFrame,
  ChunkType,
  CloseFrame,
  CreditFrame,
  DataFrame,
  Frame,
  OpenAckFrame,
  OpenFrame,
  ResetFrame,
} from "./framing/types.js";
export { FRAME_MARKER, PROTOCOL_VERSION } from "./framing/types.js";

// Phase 1: Transport endpoint adapters
export { createMessagePortEndpoint } from "./transport/adapters/message-port.js";
export type { ServiceWorkerEndpointMeta } from "./transport/adapters/service-worker.js";
export { createServiceWorkerEndpoint } from "./transport/adapters/service-worker.js";
export { createWindowEndpoint } from "./transport/adapters/window.js";
export { createWorkerEndpoint } from "./transport/adapters/worker.js";
export type { PostMessageEndpoint } from "./transport/endpoint.js";

// Phase 6: SAB capability probe (exported for callers who want to probe before channel creation)
export { isSabCapable } from "./transport/sab-capability.js";

// Phase 1: Sequence number arithmetic
export {
  HALF_WINDOW,
  SEQ_BITS,
  SEQ_MASK,
  seqGT,
  seqLT,
  seqLTE,
  seqMask,
  seqNext,
} from "./transport/seq.js";

// ---------------------------------------------------------------------------
// Phase 3: Typed error class (API-04)
// ---------------------------------------------------------------------------

export type { ErrorCode } from "./types.js";
export { StreamError } from "./types.js";

// ---------------------------------------------------------------------------
// Phase 3: Channel (API-04 entry point)
// ---------------------------------------------------------------------------

export type { ChannelOptions } from "./channel/channel.js";
export { Channel, createChannel } from "./channel/channel.js";

// ---------------------------------------------------------------------------
// Phase 3: Adapter factories — each is an independent entry point (API-04)
// Zero cross-imports between adapters: each depends only on Channel and types.
// ---------------------------------------------------------------------------

export type { EmitterOptions, EmitterStream } from "./adapters/emitter.js";
// EventEmitter adapter (API-02)
export { createEmitterStream } from "./adapters/emitter.js";
export type { LowLevelOptions, LowLevelStream } from "./adapters/lowlevel.js";
// Low-level adapter (API-01)
export { createLowLevelStream } from "./adapters/lowlevel.js";
export type { StreamsOptions, StreamsPair } from "./adapters/streams.js";
// WHATWG Streams adapter (API-03)
export { createStream } from "./adapters/streams.js";

// ---------------------------------------------------------------------------
// Phase 7: Relay bridge (TOPO-02, TOPO-03, TOPO-04)
// ---------------------------------------------------------------------------

export type {
  RelayBridge,
  RelayBridgeOptions,
  RelayStats,
} from "./relay/bridge.js";
export { createRelayBridge } from "./relay/bridge.js";
