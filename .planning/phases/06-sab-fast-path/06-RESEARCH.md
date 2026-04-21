# Phase 6 Research — SAB Fast Path

**Written:** 2026-04-21 (inline, no agent)
**Scope:** FAST-04

## Exact ring-buffer byte layout

```
Offset  | Field     | Type      | Semantics
--------|-----------|-----------|-----------------------------------------
0       | head      | Int32     | Producer write position (monotonic)
4       | tail      | Int32     | Consumer read position (monotonic)
8       | flags     | Int32     | bit 0 = closed
12      | capacity  | Int32     | Payload capacity in bytes (const)
16..63  | reserved  | Int32[12] | Future use (zeroed)
64..N   | payload   | Uint8     | Ring buffer bytes
```

`Int32Array(sab, 0, 16)` views the header. `Uint8Array(sab, 64, capacity)` views the payload.

`head` and `tail` are monotonically-increasing 32-bit counters (they wrap naturally on overflow — same arithmetic as `src/transport/seq.ts`). Position in the buffer is `(head | tail) % capacity`.

- **Empty**: `head === tail`
- **Full**: `head - tail === capacity` (modular compare via existing `seqLT` helper)
- **Available to write**: `capacity - (head - tail)`
- **Available to read**: `head - tail`

## Frame format in the ring

Each frame slot:
```
[u32 length][u32 seq][u32 chunkType][payload bytes...]
```
- `length=0` is the terminator (signals "channel closed" to consumer)
- `chunkType` = 0 BINARY_TRANSFER, 1 STRUCTURED_CLONE, etc. (matches `src/framing/types.ts` order)
- Frames never span the wrap — if a frame wouldn't fit before the end of the ring, producer writes a padding marker (`length=0xFFFFFFFF`) and restarts at offset 0

## Atomics + waitAsync

- **Producer**: advance `head` via `Atomics.store`, then `Atomics.notify(int32, 1, 1)` on slot 1 (tail-notifier) — wakes consumer if it was waiting
- **Consumer**: `Atomics.waitAsync(int32, 0, oldHead)` blocks until `head` changes — returns a Promise
- **Producer blocks on full**: `Atomics.waitAsync(int32, 1, oldTail)` until consumer advances tail

Availability: Node 22 (yes), Chrome 97+ (Jan 2022), Firefox 91+ (Aug 2021), Safari 16.4+ (Mar 2023). All qualify as evergreen — hard dependency.

Probe: `typeof Atomics.waitAsync === 'function'` (cheap, sync).

## Capability probe

```ts
export function isSabCapable(endpoint: PostMessageEndpoint): boolean {
  if (typeof SharedArrayBuffer === 'undefined') return false;
  if (typeof Atomics === 'undefined' || typeof Atomics.waitAsync !== 'function') return false;
  // Browser: cross-origin isolation required; Node always isolated
  if (typeof globalThis.crossOriginIsolated !== 'undefined' && globalThis.crossOriginIsolated !== true) return false;
  // Endpoint-declared incapability (ServiceWorker sets this false in Phase 1)
  const caps = (endpoint as { capabilities?: { sabCapable?: boolean } }).capabilities;
  if (caps?.sabCapable === false) return false;
  return true;
}
```

## CAPABILITY frame extension

Phase 3's CAPABILITY frame already carries `sab: boolean` via `BaseFrame.capabilities`. Phase 6 uses this plus a new follow-up `SAB_INIT` mini-frame (piggybacked on the first DATA frame OR via a synthetic CAPABILITY-refresh) carrying the `SharedArrayBuffer` handle in the postMessage transfer list.

