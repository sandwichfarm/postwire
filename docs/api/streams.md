# WHATWG Streams API

`createStream(channel, options?)` returns a `{ readable, writable }` pair backed by a single stream session. Use it when you want native WHATWG Streams semantics — `pipeTo`, `pipeThrough`, backpressure via `desiredSize`, and natural integration with the Fetch API and compression streams.

## Import

```ts
import { createChannel, createStream, createWorkerEndpoint } from "iframebuffer";
```

## Signature

```ts
function createStream(
  channel: Channel,
  options?: StreamsOptions
): StreamsPair;

interface StreamsOptions {
  /** Session options forwarded to channel.openStream(). */
  sessionOptions?: Partial<SessionOptions>;
}

interface StreamsPair {
  readable: ReadableStream<unknown>;
  writable: WritableStream<unknown>;
}
```

## Backpressure

The WHATWG `desiredSize` signal is wired to the credit window:

- `WritableStream` has `highWaterMark = initialCredit` (default: 16 chunks). Once 16 writes are queued, `writer.ready` pends until the session drains the credit window.
- `ReadableStream` uses `highWaterMark: 0` — `pull()` is called only when the reader is actively waiting, so the credit window is the sole backpressure gate on the inbound side.

This means `pipeTo` and `pipeThrough` apply real end-to-end backpressure — a slow consumer automatically pauses the producer across the postMessage boundary.

## Two-party example

```ts
// sender.ts (initiator)
import { createChannel, createStream, createMessagePortEndpoint } from "iframebuffer";

const { port1, port2 } = new MessageChannel();
// Send port2 to the receiver side

const channel = createChannel(createMessagePortEndpoint(port1));
await channel.capabilityReady;

const { writable } = createStream(channel);
const writer = writable.getWriter();

await writer.write({ frame: 1, data: "hello" });
await writer.write({ frame: 2, data: "world" });
await writer.close();
```

```ts
// receiver.ts (responder)
import { createChannel, createStream, createMessagePortEndpoint } from "iframebuffer";

const channel = createChannel(createMessagePortEndpoint(port2), { role: "responder" });

channel.onStream(() => {
  const { readable } = createStream(channel);

  readable.pipeTo(new WritableStream({
    write(chunk) {
      console.log("received:", chunk);
    },
    close() {
      console.log("stream closed");
    }
  }));
});
```

## Binary transfer

For zero-copy binary delivery, use the low-level API's `send(buf, [buf])` pattern instead. `createStream` uses structured-clone by default. For bulk binary transfers, wrap a `TypedArray` or `ArrayBuffer` in an object, or use `createLowLevelStream` with the `transfer` argument.

## pipeTo example (file download)

```ts
// Sender: pipe a Response body through the stream to the receiver
const response = await fetch("/large-file.bin");

const { port1, port2 } = new MessageChannel();
iframe.contentWindow.postMessage({ type: "PORT" }, origin, [port2]);

const channel = createChannel(createMessagePortEndpoint(port1));
await channel.capabilityReady;

const { writable } = createStream(channel);
await response.body.pipeTo(writable);
```

```ts
// Receiver (inside iframe): collect chunks
channel.onStream(() => {
  const { readable } = createStream(channel);
  const chunks: Uint8Array[] = [];
  readable.pipeTo(new WritableStream({
    write(chunk) { chunks.push(chunk as Uint8Array); },
    close() {
      const blob = new Blob(chunks);
      displayResult(blob);
    }
  }));
});
```

## Error handling

When the session fails (e.g. `CREDIT_DEADLOCK`, `CHANNEL_DEAD`), the `readable` controller is errored and `writable.write()` rejects with a `StreamError`. Both sides surface the same typed error.

```ts
try {
  await writer.write(chunk);
} catch (err) {
  if (err instanceof StreamError) {
    console.error("stream failed:", err.code);
  }
}
```

## See also

- [Low-level API](lowlevel.md) — `send/onChunk/close` primitive (use for binary transfer)
- [Emitter API](emitter.md) — Node-style EventEmitter wrapper
- [Topology](../topology.md) — relay, multiplex
- [Errors](../errors.md) — all `StreamError.code` values
