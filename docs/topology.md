# Topology Patterns

iframebuffer supports three topology patterns: two-party, relay (multi-hop), and multiplex.

## Two-party

The simplest and most common case. One initiator, one responder, one Channel on each side over a shared postMessage boundary (MessageChannel, Worker, Window, or ServiceWorker).

```
Initiator ←──────────── Channel ────────────→ Responder
             (postMessage / MessagePort / SAB)
```

Wire-up:

```ts
// initiator.ts
import {
  createChannel, createStream,
  createMessagePortEndpoint,
} from "iframebuffer";

const { port1, port2 } = new MessageChannel();
targetWindow.postMessage({ type: "PORT" }, expectedOrigin, [port2]);

const ch = createChannel(createMessagePortEndpoint(port1));
await ch.capabilityReady;
const { writable } = createStream(ch);
```

```ts
// responder.ts (inside the target frame)
import { createChannel, createStream, createMessagePortEndpoint } from "iframebuffer";

self.addEventListener("message", (ev) => {
  if (ev.data?.type === "PORT") {
    const ch = createChannel(createMessagePortEndpoint(ev.ports[0]));
    ch.onStream(() => {
      const { readable } = createStream(ch);
      readable.pipeTo(/* sink */);
    });
  }
});
```

## Relay (three-hop)

A relay bridge sits in the middle (e.g. the main thread), forwarding frames between two Channels without reassembly. Credit windows propagate end-to-end so the relay can't buffer unboundedly.

```
Worker ──── ChannelA ──── Main thread ──── ChannelB ──── Iframe
                              (relay)
```

```ts
// main.ts — relay bridge
import {
  createChannel, createRelayBridge,
  createWorkerEndpoint, createMessagePortEndpoint,
} from "iframebuffer";

const worker = new Worker("./worker.js", { type: "module" });
const { port1: toIframePort, port2: iframePort } = new MessageChannel();
iframe.contentWindow.postMessage({ type: "PORT" }, origin, [iframePort]);

const chA = createChannel(createWorkerEndpoint(worker));          // upstream
const chB = createChannel(createMessagePortEndpoint(toIframePort)); // downstream

await Promise.all([chA.capabilityReady, chB.capabilityReady]);

const bridge = createRelayBridge(chA, chB);
// bridge.stats() for relay metrics
```

```ts
// worker.ts — producer
import { createChannel, createStream, createWorkerEndpoint } from "iframebuffer";

const ch = createChannel(createWorkerEndpoint(self as DedicatedWorkerGlobalScope));
await ch.capabilityReady;

const { writable } = createStream(ch);
const writer = writable.getWriter();
// Stream data...
```

```ts
// iframe.ts — consumer
import { createChannel, createStream, createMessagePortEndpoint } from "iframebuffer";

self.addEventListener("message", (ev) => {
  if (ev.data?.type === "PORT") {
    const ch = createChannel(createMessagePortEndpoint(ev.ports[0]));
    ch.onStream(() => {
      const { readable } = createStream(ch);
      readable.pipeTo(/* sink */);
    });
  }
});
```

### How relay credit propagation works

`createRelayBridge` forwards frames at the raw-frame level — no reassembly, no structured-clone round-trip. Credits issued downstream (iframe → main) are forwarded upstream (main → worker) proportionally. The relay's memory use is bounded to `downstreamCreditWindow × maxChunkSize`. If the iframe is slow, the worker is paused, not the main thread.

## Multiplex

Multiplex mode runs multiple concurrent logical streams over a single endpoint. Each stream has its own credit window — a stalled stream does not block others.

Enable multiplex on **both** sides:

```ts
// initiator.ts
const ch = createChannel(endpoint, { multiplex: true });
await ch.capabilityReady;
console.log(ch.capabilities.multiplex); // true (when both sides opted in)

// Open two streams over the same channel
const { writable: fileWriter } = createStream(ch);
const controlEmitter = createEmitterStream(ch);
```

```ts
// responder.ts
const ch = createChannel(endpoint, { multiplex: true, role: "responder" });

ch.onStream((handle) => {
  // Called once per stream opened by the initiator
  const { readable } = createStream(ch);
  readable.pipeTo(/* per-stream sink */);
});
```

### Stream ID allocation

In multiplex mode, the initiator allocates odd stream IDs (1, 3, 5, …) and the responder allocates even IDs (2, 4, 6, …) — mirroring HTTP/2 stream ID rules. Both sides independently avoid collision without an extra handshake.

### Multiplex vs single-stream

Single-stream mode is the default. It is slightly more efficient (no stream-ID prefix in the dispatch table). Switch to multiplex only when you need concurrent logical streams over a single endpoint.

## See also

- [Endpoint adapters](endpoints.md) — Worker, MessagePort, Window, ServiceWorker
- [Streams API](api/streams.md) — `{ readable, writable }` pair
- [Emitter API](api/emitter.md) — Node-style EventEmitter
