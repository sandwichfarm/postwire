# Security Model

## Origin validation

The `createWindowEndpoint` adapter requires a non-wildcard `expectedOrigin`. Every inbound `MessageEvent` is validated against this origin before decoding:

```ts
import { createWindowEndpoint } from "iframebuffer";

// CORRECT — explicit expected origin
const endpoint = createWindowEndpoint(
  iframe.contentWindow,
  "https://embed.example.com"
);

// WRONG — wildcard is refused at the type level
// createWindowEndpoint(iframe.contentWindow, "*");  // TypeScript error
```

If a message arrives from an unexpected origin, the library drops it silently and emits an `ORIGIN_REJECTED` `StreamError` on the channel. This prevents cross-site message injection even if the page is loaded in a context that receives messages from multiple origins.

**Why no wildcard?** A wildcard `targetOrigin` is a supply-chain attack vector. Sandboxed iframes or third-party scripts in the page could inject frames that the library would process, potentially corrupting stream state. The library refuses to ship a default that accepts `*`.

For bulk data transfer over a cross-origin iframe, the recommended pattern is:

1. Establish a `MessageChannel` via `postMessage` with an explicit `targetOrigin`.
2. Hand `port2` to the iframe.
3. Wrap `port1` with `createMessagePortEndpoint` on the parent side.
4. Wrap the received port with `createMessagePortEndpoint` inside the iframe.

MessagePort endpoints have no origin concept — the origin check happens at the `postMessage` hand-off step, which the caller controls.

## Strict CSP compatibility

The baseline path (postMessage + structured clone / transferable, no SAB, no WASM) is fully compatible with `Content-Security-Policy: default-src 'self'; script-src 'self'`:

- No `eval()`
- No `new Function()`
- No dynamic `import()` of external URLs
- No inline script injection
- No `blob:` or `data:` URL script execution

The library bundle (tsdown-built ESM) does not generate any `eval`-equivalent constructs.

### SAB path CSP requirements

The SAB (SharedArrayBuffer) fast path requires **cross-origin isolation** — not an `unsafe-eval` relaxation:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

These headers isolate the page into its own agent cluster and enable `SharedArrayBuffer`. They do not require relaxing the script execution policy. If COOP/COEP cannot be set (e.g. third-party embeds, existing CDN content), SAB falls back to the transferable path automatically — no caller change needed.

### WASM path (deferred)

The `./wasm` entry point is reserved for a future WASM milestone. When available, the WASM path will require `script-src 'wasm-unsafe-eval'` as an explicit caller opt-in. The baseline path will never require it.

## Trust boundaries

### Sandboxed iframes

An iframe with `sandbox="allow-scripts"` (no `allow-same-origin`) has no access to the parent's DOM or storage. The library works correctly in this context — the MessagePort channel is handed in via `postMessage` before the `allow-same-origin` restriction matters.

SAB is unavailable in cross-origin-sandboxed iframes (different agent cluster). The library detects this via `isSabCapable()` and falls back automatically.

### Service workers

Service workers run in a different agent cluster than the controlled pages. The library's `createServiceWorkerEndpoint` adapter marks the endpoint as SAB-incapable. Data flows only via postMessage.

Service workers may be terminated by the browser at any time. Use `options.heartbeat` to detect recycling and surface `CHANNEL_DEAD` instead of a silent stall.

### Workers

Dedicated workers share the same agent cluster as their parent page and are SAB-capable when the page is cross-origin-isolated. Shared workers and service workers are not.

## What the library does NOT do

- **No encryption** — use the caller-supplied crypto layer or rely on TLS at the transport level.
- **No authentication** — the library trusts the caller to establish the postMessage boundary with trusted parties.
- **No origin forgery detection** — the `ORIGIN_REJECTED` guard protects against _receiving_ from wrong origins; it does not prevent a malicious page from spoofing the _sender_ origin if the browser has a vulnerability. Trust the browser's origin isolation model.

## See also

- [Endpoint adapters](endpoints.md) — `createWindowEndpoint` origin parameter
- [Errors](errors.md) — `ORIGIN_REJECTED`, `SAB_INIT_FAILED`
