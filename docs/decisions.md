# Architecture Decision Log

Key architecture and protocol decisions with benchmark or research evidence.

## WASM Gate (Phase 5)

**Decision:** Defer WASM — the JS transferable path is fast enough for v1.

At 16 MB the library achieves 1.8–2 GB/s, which is approximately 45–65% of naive postMessage throughput. The gap is a fixed per-frame framing cost, not a GC or channel bottleneck. WASM would reduce allocation overhead in a path where allocations are not the dominant cost. The expected ROI is low.

Trigger conditions to revisit: Phase 9 real-browser benchmarks show library/naive < 0.3× at 16 MB, or a real consumer reports a concrete throughput shortfall.

Full analysis: [`.planning/decisions/05-wasm-decision.md`](../.planning/decisions/05-wasm-decision.md)

---

## SAB Fast Path (Phase 6)

**Decision:** Ship SAB as an opt-in feature; it is slower than transferable in Node but expected to win in cross-origin-isolated browser contexts.

In Node's single-process MessageChannel, the SAB ring buffer path is 1.4×–4.9× *slower* than the transferable path depending on payload size. Root causes: per-iteration channel setup overhead, async `Atomics.waitAsync` coordination adding latency within a single event loop, and credit frames still traveling via postMessage.

In a real browser with COOP/COEP headers, postMessage pays structured-clone serialization cost for the frame envelope object. The SAB path bypasses this entirely. SAB is expected to be competitively faster in that environment, especially at 16 MB+ payloads. Phase 9 real-browser benchmarks are the definitive data point.

Full analysis: [`.planning/decisions/06-sab-benchmark.md`](../.planning/decisions/06-sab-benchmark.md)

---

## Protocol version in CAPABILITY frame (Phase 1)

`CAPABILITY` frames carry a `protocolVersion` field. On mismatch, the channel immediately emits `PROTOCOL_MISMATCH` rather than silently mishandling frames. This makes cross-version bugs immediately visible instead of producing corrupt output.

---

## Reorder buffer + credit window together (Phase 2)

Both are required for correct stream delivery. Credits without a reorder buffer would allow frames to be consumed out of order. A reorder buffer without credits would allow unbounded buffering. Together they provide: (a) ordered delivery, (b) bounded memory, (c) back-pressure from consumer to producer.

---

## Transferable ArrayBuffer as first-class path (Phase 3)

Binary payloads sent with `send(buf, [buf])` detach the source buffer — zero-copy semantics. The library validates the transfer list is non-empty before selecting `BINARY_TRANSFER` as the chunk type. This is the recommended path for bulk binary data.

---

## Relay at raw-frame level, not pipeTo (Phase 7)

The relay bridge forwards frames without reassembly. Using `pipeTo` across a postMessage boundary does not propagate backpressure through the credit window — it builds an unbounded intermediate queue. The relay implementation intercepts raw `DATA` frames and forwards credits from downstream to upstream. This bounds relay memory to `downstreamCreditWindow × maxChunkSize`.

---

## Multiplex ID allocation: odd/even split (Phase 8)

Initiator allocates odd stream IDs (1, 3, 5, …); responder allocates even IDs (2, 4, 6, …). This mirrors HTTP/2's stream ID rules and avoids collision without a per-stream coordination round-trip. Both sides independently arrive at non-overlapping ID spaces.

---

## Wildcard `targetOrigin` refused (Phase 1)

`createWindowEndpoint` requires an explicit non-wildcard `expectedOrigin`. A wildcard allows any origin's message to be decoded as a library frame — supply-chain attacks via injected postMessage calls become trivially possible. The restriction is enforced at the type level (TypeScript error) and at runtime (throws on `"*"`).

---

## See also

- [Benchmarks](benchmarks.md) — throughput and latency data
- [Security](security.md) — origin validation, CSP
- [Errors](errors.md) — all typed error codes
