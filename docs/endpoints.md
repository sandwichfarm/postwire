# Endpoint Adapters

postwire ships four adapter factories that wrap the native postMessage shapes into a uniform `PostMessageEndpoint` interface. Choose the one that matches your transport.

## PostMessageEndpoint interface

```ts
interface PostMessageEndpoint {
  postMessage(message: unknown, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
}
```

All four adapters produce a value that satisfies this interface and can be passed to `createChannel`.

## createWorkerEndpoint

Wraps a `Worker` (from main thread) or `DedicatedWorkerGlobalScope` (from inside the worker).

```ts
import { createWorkerEndpoint } from "postwire";

// Main thread side:
const worker = new Worker("./worker.js", { type: "module" });
const endpoint = createWorkerEndpoint(worker);

// Worker side (inside worker.js):
const endpoint = createWorkerEndpoint(self as DedicatedWorkerGlobalScope);
```

SAB-capable when the page is cross-origin-isolated (COOP/COEP headers set). Workers share the same agent cluster as their parent page.

## createMessagePortEndpoint

Wraps a `MessagePort`. The most flexible adapter — works for any MessageChannel-based topology including cross-origin iframes.

```ts
import { createMessagePortEndpoint } from "postwire";

const { port1, port2 } = new MessageChannel();
const endpoint = createMessagePortEndpoint(port1);
// Transfer port2 to the other side
```

MessagePort endpoints need the port to be wired before creating the channel. The adapter starts the port (`port.start()`) automatically.

SAB-capable depends on the receiving context (cross-origin iframes without `allow-same-origin` are not SAB-capable).

## createWindowEndpoint

Wraps a cross-origin `Window` (e.g. an iframe's `contentWindow` or a `window.opener`). Requires a non-wildcard `expectedOrigin` — the library validates `MessageEvent.origin` on every inbound message and drops messages from other origins.

```ts
import { createWindowEndpoint } from "postwire";

const iframe = document.querySelector("iframe");
const endpoint = createWindowEndpoint(
  iframe.contentWindow,
  "https://trusted-origin.example.com"  // required, no wildcard
);
```

The origin check is enforced by the library. Passing `"*"` is refused at the type level — see [Security](security.md).

Window endpoints are typically used for one-way control messages. For bulk data over a cross-origin iframe, prefer a `MessageChannel` handed to the iframe via `postMessage`, then use `createMessagePortEndpoint`.

SAB-capable only when the iframe is same-origin and the page is cross-origin-isolated.

## createServiceWorkerEndpoint

Wraps a `ServiceWorker` (from a page talking to its SW) or a `Client` (from inside the SW talking to a controlled page).

```ts
import { createServiceWorkerEndpoint } from "postwire";

// Page side:
const sw = await navigator.serviceWorker.ready;
const endpoint = createServiceWorkerEndpoint(sw.active);

// SW side (inside service-worker.js):
self.addEventListener("message", (ev) => {
  const endpoint = createServiceWorkerEndpoint(ev.source);
  const channel = createChannel(endpoint);
  // ...
});
```

Service worker endpoints are always marked **SAB-incapable** in the CAPABILITY frame — service workers run in a different agent cluster and `SharedArrayBuffer` cannot be shared across the boundary.

Use `options.heartbeat` on channels wired to service workers to detect SW recycling:

```ts
const channel = createChannel(endpoint, {
  endpointKind: "serviceworker",
  heartbeat: { intervalMs: 5_000, timeoutMs: 10_000 },
});
channel.on("error", (err) => {
  if (err.code === "CHANNEL_DEAD") {
    // SW was recycled — reconnect
  }
});
```

## sabCapable flag

Each adapter sets a `sabCapable` flag on the `PostMessageEndpoint`. The flag drives the CAPABILITY handshake — SAB fast path is activated only when both sides advertise `sab: true`. Callers cannot override this flag; it reflects real runtime capability.

To check after handshake:

```ts
await channel.capabilityReady;
console.log(channel.capabilities.sab); // true only if cross-origin-isolated + both opt in
```

## See also

- [Topology](topology.md) — how to wire endpoints for two-party, relay, and multiplex
- [Security](security.md) — origin validation details
- [Errors](errors.md) — `ORIGIN_REJECTED`, `CHANNEL_DEAD`, `SAB_INIT_FAILED`
