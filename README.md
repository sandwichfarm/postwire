# postwire

A high-throughput, reliable, ordered stream abstraction over any postMessage boundary — iframe, web worker, service worker, MessageChannel.

Drop it into your existing postMessage wiring. Get stream semantics with backpressure, ordering, typed errors, and feature-detected fast paths.

## Install

```sh
# npm
npm install postwire

# pnpm
pnpm add postwire

# JSR
npx jsr add @sandwich/postwire
# or: deno add jsr:@sandwich/postwire
```

## Quickstart

```ts
// main.ts — initiator side (parent page / main thread)
import { createChannel, createStream, createWorkerEndpoint } from "postwire";

const worker = new Worker("./worker.js", { type: "module" });
const endpoint = createWorkerEndpoint(worker);
const channel = createChannel(endpoint);

await channel.capabilityReady;

const { writable } = createStream(channel);
const writer = writable.getWriter();

for (const chunk of chunks) {
  await writer.write(chunk);
}
await writer.close();
```

```ts
// worker.ts — responder side
import { createChannel, createStream, createWorkerEndpoint } from "postwire";

const endpoint = createWorkerEndpoint(self as DedicatedWorkerGlobalScope);
const channel = createChannel(endpoint, { role: "responder" });

channel.onStream(() => {
  const { readable } = createStream(channel);
  readable.pipeTo(new WritableStream({
    write(chunk) { console.log("received", chunk); }
  }));
});
```

## What does this do?

- **Reliable + ordered delivery** — credit-based flow control with a reorder buffer; out-of-order frames are reassembled before surfacing to the consumer
- **Backpressure end-to-end** — WHATWG Streams `desiredSize` wired to the credit window; `pipeTo`/`pipeThrough` stall the writer when the reader is slow
- **Three API surfaces** — low-level `send/onChunk/close`, Node-style EventEmitter, or WHATWG `{ readable, writable }` pair
- **Four endpoint adapters** — `Worker`, `MessagePort`, `Window` (cross-origin iframe), `ServiceWorker`/`Client`
- **Feature-detected fast paths** — transferable `ArrayBuffer` (zero-copy), structured-clone fallback, opt-in `SharedArrayBuffer` ring (cross-origin-isolated only)
- **Relay topology** — `createRelayBridge` forwards frames between two channels without reassembly; credits propagate end-to-end
- **Multiplex mode** — multiple concurrent logical streams over one endpoint; per-stream credit windows are independent
- **Strict CSP compatible** — no `eval`, no `new Function`; WASM path is opt-in with explicit caller CSP relaxation
- **Lifecycle safety** — BFCache (`pagehide`), heartbeat for service workers, endpoint teardown (`CHANNEL_DEAD`/`CHANNEL_FROZEN`/`CHANNEL_CLOSED`)
- **Typed errors** — every failure is a `StreamError` with a stable `.code` discriminant
- **Zero runtime dependencies**

## Documentation

| Document | Contents |
|---|---|
| [API · low-level](https://github.com/sandwichfarm/postwire/blob/main/docs/api/lowlevel.md) | `createLowLevelStream` — the primitive all adapters compose on |
| [API · EventEmitter](https://github.com/sandwichfarm/postwire/blob/main/docs/api/emitter.md) | `createEmitterStream` — Node-style EventEmitter wrapper |
| [API · WHATWG Streams](https://github.com/sandwichfarm/postwire/blob/main/docs/api/streams.md) | `createStream` — `{ readable, writable }` pair |
| [Endpoints](https://github.com/sandwichfarm/postwire/blob/main/docs/endpoints.md) | Worker, MessagePort, Window, ServiceWorker adapters |
| [Topology](https://github.com/sandwichfarm/postwire/blob/main/docs/topology.md) | Two-party, relay bridge, multiplex mode |
| [Errors](https://github.com/sandwichfarm/postwire/blob/main/docs/errors.md) | All `StreamError.code` values with recovery patterns |
| [Security](https://github.com/sandwichfarm/postwire/blob/main/docs/security.md) | Origin validation, strict CSP, COOP/COEP, trust boundaries |
| [Benchmarks](https://github.com/sandwichfarm/postwire/blob/main/docs/benchmarks.md) | Throughput/latency table from `benchmarks/results/baseline.json` |
| [Decisions](https://github.com/sandwichfarm/postwire/blob/main/docs/decisions.md) | Architecture decision log |

## Examples

| Example | Description |
|---|---|
| [01 · parent ↔ iframe](https://github.com/sandwichfarm/postwire/tree/main/examples/01-parent-iframe) | Parent sends 1 MB blob to sandboxed iframe via `createStream` |
| [02 · main ↔ worker](https://github.com/sandwichfarm/postwire/tree/main/examples/02-main-worker) | Main thread streams data to a Worker; delivery rate logged |
| [03 · three-hop relay](https://github.com/sandwichfarm/postwire/tree/main/examples/03-three-hop) | Worker → main relay → strict-CSP iframe; live chunk counter |
| [04 · multiplex](https://github.com/sandwichfarm/postwire/tree/main/examples/04-multiplex) | Two concurrent streams over one MessageChannel |
| [05 · strict CSP](https://github.com/sandwichfarm/postwire/tree/main/examples/05-strict-csp) | Sandboxed iframe receives 512 KB payload under `script-src 'self'` |

Run any example:

```sh
git clone https://github.com/sandwichfarm/postwire
cd postwire/examples/01-parent-iframe
pnpm install && pnpm dev
```

## License

[MIT](./LICENSE) © 2026 Sandwich Farm LLC
