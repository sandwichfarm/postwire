# Example 03: Three-hop relay

Worker → Main thread relay → Iframe consumer. The main thread uses `createRelayBridge` to forward frames without reassembly. Credits propagate end-to-end.

## Run

```sh
pnpm install
pnpm dev
```

Open the URL and click **Start**. The chunk counter increments as the iframe receives data.

## What it shows

- `createRelayBridge(upstreamChannel, downstreamChannel)` — raw-frame forwarding
- Three-hop topology: worker produces, main relays, iframe consumes
- End-to-end credit propagation (relay does not buffer unboundedly)
- Sandboxed iframe receiving data via a handed-in `MessagePort`
