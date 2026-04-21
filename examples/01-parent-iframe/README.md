# Example 01: Parent sends 1 MB to iframe

Demonstrates the low-level API transferring a 1 MB payload from the parent page to a sandboxed iframe in 64 KB chunks via a `MessageChannel`. A progress bar tracks delivery.

## Run

```sh
pnpm install
pnpm dev
```

Then open the URL printed by Vite (usually `http://localhost:5173`) and click **Send 1 MB**.

## What it shows

- Bootstrapping a `MessageChannel` and handing one port to the iframe via `postMessage`
- `createLowLevelStream` with binary transfer (`send(buf, [buf])`) for zero-copy chunk delivery
- Responder side using `channel.onStream()` to receive the stream
- Chunk-level progress tracking in the parent
