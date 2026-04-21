# Example 04: Multiplex — two streams, one channel

Two concurrent logical streams share a single `MessageChannel`: one carries binary "file" chunks, the other carries structured-clone "control" messages. Both run simultaneously with independent credit windows.

## Run

```sh
pnpm install
pnpm dev
```

Open the URL and click **Start**. The log shows interleaved file and control messages arriving concurrently.

## What it shows

- `createChannel(endpoint, { multiplex: true })` on both sides
- `channel.capabilities.multiplex` after handshake (true when both sides opted in)
- `createLowLevelStream` + `createEmitterStream` opening two streams over the same channel
- Per-stream credit isolation: a stalled file stream does not block control messages