**Decision:** send the SAB handle via a SECOND postMessage right after the CAPABILITY handshake completes — a `{ type: 'SAB_INIT', sab: SharedArrayBuffer }` control message not part of the frame protocol. The receiving Channel sets up its consumer side. If this init fails (peer rejects, receiving side's probe fails mid-handshake), the sending side rolls back to postMessage path.

This keeps the wire protocol unchanged while allowing the SAB handshake to ride on a side channel.

## Activation policy

Both conditions must hold:
1. `channel.options.sab === true` (caller opt-in)
2. Both sides' `isSabCapable()` returned true (negotiated via CAPABILITY)

If either fails, Channel silently uses the Phase 3 postMessage path. No error, no log unless `trace` is on.

## Fallback correctness

- The Channel keeps the postMessage path alive for control frames (OPEN, CREDIT, CLOSE, etc.) even when SAB is active.
- If a DATA write to SAB blocks via `Atomics.waitAsync` and the peer is dead, the wait times out at 30 s (configurable) and the channel emits `CHANNEL_DEAD` — same code path as heartbeat (Phase 4).
- Closing the channel writes a terminator (`length=0`) to the ring and calls `Atomics.notify` so the consumer wakes and exits cleanly.

## Unit tests

Pure Node, no worker_threads needed:
- `src/transport/sab-ring.test.ts`:
  - insert + read preserves byte order
  - wrap-around works (write past capacity, read wraps back to 0)
  - `length=0` terminator causes consumer to exit
  - capacity-full blocks producer (use `Atomics.waitAsync` with short timeout)
  - capacity-empty blocks consumer similarly
  - fuzz test: random producer/consumer schedule, assert all bytes delivered in order

## Integration test

Node `worker_threads` Worker + main thread:
- Main thread creates SAB, spawns Worker with the SAB handle
- Worker runs the consumer side of a Channel with SAB path enabled
- Main thread runs the producer side
- Send 10 MB of data; assert received bytes match
- `tests/integration/sab-channel.test.ts`

## Fallback test

- Force `isSabCapable()` to return `false` on one side via a test-only hook
- Verify `CAPABILITY` negotiates `sab: false` on both sides
- Full stream completes via postMessage path
- `tests/integration/sab-fallback.test.ts`

## Benchmark scenario

`benchmarks/scenarios/sab-transfer.bench.ts` — mirrors binary-transfer.bench.ts but forces SAB path. Same size matrix (1 KB, 64 KB, 1 MB, 16 MB). Results land in `baseline.json` as additional scenarios.

## Expected outcomes

Based on Phase 5 data (library transferable at 1.84 GB/s at 16 MB), SAB should push throughput higher — no structured-clone wrap, no postMessage queue latency. Target: 3–5 GB/s for binary at 16 MB. If it doesn't beat transferable, that's a surprise worth documenting in a new `.planning/decisions/06-sab-benchmark.md`.

## Risks

| Risk | Mitigation |
|------|-----------|
| `Atomics.waitAsync` unavailable in some runtime | Probe at startup, fallback to postMessage |
| Cross-agent-cluster SAB rejection (ServiceWorker, cross-origin iframe) | `sabCapable: false` set at adapter layer; probe catches it |
| SAB buffer deadlock (producer waiting on full, consumer dead) | Timeout on waitAsync → CHANNEL_DEAD (same as heartbeat) |
| Frame wrap across buffer boundary | Padding marker (`length=0xFFFFFFFF`) forces producer to restart at 0 |
| Race between CAPABILITY and SAB_INIT control | Sequence: CAPABILITY first, SAB_INIT after CAPABILITY completes, first DATA only after SAB_INIT acknowledged |

## Validation Architecture

**Unit tests (pure Node):**
- `src/transport/sab-ring.test.ts` — ring buffer correctness (insert, read, wrap, terminator, capacity limits)
- `src/transport/sab-capability.test.ts` — probe behavior under various mocked environments

**Integration tests (Node worker_threads):**
- `tests/integration/sab-channel.test.ts` — two-Channel end-to-end over SAB, 10 MB binary
- `tests/integration/sab-fallback.test.ts` — one side probe-returns-false, postMessage fallback works

**Benchmark:**
- `benchmarks/scenarios/sab-transfer.bench.ts` — SAB path vs transferable path, 4 sizes
- Results merged into `baseline.json` via existing normalize.mjs

**Real-browser COOP/COEP test:** deferred to Phase 9 (fixture server with correct headers + Playwright test)

## Coverage targets

- Ring buffer: 100% branch on the wrap-and-terminator paths
- Capability probe: every fail condition triggers a case
- Channel SAB wiring: activation AND fallback both covered in integration
