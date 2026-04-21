# Errors

All failures surface as a `StreamError` with a stable `.code` discriminant. Import it for `instanceof` checks:

```ts
import { StreamError } from "iframebuffer";

channel.on("error", (err) => {
  if (err instanceof StreamError) {
    switch (err.code) {
      case "CHANNEL_DEAD":
        reconnect();
        break;
      case "ORIGIN_REJECTED":
        console.error("unexpected origin — check expectedOrigin");
        break;
    }
  }
});
```

## StreamError shape

```ts
class StreamError extends Error {
  readonly code: ErrorCode;       // stable discriminant
  readonly cause: unknown;        // original error when available
  readonly streamId?: number;     // which stream failed (multiplex mode)
}
```

## Error codes

### DataCloneError

**What:** The payload could not be serialized by structured clone. Usually an object with a non-cloneable property (function, DOM node, `Error` subclass with non-serializable fields).

**Common cause:** Passing a class instance that has methods or non-enumerable prototype chain members through structured clone.

**Recovery:** Serialize the payload before sending (JSON, MessagePack, etc.), or use the `BINARY_TRANSFER` path with a pre-serialized `ArrayBuffer`.

---

### ORIGIN_REJECTED

**What:** An inbound `MessageEvent` was received from an origin that did not match the `expectedOrigin` passed to `createWindowEndpoint`.

**Common cause:** The remote window sent a message from a different origin than expected (redirect, domain change, misconfiguration).

**Recovery:** Validate your `expectedOrigin` string. This is a security guard — do not suppress it. Log the rejected origin for diagnosis.

---

### CREDIT_DEADLOCK

**What:** The consumer stopped reading chunks for longer than the `stallTimeoutMs` threshold (default: 30 s), exhausting the credit window and stalling the producer.

**Common cause:** A slow `onChunk` handler, a broken `pipeTo` sink, or a consumer that stopped without closing the stream.

**Recovery:** Ensure the consumer reads chunks promptly. Increase `stallTimeoutMs` in `SessionOptions` if your consumer is intentionally slow. Close the stream explicitly when done.

---

### REORDER_OVERFLOW

**What:** The reorder buffer depth exceeded `maxReorderBuffer` (default: 256 frames). The out-of-order gap was too large to hold in memory.

**Common cause:** Extreme packet loss or reordering on the underlying transport (unusual for postMessage which delivers in order within a channel). More likely: a broken relay that forwards frames out of order.

**Recovery:** Inspect your relay implementation. For MessageChannel / Worker transports this should never occur — in-order delivery is guaranteed by the spec.

---

### PROTOCOL_MISMATCH

**What:** The remote side sent a `CAPABILITY` frame with a different `protocolVersion` than the local side.

**Common cause:** Running different versions of iframebuffer on the two sides of the boundary.

**Recovery:** Ensure both sides import the same version. This error fires before any data is exchanged.

---

### CHANNEL_FROZEN

**What:** The page was put into the BFCache (`pagehide` with `persisted: true`). The stream is paused — the remote side is still live.

**Common cause:** Browser navigated away from the page via back/forward; the page was BFCache'd rather than unloaded.

**Recovery:** The channel stays dead after BFCache restore. On `pageshow`, create a new `Channel` if you need to reconnect. The caller holds session state and decides whether to resume.

---

### CHANNEL_DEAD

**What:** The endpoint stopped responding. Either the heartbeat timed out (service worker recycled), or the SAB ring consumer stopped reading.

**Common cause:** Service worker was terminated by the browser mid-stream. SAB ring read loop died.

**Recovery:** Reconnect by obtaining a new endpoint and creating a new `Channel`. For service workers, re-register or wait for the browser to restart the SW.

---

### CHANNEL_CLOSED

**What:** The remote endpoint closed normally — the port was closed, the worker was terminated, or the iframe was unloaded (non-BFCache).

**Common cause:** The remote page navigated away, the `Worker` was `.terminate()`d, or `MessagePort.close()` was called.

**Recovery:** Create a new channel if the remote endpoint is expected to reopen. This is not an error state — it is a clean shutdown signal.

---

### SAB_INIT_FAILED

**What:** The `SharedArrayBuffer` ring-buffer handshake failed. The channel fell back to the postMessage transferable path transparently.

**Common cause:** The page is not cross-origin-isolated (missing `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` headers), or the receiver rejected the SAB.

**Recovery:** This is a fallback event, not a fatal error. Data continues to flow via postMessage. If SAB is important for your throughput, verify COOP/COEP headers are set correctly.

---

## Error surface points

| Where | What you get |
|---|---|
| `channel.on('error', cb)` | Channel-level errors: `PROTOCOL_MISMATCH`, `DataCloneError`, `CHANNEL_FROZEN`, `CHANNEL_DEAD`, `CHANNEL_CLOSED`, `SAB_INIT_FAILED` |
| `stream.onError(cb)` (low-level) | Stream-level errors: `CREDIT_DEADLOCK`, `REORDER_OVERFLOW`, `DataCloneError`, `ORIGIN_REJECTED` |
| `emitterStream.on('error', cb)` | Same as stream-level above |
| `readable.pipeTo()` rejection | WHATWG Streams surfaces errors as rejected promises |
| `writer.write()` rejection | Same, on the writable side |

## See also

- [Observability](https://github.com/iframebuffer/iframebuffer) — `channel.stats()`, trace hooks
- [Lifecycle](topology.md) — BFCache, teardown, heartbeat
- [Security](security.md) — origin validation
