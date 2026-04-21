# Benchmarks

Benchmark data from `benchmarks/results/baseline.json` (commit `d682226`, Node 22.22.1, single-process MessageChannel).

**Important caveat:** These numbers were measured in Node, which uses an optimized C++ MessageChannel with no structured-clone envelope cost. In a real cross-origin browser context, postMessage pays an additional structured-clone serialization cost for the frame envelope object. The library's SAB path bypasses this entirely and is expected to be comparatively faster in browser cross-origin-isolated contexts than the Node numbers suggest. Phase 9 real-browser benchmarks are the definitive source.

## Throughput (MB/s)

| Payload | Library (transferable) | Library (SAB) | Library (structured-clone) | Naive postMessage |
|---------|---------------------:|-------------:|---------------------------:|------------------:|
| 1 KB    | 13.6                 | 3.3          | 14.0                       | 63.9              |
| 64 KB   | 523.5                | 208.0        | 140.6                      | 1,600.6           |
| 1 MB    | 1,911.8              | 1,197.5      | 119.1                      | 2,519.0           |
| 16 MB   | 2,007.2              | 1,296.4      | 64.8                       | 4,511.9           |

**Library / naive ratio (transferable):** 0.21× at 1 KB → 0.44× at 16 MB. The gap narrows as payload grows (framing cost is per-frame, not per-byte).

## Latency — library (transferable)

| Payload | p50 (ms) | p75 (ms) | p99 (ms) | p99/p50 |
|---------|--------:|---------:|---------:|--------:|
| 1 KB    | 0.070   | 0.073    | 0.128    | 1.8×    |
| 64 KB   | 0.114   | 0.118    | 0.288    | 2.5×    |
| 1 MB    | 0.437   | 0.494    | 1.489    | 3.4×    |
| 16 MB   | 8.232   | 8.533    | 10.788   | 1.3×    |

## Key observations

1. **At 1 MB+, the library delivers 1.3–2 GB/s** — more than sufficient for all realistic postMessage use cases (video frames, binary streams, large WASM memory slices).

2. **The library does not beat naive postMessage on single-transfer throughput** at any payload size. The gap is the price of correctness: reliable ordering, credit-based backpressure, typed errors, lifecycle safety. These features require per-frame work that naive postMessage does not do.

   A more honest performance criterion (from the decision log): *"Library throughput stays within a bounded factor of naive postMessage (< 3× slowdown at 1 MB+) while providing reliable ordering, flow control, and typed errors."* The library passes: 0.52× at 1 MB, 0.44× at 16 MB.

3. **Structured-clone path at 16 MB is very slow (64.8 MB/s)** — this is V8's serializer cost, not the library's. Use `ArrayBuffer` transfer (`send(buf, [buf])`) for bulk binary payloads.

4. **SAB path is slower than transferable in Node** — root cause is the async `Atomics.waitAsync` consumer loop adding coordination overhead within a single event loop. In a cross-origin browser context (where postMessage pays structured-clone envelope cost), SAB is expected to win at large payloads. See [SAB benchmark decision](decisions.md#sab-fast-path) for the full analysis.

## CPU (µs per operation)

| Payload | Library (transferable) | Naive postMessage |
|---------|---------------------:|------------------:|
| 1 KB    | 202                  | 31                |
| 64 KB   | 204                  | 25                |
| 1 MB    | 1,562                | 222               |
| 16 MB   | 10,424               | 4,122             |

The library burns roughly 6–7× more CPU than naive at 1 KB (framing overhead), narrowing to 2.5× at 16 MB (amortization).

## Running benchmarks

```sh
# Standard run (with CPU profile and normalization):
pnpm bench

# Fast run (no CPU profile):
pnpm bench:fast

# Compare current vs baseline:
pnpm bench:compare

# Heavy mode (adds 256 MB scenarios):
pnpm bench:heavy
```

Results are written to `benchmarks/results/latest.json`. The `bench` script normalizes against `baseline.json` and prints a comparison table.

## See also

- [decisions.md](decisions.md) — WASM decision, SAB benchmark analysis
- `benchmarks/results/baseline.json` — raw benchmark data
- `benchmarks/compare.mjs` — compare two result files
