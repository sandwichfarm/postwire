# Example 02: Main thread streams to Worker

Demonstrates the EventEmitter API streaming structured data from the main thread to a Worker. The worker counts received frames and reports the delivery rate back via `postMessage`.

## Run

```sh
pnpm install
pnpm dev
```

Open the URL printed by Vite and click **Start stream**.

## What it shows

- `createEmitterStream` with `role: 'initiator'` (main) and `role: 'responder'` (worker)
- `write(chunk)` return value for backpressure detection
- `drain` event for resuming after credit exhaustion
- Worker reporting metrics back via native `postMessage`
