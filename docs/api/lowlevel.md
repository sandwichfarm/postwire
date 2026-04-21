# Low-Level Stream API

`createLowLevelStream(channel, options?)` is the primitive that all higher-level adapters compose on. It gives you the thinnest possible layer over the session: a `send()` function, callbacks for inbound chunks and close, and an error callback.

## Import

```ts
import { createChannel, createLowLevelStream, createWorkerEndpoint } from "iframebuffer";
```

## Signature

```ts
function createLowLevelStream(
  channel: Channel,
  options?: LowLevelOptions
): LowLevelStream;

interface LowLevelOptions {
  /** Session options forwarded to channel.openStream(). */
  sessionOptions?: Partial<SessionOptions>;
}

interface LowLevelStream {
  send(chunk: unknown, transfer?: ArrayBuffer[]): Promise<void>;
  onChunk(cb: (chunk: unknown) => void): void;
  onClose(cb: () => void): void;
  onError(cb: (err: StreamError) => void): void;
  close(): void;
}
```

## send(chunk, transfer?)

Sends one chunk to the remote side.

- If `transfer` is provided (non-empty), the payload travels as `BINARY_TRANSFER` — the `ArrayBuffer` is transferred (zero-copy). The source buffer is detached after the call.
- If `transfer` is omitted, the payload travels as `STRUCTURED_CLONE` — any structured-cloneable value is accepted.

```ts
// Binary transfer (zero-copy):
const buf = new ArrayBuffer(65536);
await stream.send(buf, [buf]);
// buf.byteLength === 0 after send

// Structured clone:
await stream.send({ type: "event", payload: 42 });
```

`send()` resolves immediately after handing the frame to the session's credit queue. If send credits are exhausted, the session buffers the frame internally and drains when a `CREDIT` frame arrives from the remote side.

## onChunk(cb)

Registers a callback for each reassembled inbound chunk. The callback fires once per logical chunk — the library handles chunking and reassembly internally.

```ts
stream.onChunk((chunk) => {
  console.log("received", chunk);
});
```

## onClose(cb)

Fires when the remote side has sent all data and closed the stream gracefully (both parties exchanged `CLOSE` frames and all data up to `finalSeq` was delivered).

```ts
stream.onClose(() => {
  console.log("stream closed cleanly");
});
```

## onError(cb)

Fires when the stream fails. The `StreamError` has a `.code` discriminant for programmatic handling. See [docs/errors.md](../errors.md) for all codes.

```ts
stream.onError((err) => {
  if (err.code === "CREDIT_DEADLOCK") {
    // consumer stalled for too long
  }
});
```

## close()

Closes the underlying channel, sending a `CLOSE` frame with the correct `finalSeq` to the remote side.

```ts
stream.close();
```

## Two-party example

```ts
// initiator.ts
import { createChannel, createLowLevelStream, createMessagePortEndpoint } from "iframebuffer";

const { port1, port2 } = new MessageChannel();
// Send port2 to the other side (e.g. iframe.contentWindow.postMessage)

const channel = createChannel(createMessagePortEndpoint(port1));
await channel.capabilityReady;

const stream = createLowLevelStream(channel);
await stream.send(new Uint8Array([1, 2, 3]).buffer, []);
stream.close();
```

```ts
// responder.ts
import { createChannel, createMessagePortEndpoint } from "iframebuffer";
import type { StreamHandle } from "iframebuffer";

const channel = createChannel(createMessagePortEndpoint(port2));

channel.onStream(({ session }) => {
  // Use session directly or wrap with createLowLevelStream for the responder side
  session.onChunk((chunk) => {
    console.log("chunk received", chunk);
  });
});
```

## See also

- [Emitter API](emitter.md) — Node-style `stream.on('data', ...)` / `stream.write()`
- [Streams API](streams.md) — WHATWG `{ readable, writable }` pair with `pipeTo` support
- [Topology](../topology.md) — relay bridge, multiplex
