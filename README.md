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
| [API · low-level](https://github.com/sandwichfarm/postwire/blob/HEAD/docs/api/lowlevel.md) | `createLowLevelStream` — the primitive all adapters compose on |
| [API · EventEmitter](https://github.com/sandwichfarm/postwire/blob/HEAD/docs/api/emitter.md) | `createEmitterStream` — Node-style EventEmitter wrapper |
| [API · WHATWG Streams](https://github.com/sandwichfarm/postwire/blob/HEAD/docs/api/streams.md) | `createStream` — `{ readable, writable }` pair |
| [Endpoints](https://github.com/sandwichfarm/postwire/blob/HEAD/docs/endpoints.md) | Worker, MessagePort, Window, ServiceWorker adapters |
| [Topology](https://github.com/sandwichfarm/postwire/blob/HEAD/docs/topology.md) | Two-party, relay bridge, multiplex mode |
| [Errors](https://github.com/sandwichfarm/postwire/blob/HEAD/docs/errors.md) | All `StreamError.code` values with recovery patterns |
| [Security](https://github.com/sandwichfarm/postwire/blob/HEAD/docs/security.md) | Origin validation, strict CSP, COOP/COEP, trust boundaries |
| [Benchmarks](https://github.com/sandwichfarm/postwire/blob/HEAD/docs/benchmarks.md) | Throughput/latency table from `benchmarks/results/baseline.json` |
| [Decisions](https://github.com/sandwichfarm/postwire/blob/HEAD/docs/decisions.md) | Architecture decision log |

## Examples

| Example | Description |
|---|---|
| [01 · parent ↔ iframe](https://github.com/sandwichfarm/postwire/tree/HEAD/examples/01-parent-iframe) | Parent sends 1 MB blob to sandboxed iframe via `createStream` |
| [02 · main ↔ worker](https://github.com/sandwichfarm/postwire/tree/HEAD/examples/02-main-worker) | Main thread streams data to a Worker; delivery rate logged |
| [03 · three-hop relay](https://github.com/sandwichfarm/postwire/tree/HEAD/examples/03-three-hop) | Worker → main relay → strict-CSP iframe; live chunk counter |
| [04 · multiplex](https://github.com/sandwichfarm/postwire/tree/HEAD/examples/04-multiplex) | Two concurrent streams over one MessageChannel |
| [05 · strict CSP](https://github.com/sandwichfarm/postwire/tree/HEAD/examples/05-strict-csp) | Sandboxed iframe receives 512 KB payload under `script-src 'self'` |

Run any example:

```sh
git clone https://github.com/sandwichfarm/postwire
cd postwire/examples/01-parent-iframe
pnpm install && pnpm dev
```

## Benchmarks

<!-- bench:start -->
_Environment: Node 22.22.1 · MessageChannel (node) · commit d32e87c · 2026-04-21T18:27:10.870Z_

| Scenario | Payload | Throughput (MB/s) | p50 (ms) | p99 (ms) | Samples |
|---|---|---:|---:|---:|---:|
| library (transferable) | 1 KB | 13.35 | 0.07 | 0.11 | 26,081 |
| library (transferable) | 64 KB | 721.75 | 0.09 | 0.16 | 22,027 |
| library (transferable) | 1 MB | 2222.94 | 0.44 | 0.77 | 4,240 |
| library (transferable) | 16 MB | 1923.45 | 8.63 | 10.69 | 230 |
| | | | | | |
| library (SAB) | 1 KB | 3.29 | 0.25 | 0.96 | 6,431 |
| library (SAB) | 64 KB | 207.96 | 0.28 | 1.09 | 6,347 |
| library (SAB) | 1 MB | 1197.53 | 0.98 | 1.50 | 2,285 |
| library (SAB) | 16 MB | 1296.44 | 14.80 | 19.37 | 155 |
| | | | | | |
| library (structured-clone) | 1 KB | 13.96 | 0.07 | 0.14 | 27,263 |
| library (structured-clone) | 64 KB | 140.58 | 0.44 | 0.75 | 4,291 |
| library (structured-clone) | 1 MB | 119.11 | 8.39 | 12.27 | 228 |
| library (structured-clone) | 16 MB | 64.76 | 256.31 | 321.51 | 10 |
| | | | | | |
| naive postMessage | 1 KB | 63.88 | 0.02 | 0.03 | 124,768 |
| naive postMessage | 64 KB | 1600.62 | 0.04 | 0.10 | 48,848 |
| naive postMessage | 1 MB | 2519.02 | 0.38 | 1.91 | 4,805 |
| naive postMessage | 16 MB | 4511.95 | 3.53 | 5.29 | 538 |

> **On the `naive postMessage` row.** This baseline is a single raw `ArrayBuffer` transfer per message — no framing, no ordering, no backpressure, no multiplexing, no relay. It measures the ceiling of the underlying transport, not a comparable alternative. postwire layers stream semantics on top of that transport (ordered delivery, credit-window backpressure, multiplexed streams, multi-hop relay via structured-clone-only hops) that raw `postMessage` cannot provide. The honest question is _"does this overhead fit my budget for the features I need?"_ — not _"is it faster than the transport it is built on?"_ It is not, and cannot be.

_Generated by `scripts/bench-to-readme.mjs` — do not edit by hand._
<!-- bench:end -->

## License

[MIT](./LICENSE) © 2026 Sandwich Farm LLC
