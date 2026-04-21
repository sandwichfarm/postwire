# Emitter Stream API

`createEmitterStream(channel, options?)` wraps the session in a Node-style EventEmitter interface. Use it when you want familiar `stream.on('data', ...)` / `stream.write()` semantics without reaching for WHATWG Streams.

## Import

```ts
import { createChannel, createEmitterStream, createWorkerEndpoint } from "iframebuffer";
```

## Signature

```ts
function createEmitterStream(
  channel: Channel,
  options?: EmitterOptions
): EmitterStream;

interface EmitterOptions {
  /**
   * 'initiator' (default): calls channel.openStream() immediately.
   * 'responder': waits for the remote OPEN frame.
   */
  role?: "initiator" | "responder";
}

interface EmitterStream {
  on(event: "data",  handler: (chunk: unknown)      => void): this;
  on(event: "end",   handler: ()                     => void): this;
  on(event: "error", handler: (err: StreamError)     => void): this;
  on(event: "close", handler: ()                     => void): this;
  on(event: "drain", handler: ()                     => void): this;
  off(event, handler): this;
  once(event, handler): this;
  removeAllListeners(): void;
  write(chunk: unknown): boolean;
  end(): void;
}
```

## Events

| Event | When it fires |
|-------|---------------|
| `data` | Each reassembled inbound chunk arrives |
| `end` | Stream closed gracefully (`end()` called locally) |
| `error` | Stream failed with a `StreamError` |
| `close` | Stream fully shut down (after `end` or `error`) |
| `drain` | Send credit window refilled after being exhausted |

## write(chunk)

Sends a chunk to the remote side using structured-clone encoding.

Returns `true` if more data can be written immediately (send credits available). Returns `false` if the credit window is exhausted (wait for the `drain` event before writing more).

```ts
const ok = stream.write({ event: "frame", n: 42 });
if (!ok) {
  stream.once("drain", () => {
    stream.write(nextChunk);
  });
}
```

## end()

Gracefully closes the stream. Emits `end`, then `close`, then calls `removeAllListeners()` to prevent listener leaks.

## Two-party example

```ts
// initiator.ts
import { createChannel, createEmitterStream, createMessagePortEndpoint } from "iframebuffer";

const { port1, port2 } = new MessageChannel();
// Send port2 to the other side

const channel = createChannel(createMessagePortEndpoint(port1));
const stream = createEmitterStream(channel); // role: 'initiator' by default

stream.on("drain", () => stream.write(nextChunk));

let ok = stream.write({ type: "start" });
if (ok) stream.write({ type: "end" });

stream.end();
```

```ts
// responder.ts
import { createChannel, createEmitterStream, createMessagePortEndpoint } from "iframebuffer";

const channel = createChannel(createMessagePortEndpoint(port2));
const stream = createEmitterStream(channel, { role: "responder" });

stream.on("data", (chunk) => {
  console.log("received", chunk);
});

stream.on("error", (err) => {
  console.error("stream error:", err.code);
});
```

## Backpressure pattern

```ts
const chunks = getLargeDataSet(); // array of structured-clone values

function sendNext() {
  while (chunks.length > 0) {
    const ok = stream.write(chunks.shift());
    if (!ok) {
      // Credit window exhausted — wait for drain
      stream.once("drain", sendNext);
      return;
    }
  }
  stream.end();
}

sendNext();
```

## See also

- [Low-level API](lowlevel.md) — `send/onChunk/close` primitive
- [Streams API](streams.md) — WHATWG `{ readable, writable }` pair
- [Errors](../errors.md) — all `StreamError.code` values
