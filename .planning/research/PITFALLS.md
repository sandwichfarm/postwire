# Pitfalls Research

**Domain:** High-throughput postMessage streaming library (TypeScript, browser-only, zero runtime deps)
**Researched:** 2026-04-21
**Confidence:** HIGH — all critical pitfalls verified against official specs, MDN, or real browser bug trackers; MEDIUM for benchmarking and packaging sections (fewer hard primary sources)

---

## Critical Pitfalls

### Pitfall 1: DataCloneError from Uncloneable Types Silently Drops Stream Frames

**Priority:** CRITICAL — causes silent data loss or uncatchable exception

**What goes wrong:**
The caller enqueues a chunk containing a Function, a DOM Node, a class instance with private fields, or any non-cloneable type. `postMessage` throws a `DataCloneError` synchronously before the frame hits the wire. If the Transport layer does not catch this specifically, the stream silently stops producing data while appearing OPEN — the sender thinks it sent the chunk, the receiver never gets it. This is worse than an error; it is a silent gap.

**Why it happens:**
The WHATWG structured clone algorithm rejects Functions, DOM Nodes, Error objects with certain non-standard properties, and class instances whose prototype chain is not reconstructed. Developers reaching for the EventEmitter or WHATWG Streams surface of this library may write `stream.write({ handler: myCallback })` not realising they are embedding a function in the chunk. The error fires at the `postMessage` call site deep inside the Transport layer, not at the `write()` call site, so the stack trace is misleading.

Additionally: TypedArrays backed by a SharedArrayBuffer cannot be structured-cloned via regular postMessage into a different agent cluster (throws `DataCloneError: SharedArrayBuffer transfer requires self.crossOriginIsolated`). A caller who passes a `Uint8Array` view onto a SAB into a stream targeting a sandboxed iframe will hit this silently.

**How to avoid:**
- Transport layer must wrap every `postMessage` call in a try/catch. On `DataCloneError`: emit a `RESET` frame with `reason: 'serialize-failed'` if the port is still live, then transition the StreamSession to `ERRORED`.
- Expose the error reason to the caller's WritableStream as an abort with the original `DataCloneError` as the cause — never swallow it.
- In DEBUG mode, log the chunk type before sending: `console.debug('[ibf] chunk type:', typeof chunk, chunk?.constructor?.name)`.
- Document the serializable-type constraint at every `write()` / `send()` call site in the public API docs with explicit examples of what fails.
- In the framing layer's `encode()`, add a dev-only runtime check that attempts `structuredClone(payload)` (Node 17+/browser native) and throws a helpful error if it fails, before even reaching `postMessage`. This converts a misleading internal error into a clear caller-side error at the correct call site.

**Warning signs:**
- Stream goes quiet mid-transfer; receiver never sees `CLOSE` frame.
- Browser console shows `DataCloneError: Failed to execute 'postMessage'` with a Transport-layer stack frame, not a caller-layer frame.
- Unit tests pass (jsdom/happy-dom do not enforce structured-clone restrictions fully) but E2E Playwright tests fail.

**Phase to address:** Phase 1 (Transport layer) — transport/index.ts must catch DataCloneError before any stream session logic is written. Also: Phase 5 (API adapters) — add runtime type check in DEBUG mode at write() call site.

---

### Pitfall 2: Accessing a Detached ArrayBuffer After Transfer

**Priority:** CRITICAL — causes `TypeError: Cannot perform %TypedArray%.prototype.get on a detached ArrayBuffer` silently or crashing

**What goes wrong:**
Once an `ArrayBuffer` is included in a `postMessage` transferList, the original `ArrayBuffer` becomes detached: `byteLength` returns 0, any read/write throws `TypeError`. Code that holds a reference to the original buffer and accesses it after transfer — for checksums, logging, retransmission, or chunking the next fragment from the same base buffer — will crash or read zeros.

Specific failure modes:
1. **Double-transfer**: The chunker slices a large `ArrayBuffer` into views but the base buffer is transferred with the first chunk. Subsequent chunks from the same base throw `DataCloneError: ArrayBuffer at index 0 is already detached`.
2. **Post-send logging**: A debug/metrics path that logs `chunk.byteLength` after the `postMessage` call reads 0 instead of the actual size, corrupting throughput metrics silently.
3. **Retry on error**: Any reconnect/retry path that re-sends the same buffer object will fail because it is now detached.

**Why it happens:**
Transfer ownership is a hard move, not a copy. The source `ArrayBuffer` becomes a zero-byte detached object immediately after the `postMessage` call returns. Most JavaScript patterns assume data is readable after you have "sent" it — the transfer semantic is unusual enough that it catches even experienced developers.

**How to avoid:**
- The chunker must record chunk sizes and metadata **before** the `postMessage` call, not after.
- Log/metrics paths must record `byteLength` into a local variable **before** appending the buffer to the transferList.
- The Transfer path must never reuse the same `ArrayBuffer` instance for a second transfer. After slicing a large buffer into chunks: either (a) use `subarray()` + `buffer.slice()` per chunk (which copies, not shares), or (b) use a single large buffer and transfer it once, constructing the frame header separately. Choice (b) is faster.
- Add a design rule: the only thing that happens after `endpoint.postMessage(msg, transfer)` returns is return/await. No reads, no logs from the transferred objects.
- In CI: write a test that reads `buffer.byteLength` after transfer and asserts it is 0, proving the rest of the code does not depend on post-transfer reads.

**Warning signs:**
- `TypeError: Cannot perform %TypedArray%.prototype.get on a detached ArrayBuffer` in Transport layer.
- `DataCloneError: ArrayBuffer at index 0 is already detached` on the second chunk of a large transfer.
- Throughput metrics report 0 bytes/s despite frames appearing to send.

**Phase to address:** Phase 1 (Transport fast-path path), Phase 3 (session/chunker.ts) — chunker must be designed around this constraint. Add an explicit test in Phase 1 before chunker is written.

---

### Pitfall 3: Credit Window Deadlock — Zero Credits, No Reader

**Priority:** CRITICAL — permanently stalls stream with no error or timeout

**What goes wrong:**
The producer exhausts its credit window (`creditsRemaining === 0`) and blocks. The consumer's `CREDIT` frame is only sent when its reorder buffer drains below the high-water mark. If no reader is consuming from the ReadableStream on the receiver side (e.g., the caller opened the stream but forgot to pipe or read it), the buffer never drains, credits are never issued, and the sender waits forever. No error is raised; the stream appears open.

A second variant: the relay pattern. The relay only forwards upstream `CREDIT` frames equal to what the downstream has granted. If the downstream iframe's ReadableStream has no consumer, the relay gets 0 credits from downstream, the relay never issues credits upstream, and the worker producer is permanently stalled. Three hops; one unread ReadableStream at the end; complete deadlock.

**Why it happens:**
WHATWG Streams `ReadableStreamDefaultController.desiredSize` goes negative when the internal queue is full, but `desiredSize <= 0` does not prevent further `enqueue()` calls — it is advisory. The library correctly stops at the credit boundary, but that boundary depends on the receiver actively draining its queue. Any consumer that "opens a stream and forgets it" creates a deadlock.

**How to avoid:**
- Add a `maxBufferedChunks` high-water mark on the StreamSession reorder buffer (not just the WHATWG Streams HWM). When the reorder buffer reaches the limit and no consumer has read in N milliseconds (configurable, default 5000ms), emit a `RESET` with `reason: 'consumer-stall'`. Surface this as a `ReadableStream` error.
- In DEBUG mode, log a warning at 2000ms of stall: `[iframebuffer] stream ${id} has not been read in 2s — ensure you are consuming the ReadableStream`.
- Document in every example: "You must consume the ReadableStream or the sender will stall."
- The relay's initial `initCredit` in `OPEN_ACK` toward the upstream must be 0 until the downstream `OPEN_ACK` arrives. The relay MUST NOT issue any upstream credits before it receives downstream credits.

**Warning signs:**
- `writer.ready` promise never resolves.
- Stream never errors but never delivers chunks.
- In DEBUG mode: no `CREDIT` frames logged after initial `initCredit` is exhausted.
- Heap profiler shows reorder buffer growing to fixed size then stopping.

**Phase to address:** Phase 3 (credit-window.ts must include stall detection timer), Phase 4 (StreamSession FSM must handle stall timeout transition), Phase 6 (relay must enforce zero-upstream-credits-before-downstream-ack rule).

---

### Pitfall 4: WHATWG Streams `controller.enqueue()` Does Not Enforce Backpressure

**Priority:** CRITICAL — can cause unbounded memory growth and OOM, silent data corruption

**What goes wrong:**
`ReadableStreamDefaultController.enqueue()` always succeeds regardless of `desiredSize`. Calling it when `desiredSize <= 0` does not throw, does not block, and does not drop the chunk — it silently grows the internal queue without bound. A push-source that calls `enqueue()` in a tight loop based on incoming `DATA` frames (rather than respecting the credit window) will exhaust memory before the consumer catches up.

The specific failure mode for this library: if the receive path calls `controller.enqueue(chunk)` for every arriving `DATA` frame without first checking whether the credit window has been honoured, the memory usage of the receiving context will grow proportionally to the sender's speed. In a worker → main thread scenario, this OOMs the tab.

**Why it happens:**
The WHATWG Streams spec makes `desiredSize` advisory: it is the source's responsibility to pause, not the stream's. Most tutorial code shows simple `enqueue()` loops that never check `desiredSize`. The credit-based protocol is the correct remedy — but only if the receive path correctly ties credit issuance to actual queue drainage, not to frame arrival.

**How to avoid:**
- The receive path (session/index.ts receive handler) must NEVER call `controller.enqueue()` for a frame it received beyond the credit window. The credit window is the correct gate — a `DATA` frame arriving when `receivedBeyondWindow > 0` indicates a bug in the sender (sent without credits). Treat this as a protocol error: send `RESET` with `reason: 'credit-overrun'`, do not enqueue.
- Credits MUST be issued based on queue drainage, not on frame arrival. Specifically: issue a `CREDIT` frame when the WHATWG Streams consumer has called `read()` (or `pipeTo` has pulled) and the reorder buffer has drained below 50% of HWM.
- Wire `ReadableStreamDefaultController.desiredSize` to the credit window: when `desiredSize <= 0`, stop issuing new credits; when `desiredSize > 0`, issue credits equal to `Math.floor(desiredSize / chunkSize)`.
- Write a test: sender sends 10,000 DATA frames at full speed; receiver is a ReadableStream that reads 1 chunk/second. Assert that memory usage stays flat, not linear.

**Warning signs:**
- Tab memory usage climbs linearly as stream is active.
- `desiredSize` on the receiving ReadableStream is deeply negative (e.g., -500,000).
- `performance.memory.usedJSHeapSize` grows without GC'ing during a sustained stream.

**Phase to address:** Phase 3 (credit-window.ts — credit issuance must be tied to actual reads, not to arrival), Phase 5 (adapters/streams.ts — WHATWG Streams backpressure wiring is the highest-risk adapter).

---

### Pitfall 5: Origin Not Validated on Incoming `window.postMessage`

**Priority:** CRITICAL — enables cross-origin message injection, XSS escalation

**What goes wrong:**
The library sets `endpoint.onmessage = handler`. If the endpoint is a `Window` and the caller did not wrap it with origin validation, any cross-origin frame on the same page can inject crafted library frames (e.g., `{ __ibf_v1__: 1, type: 'OPEN', streamId: 999 }`) that open unauthorized streams or inject arbitrary data into an existing stream.

This is the most commonly exploited postMessage pattern. Microsoft's Security Response Center (MSRC, August 2025) documented real supply-chain attacks using exactly this vector on popular iframe-based integrations.

**Why it happens:**
`window.postMessage` is the only postMessage variant that receives messages from any origin unless filtered at the handler. `MessagePort.onmessage` only fires on messages sent to that specific port — origin is implicitly scoped by port ownership, so MessagePort is safe. But when callers use `Window` as the endpoint (cross-window/cross-iframe direct messaging), origin validation is the caller's responsibility and is frequently forgotten.

**How to avoid:**
- The `PostMessageEndpoint` interface does not include origin. This is correct — the library does not own the Window.
- In the Window adapter example (documented in examples, not in library code): ALWAYS show `if (event.origin !== expectedOrigin) return;` as the first line of the onmessage handler before passing to the library endpoint.
- Add a named export `createWindowEndpoint(win, expectedOrigin)` that wraps the Window in a validated adapter. This is 5 lines of code and eliminates the entire class of bugs. Mark it prominently in docs.
- Document: "The library does not validate `event.origin`. Use `MessagePort` (always safe) or `createWindowEndpoint(win, expectedOrigin)` for Window endpoints."
- The frame namespace marker (`__ibf_v1__: 1`) provides namespace isolation, but NOT origin security. A malicious iframe on the same page can craft the marker.

**Warning signs:**
- Unexpected `OPEN` frames arriving with stream IDs that don't correspond to any `openStream()` call.
- `event.origin` in onmessage does not match the expected embedding domain.
- Security audit flags `window.addEventListener('message', ...)` without an origin check — same class of bug.

**Phase to address:** Phase 1 (Transport layer + endpoint.ts) — add `createWindowEndpoint` wrapper. Phase 5 documentation — every Window example must show origin check. Never in the library's default receive path — the library does not know the expected origin.

---

### Pitfall 6: Relay with Unbounded Buffer (Streams Piping Anti-Pattern)

**Priority:** CRITICAL — OOM under sustained load; may not manifest in tests

**What goes wrong:**
Building the relay by piping a `ReadableStream` from Channel A into a `WritableStream` on Channel B using WHATWG Streams `pipeTo` or native `pipeThrough`. WHATWG Streams pipe does not propagate backpressure across a postMessage boundary — the `WritableStream` on the relay's Channel B side does not signal backpressure back through the postMessage channel to the worker producer. The relay's internal pipe buffer grows without bound.

This is the most common mistake in multi-hop streaming designs. The architecture research already identified this as Anti-Pattern 3, but it deserves explicit pitfall status because it is a correctness trap that:
- Works perfectly in tests (test producers run at controlled speed)
- Fails in production under sustained high-bitrate workloads
- Takes minutes to manifest (OOM crash, not immediate error)

**Why it happens:**
The mental model of "pipe A to B" is extremely natural. The flaw is invisible: WHATWG Streams backpressure only propagates synchronously within a single JS event loop. It cannot propagate across a `postMessage` call which requires an event loop hop. The relay's writable queue fills, signals backpressure to its local pipe... and that backpressure signal dies there, because the upstream producer is in a different context.

**How to avoid:**
- The relay MUST use the credit-forwarding protocol described in ARCHITECTURE.md: relay holds credits equal to what the downstream has granted, and only forwards those credits upstream. No WHATWG Streams piping inside the relay.
- Add a CI test: producer sends at 10× the consumer's read rate. Assert the relay's JS heap stays bounded (< 2× initCredit × chunkSize).
- The `RelayBridge` class must explicitly forbid construction via a `pipeTo` call. Internal code review rule: `RelayBridge` has zero uses of `.pipeTo` or `.pipeThrough`.

**Warning signs:**
- Relay context memory grows linearly during a sustained stream.
- Worker (producer) never pauses despite consumer being 10× slower.
- Test passes with artificial slow producer but fails in benchmark with real-speed producer.

**Phase to address:** Phase 6 (relay/index.ts) — this is the foundational design constraint of the relay. Must be documented as the first comment in relay/index.ts.

---

## High Priority Pitfalls

### Pitfall 7: BFCache "Zombie" Channel — Frozen Stream Restored With Stale State

**Priority:** HIGH — stalled stream with no error; very hard to reproduce in tests

**What goes wrong:**
The parent page navigates away, enters BFCache (browser stores a frozen snapshot), then the user navigates back. BFCache restores the page by unfreezing JS execution from where it stopped. Any `MessagePort` that was open survives the freeze. The worker on the other end of the port continued running, sent `DATA` frames and `CREDIT` frames while the page was frozen, and those messages queued in the browser's internal message queue. When the page unfreezes, all queued messages fire at once in a burst.

Problems:
1. The reorder buffer receives a burst of frames with advancing sequence numbers. If the burst exceeds the reorder buffer's max size, sequence gaps trigger a false `RESET`.
2. If the worker sent a `CLOSE` frame during the freeze, the stream is terminated by the worker but the page wakes up expecting to continue reading.
3. Any timer-based stall detection (Pitfall 3) fires during the freeze period and erroneously terminates the stream.

**Why it happens:**
BFCache freezes JS but does NOT close MessagePorts or terminate workers. Workers continue running. The frozen page queues messages but cannot process them. When restored, the page sees a backlog that looks like a burst with gaps.

**How to avoid:**
- Listen for `pagehide` with `event.persisted === true`. On this event: send a `RESET` with `reason: 'page-frozen'` to all active streams, transitioning them to `ERRORED`. The caller can then reconnect on `pageshow`.
- On `pageshow` with `event.persisted === true`: log a warning that all streams were terminated due to BFCache. Document this behavior explicitly.
- The stall detection timer must be suspended during BFCache freeze. Use `visibilitychange` (and `document.visibilityState === 'hidden'`) as a proxy for freeze — suspend timers when hidden, restart on visible.
- Add a Playwright BFCache simulation test: navigate away, navigate back, assert all streams are in `ERRORED` state with reason `'page-frozen'`, not silently stalled.
- To make the page eligible for BFCache at all: do NOT use the `unload` event. Use `pagehide` only. The `unload` event permanently disqualifies a page from BFCache in all browsers.

**Warning signs:**
- Streams work perfectly on first visit but silently stall after browser back-navigation.
- Test passes in Playwright without BFCache simulation but fails with `--bfcache` flag.
- `pageshow` event fires with `event.persisted === true` but no stream reset happened.

**Phase to address:** Phase 4 (StreamSession teardown), Phase 5 (context lifecycle detection module). BFCache handling belongs in the same module as worker-termination detection.

---

### Pitfall 8: Service Worker Recycled Mid-Stream — Silent Termination

**Priority:** HIGH — common in production, hard to reproduce in tests

**What goes wrong:**
Service workers are terminated by the browser after 30 seconds of inactivity (Chrome) and can be terminated at any time at browser discretion. An active stream where the service worker is one endpoint will be silently abandoned when the SW is terminated. The `MessagePort` to the SW becomes permanently dead. No `messageerror`, no `error` event, no close notification — the port just stops delivering messages.

This is NOT the same as a worker being `terminate()`d explicitly. Explicit termination closes the port and fires an error. Browser-initiated SW recycling silently stops the port without any notification.

**Why it happens:**
The service worker lifecycle is unlike DedicatedWorker or SharedWorker. The browser can reclaim a SW at any time when it is "idle" (no active fetch event, push event, or explicit `event.waitUntil()` keeping it alive). Any long-running stream that doesn't constantly trigger a SW lifecycle event will eventually be silently cut off.

**How to avoid:**
- For SW-endpoint streams, implement a heartbeat: sender sends a `PING` control frame (defined in the framing layer as a no-op) every 20 seconds. Receiver responds with `PONG`. If no `PONG` arrives within 10 seconds, the stream transitions to `ERRORED` with `reason: 'heartbeat-timeout'`.
- Document: "Service worker endpoints require heartbeat enabled (`{ heartbeat: true }`) or the browser may recycle the SW silently." Make heartbeat opt-in (not default) to avoid overhead on non-SW endpoints.
- The receiving side (page → SW direction) must call `navigator.serviceWorker.ready` before sending the first DATA frame. If `ready` resolves to a different SW instance than what was connected, the channel is stale — reconnect.
- In Playwright tests: note that SW tests are Chromium-only per STACK.md. Mock the SW endpoint as a regular Worker for Firefox/WebKit tests.

**Warning signs:**
- Stream works for the first 30 seconds then silently stalls.
- `navigator.serviceWorker.controller` returns `null` after inactivity, indicating the SW was recycled and no new one registered.
- `MessagePort.onmessage` never fires again after a period of no activity.

**Phase to address:** Phase 1 (Transport layer — heartbeat support), documented as a required option for SW endpoints. Also: context termination detection module (Phase 4).

---

### Pitfall 9: Sequence Number Wraparound in the Reorder Buffer

**Priority:** HIGH — silent data corruption after very long streams

**What goes wrong:**
If sequence numbers are 32-bit unsigned integers and the stream runs long enough to wrap around (4,294,967,296 frames × ~64KB chunks = ~281 TB of data before wraparound), the reorder buffer's comparison logic `seq > expected` will fail. A frame with `seq = 1` arriving after `seq = 0xFFFFFFFF` will be misclassified as "very far in the future" (gap detected) or "already delivered" (duplicate), causing a spurious `RESET`.

For 16-bit sequence numbers (65,536 frames × 64KB = ~4 GB of data), wraparound is reachable in under a minute at gigabyte-per-second throughput over a SAB fast path.

**Why it happens:**
Developers default to 32-bit integers as "large enough" without applying TCP-style modular arithmetic. TCP uses modular arithmetic for sequence comparison precisely because 32-bit wraps in ~34 minutes at 10 Gbps.

**How to avoid:**
- Use modular arithmetic for all sequence number comparisons: `(seqA - seqB) >>> 0` (unsigned right shift) to handle wraparound correctly. The condition `seqA is ahead of seqB` becomes `((seqA - seqB) >>> 0) < HALF_WINDOW` where `HALF_WINDOW = 2^(bits-1)`.
- If using 32-bit numbers: add a test that creates a stream starting at `seq = 0xFFFFFFF0`, sends 32 frames, and asserts all are delivered correctly through the wraparound.
- Alternatively, use JavaScript's native 53-bit safe integer range — a `Number` counter incremented once per frame will not wrap in any conceivable stream lifetime (9 quadrillion frames).
- The reorder buffer's "gap detection" threshold must be a modular-distance check, not a raw comparison.

**Warning signs:**
- Stream spontaneously errors with `reason: 'seq-gap'` after approximately 4 billion chunks (32-bit) or 65,536 chunks (16-bit) with no actual gap.
- Very rare in tests; manifests only in long-running integration tests or benchmarks.

**Phase to address:** Phase 3 (session/reorder-buffer.ts) — write the test for wraparound in Phase 3, before the reorder buffer is integrated into the session.

---

### Pitfall 10: Structured Clone Cost for Large Object Graphs

**Priority:** HIGH — throughput cliff with no obvious cause

**What goes wrong:**
Structured clone is O(n) in the number of object references in the graph. A 32 MB `ArrayBuffer` takes ~300ms to clone (Chrome benchmark data from surma.dev). A similarly-sized JSON object graph with many references takes longer because the clone algorithm must walk every property of every nested object, build a reference map to handle cycles, and allocate a new object tree.

The throughput cliff manifests when callers use the structured-clone path (not the transferable path) for large payloads. The library's automatic chunk splitter will send 32 × 1MB chunks instead of 1 × 32MB chunk, but if each chunk is a structured-cloneable object rather than an `ArrayBuffer`, each chunk still pays the full clone cost × number of properties.

**Why it happens:**
Developers benchmark with small objects and see adequate performance, then move to large deeply-nested payloads (e.g., `{ frames: [{ pixels: Uint8Array, metadata: {...} }, ...] }`) and hit the cliff. The fix is to separate the binary data (`Uint8Array`) from the metadata object, send the binary data as a transferable, and send metadata as a small structured-clone header.

**How to avoid:**
- Document: "For maximum throughput, separate binary data from metadata. Transferable chunks avoid clone cost entirely; structured-clone chunks pay O(object-properties) cost."
- In DEBUG mode, log the chunk path chosen (BINARY_TRANSFER vs STRUCTURED_CLONE) and the chunk size. Add a dev-time warning: "Chunk of type STRUCTURED_CLONE with > 10,000 properties detected — consider separating binary data."
- The benchmark harness (Phase 5) must include a structured-clone large-graph benchmark alongside the ArrayBuffer benchmark to make this tradeoff visible in published results.
- The chunk type tag (FEATURES.md) must default to BINARY_TRANSFER for `ArrayBuffer`/`TypedArray` inputs and STRUCTURED_CLONE only as fallback. The library must never silently downgrade a transferable chunk to clone.

**Warning signs:**
- Throughput drops non-linearly as payload object depth increases.
- CPU profiler shows `structuredClone` or internal V8 clone routines taking >50% of wall time.
- Benchmark results for structured-clone payloads are an order of magnitude worse than ArrayBuffer payloads of the same byte size.

**Phase to address:** Phase 1 (Transport — fast-path selector must never silently fall back to clone for transferable types), Phase 5 (benchmarks must cover both paths).

---

### Pitfall 11: MessagePort GC When Not Stored in a Strong Reference

**Priority:** HIGH — stream silently stops receiving messages; extremely hard to diagnose

**What goes wrong:**
A `MessagePort` that is not stored in a strong (non-WeakRef) JavaScript reference is eligible for garbage collection. Once GC'd, no messages are delivered — they are silently dropped. The sender does not receive any error. The stream appears open but goes permanently quiet.

This happens when:
1. The caller creates a `MessageChannel`, transfers `port2` to the iframe, but stores `port1` only in a local variable that goes out of scope.
2. A relay creates intermediate ports for routing but stores them in a `WeakMap` or closure that gets collected.
3. The Transport layer stores the endpoint in a variable inside a factory function that is not retained by the caller.

**Why it happens:**
There is no close event on `MessagePort` in most browsers (the `MessagePort.onclose` event is a recent Blink proposal, not yet cross-browser). Silent GC of ports is therefore both undetectable and produces no console error. The spec does not require the browser to keep a port alive merely because it has a pending `onmessage` handler.

**How to avoid:**
- Transport layer must store the endpoint reference in a `Set` or `Map` on the `Channel` instance (strong reference). Document: "The Channel instance must be kept alive (assigned to a variable with module or class scope) for the lifetime of the stream."
- Lint rule: never store a `MessagePort` in a `WeakMap` or `WeakRef`. Add this to the ESLint/Biome config for the library's own code.
- In the public API docs: explicit example showing `const channel = createChannel(port)` at module scope, not inside a function body.
- Add a stall detection timeout (Pitfall 3 mitigation also covers this): if no messages arrive for N seconds and the credit window is not exhausted, it may be a GC'd port.

**Warning signs:**
- Stream works in one test run, fails non-deterministically in another.
- Adding `--expose-gc` in Node and calling `global.gc()` makes the test fail reliably.
- Chrome DevTools memory snapshot shows the `MessagePort` object is no longer in the heap.
- No console error of any kind — complete silence.

**Phase to address:** Phase 1 (Transport layer — Channel must hold strong reference), Phase 5 (documentation and examples must demonstrate correct reference lifetimes).

---

### Pitfall 12: `wasm-unsafe-eval` Leaking Into the Baseline CSP Path

**Priority:** HIGH — violates the library's core CSP-safety guarantee silently

**What goes wrong:**
The WASM fast path is added as an opt-in, but a build or import misconfiguration causes it to be included in the baseline bundle. Any page with `script-src 'self'` (no `wasm-unsafe-eval`) will silently fail to load the library — or worse, load it but have all WASM instantiation fail at runtime with a confusing `EvalError` that does not mention WASM in the message.

The wasm-bindgen-generated glue also poses a risk: `js_sys::global()` in Rust uses a `Function` constructor (`new Function('return this')`) which violates `unsafe-eval`. This can appear in wasm-bindgen output even when the developer believes they have avoided it.

**Why it happens:**
The WASM module is tree-shaken only if bundlers correctly identify it as having `sideEffects: false` and the import path is statically unused. Dynamic feature detection (`if (wasmAvailable) { await import('./wasm.js') }`) combined with `sideEffects: false` should tree-shake correctly — but only if the dynamic import is truly unreachable from the non-WASM entrypoint. Any shared utility module that is imported by both paths can prevent tree-shaking.

**How to avoid:**
- Ship WASM as a separate entry point in `exports`: `{ ".": "./dist/index.js", "./wasm": "./dist/wasm.js" }`. The baseline `"."` entry NEVER imports from `"./wasm"`.
- Add a CI step that builds only the baseline `"."` entry and runs `npx csp-checker` (or equivalent) to verify no `wasm-unsafe-eval` is required.
- Write a Playwright CSP test: serve the library in a page with `Content-Security-Policy: default-src 'self'; script-src 'self'` (no `wasm-unsafe-eval`). Assert the page loads and streams work correctly.
- Check wasm-bindgen output for `new Function` before every WASM milestone: `grep -r "new Function" dist/wasm.js` must return empty.

**Warning signs:**
- Chrome console: `Refused to compile or instantiate WebAssembly module because 'wasm-unsafe-eval' is not an allowed source of script in the following Content Security Policy directive`.
- `EvalError: Code generation from strings disallowed for this context` (older Chrome) in a page that has no eval usage.
- `publint` or `attw` reports show unexpected `dist/wasm.js` appearing in the main entry bundle.

**Phase to address:** Phase 1 (establish the two-entry-point structure before any WASM code exists), WASM milestone (verify CSP-safe glue before shipping).

---

## Moderate Pitfalls

### Pitfall 13: Chunk Size Mismatch — Too Small (Header Overhead) or Too Large (Event Loop Starvation)

**Priority:** MEDIUM — throughput degradation, not correctness

**What goes wrong:**
- **Too small (< 4 KB):** Each chunk carries a frame header (stream ID, seq, type tag, credit fields — approximately 64–128 bytes as a JS object). At 1 KB chunks, header overhead is > 10%. More critically, each `postMessage` call has a non-trivial event loop cost (~10–50 µs in Chrome). 1 KB chunks at 100 MB/s = 100,000 postMessage calls per second = 5 seconds of overhead per second. Complete throughput starvation.
- **Too large (> 4 MB):** A single 4 MB structured-clone chunk takes ~37 ms to process, blocking the event loop for the entire clone duration. At 60 fps, any chunk > 16 ms blocks rendering. For transferable ArrayBuffers, transfer itself is near-zero-cost, but the frame object creation (including the header fields) still allocates GC pressure proportional to chunk count.

**How to avoid:**
- Default chunk size: 256 KB for the transferable path, 64 KB for the structured-clone path. These are benchmarks-derived estimates — validate in Phase 5 and adjust.
- Expose `chunkSize` as a configuration option with documented guidance.
- Add a benchmark axis: throughput × chunk size × path type. Publish the results in the docs.
- For real-time use cases (live video, audio), add a recommendation: chunk size ≤ 16 ms of data to avoid blocking rendering.

**Warning signs:**
- Benchmark shows throughput plateauing well below expected saturation — suspect chunk-size-too-small.
- Browser frame rate drops during high-throughput stream — suspect chunk-size-too-large on main thread.
- postMessage call count (measured via Performance API) exceeds 10,000/second.

**Phase to address:** Phase 3 (chunker defaults), Phase 5 (benchmark harness must sweep chunk sizes).

---

### Pitfall 14: SAB Capability Detection Produces False Positive

**Priority:** MEDIUM — SAB fast path used where it silently fails

**What goes wrong:**
`typeof SharedArrayBuffer !== 'undefined'` returns `true` in some contexts where SAB is defined but not usable for cross-context sharing (e.g., a context that has the class but not cross-origin isolation, a Node.js environment, or certain browser extensions). The more precise check `self.crossOriginIsolated === true` is required. But even this is not sufficient: SAB **cannot be transferred to a ServiceWorker client** (different agent cluster) even with `crossOriginIsolated === true`. Attempting to do so throws `DataCloneError: SharedArrayBuffer transfer requires self.crossOriginIsolated` on the destination.

**How to avoid:**
- The capability probe (ARCHITECTURE.md) correctly uses `typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated === true`. Add a third condition: `!(endpoint instanceof ServiceWorker)`.
- The CAPABILITY frame exchange means both sides report their SAB availability. If either side reports `sab: false`, the SAB path is disabled for the channel. This handles the ServiceWorker case automatically as long as the SW side reports `sab: false`.
- Add a test: channel between a page with `crossOriginIsolated === true` and a ServiceWorker. Assert SAB path is NOT selected; transferable path is selected.

**Warning signs:**
- `DataCloneError: SharedArrayBuffer transfer requires self.crossOriginIsolated` during capability probe.
- SAB fast path selected but `Atomics.notify` calls return 0 (no waiting thread) — indicates the SAB was not actually shared.

**Phase to address:** Phase 1 (Transport / capability.ts — probeCapabilities must include ServiceWorker check).

---

### Pitfall 15: Duplicate Frames on Reconnect / Stream-ID Reuse

**Priority:** MEDIUM — out-of-order delivery or false duplicate detection

**What goes wrong:**
If a stream is closed and a new stream is opened reusing the same `streamId` (e.g., a monotonic counter that resets on channel reconnect), stale `DATA` or `CREDIT` frames from the dead stream may arrive at the receiver and be misattributed to the new stream with the same ID. This is especially likely if the old stream was not cleanly closed (worker crash, BFCache freeze) and queued frames are delivered after the new stream opens.

**How to avoid:**
- Stream IDs must be monotonically increasing per channel and never reused within a channel's lifetime. Use a 32-bit counter that never resets (counter starts at 1 when the channel opens; if the channel is re-established, create a new Channel instance with a new counter).
- A CAPABILITY frame can include a `channelEpoch` (random nonce generated at channel open). Any frame whose `epoch` does not match the current epoch is discarded with a debug log.
- Add a test: close stream ID 5, open stream ID 5 again on the same channel, assert no frames from the first stream are delivered to the second.

**Warning signs:**
- Consumer receives unexpected chunks at the beginning of a new stream.
- Sequence numbers on a new stream start at an unexpected value (non-zero) indicating buffered frames from the old stream are being processed.

**Phase to address:** Phase 2 (Channel — stream ID allocation must be monotonic and non-resetting), Phase 4 (Session lifecycle must clean up all buffered frames on CLOSE/RESET).

---

### Pitfall 16: `onmessage` vs `addEventListener('message')` — Silently Drops Events

**Priority:** MEDIUM — message loss when caller also uses addEventListener on the same endpoint

**What goes wrong:**
The library sets `endpoint.onmessage = libraryHandler`. If the caller previously set `endpoint.onmessage = callerHandler` or set `worker.onmessage = callerHandler`, the library silently overwrites it. Conversely, if the caller uses `worker.addEventListener('message', callerHandler)` and the library uses `onmessage`, both handlers fire — but the library's frames are processed twice if both paths call the library.

If the caller uses `addEventListener('message', ...)` on the same object and the library uses `onmessage =` assignment, only the `addEventListener` handler receives messages in browsers where the two are independent listeners. This creates an inconsistency where the library's `onmessage` assignment does not fire for messages the caller routes through `addEventListener`.

**Why it happens:**
`onmessage` and `addEventListener('message', ...)` are not perfectly interchangeable in all contexts. On a `MessagePort`, `onmessage` assignment also calls `.start()` implicitly, while `addEventListener` does not. This difference causes subtle bugs.

**How to avoid:**
- The library contract (ARCHITECTURE.md): "The PostMessageEndpoint you pass to the library is owned exclusively by the library." Enforce this in docs.
- For shared Workers where the caller must also receive messages: use a `MessageChannel` to extract a dedicated port for the library. The caller retains the other port.
- Internally: use `onmessage =` (not `addEventListener`) because it also implicitly calls `.start()` on `MessagePort`. Document this choice.
- Add a lint rule for examples: no `addEventListener('message', ...)` and library `createChannel()` on the same object.

**Warning signs:**
- Library starts but never receives any messages (endpoint has an existing `onmessage` that the library overwrote, caller didn't notice).
- Messages arrive doubled (both `onmessage` and `addEventListener` fire, and the library processes them twice).

**Phase to address:** Phase 1 (Transport / endpoint contract documentation), Phase 5 (API docs and examples).

---

### Pitfall 17: Mocked postMessage in Tests Has Different Semantics Than Real

**Priority:** MEDIUM — tests pass, production fails

**What goes wrong:**
Test environments that mock postMessage (jsdom, happy-dom, manual mocks) differ from real browsers in several ways that mask real bugs:

1. **No structured clone enforcement**: jsdom passes objects by reference, not by value. Mutating the object after `postMessage` affects the "received" value. Tests pass; production fails when the structured clone correctly copies.
2. **No Transferable detach**: `ArrayBuffer` is not detached after mock `postMessage`. Code that reads the buffer after transfer works in tests, throws `TypeError` in production.
3. **Synchronous delivery**: Mock `postMessage` often fires `onmessage` synchronously. Real `postMessage` fires asynchronously (next task, not microtask). Tests with synchronous assumptions fail on timing-dependent code.
4. **No origin enforcement**: Mocked workers/iframes have no origin model. Origin-based security bugs are completely invisible in tests.
5. **BFCache, SAB, crossOriginIsolated**: None of these work in jsdom/happy-dom.

**How to avoid:**
- As established in STACK.md and PROJECT.md: all tests must use real browsers via Vitest browser mode (Playwright provider) or standalone Playwright. NEVER use jsdom or happy-dom for this library's tests.
- The `MockEndpoint` helper in ARCHITECTURE.md uses a real `MessageChannel` — this is the correct approach. It gives real structured-clone semantics, real async delivery, and real Transferable detachment.
- Specifically: the `ArrayBuffer` detach test (Pitfall 2) and the structured-clone restriction test (Pitfall 1) MUST run in a real browser (Vitest browser mode).
- CI must include a check that no test file uses `@vitest/environment: 'jsdom'` or `@vitest/environment: 'happy-dom'`.

**Warning signs:**
- Tests pass in CI (Node/jsdom) but fail in Playwright E2E.
- A test that mutates an object after `worker.postMessage(obj)` passes but the same pattern fails in production.
- Transferable tests always succeed even when transfer list is empty (mocked postMessage ignores the transfer list).

**Phase to address:** Phase 1 (establish test infrastructure rule), every phase (enforce as lint/CI rule).

---

### Pitfall 18: Async Iterator Composition Leaks Streams

**Priority:** MEDIUM — memory leak, stream never closed

**What goes wrong:**
Using `for await...of stream.readable` as a consumer: if the `for await` loop exits via `break`, `return`, or an exception, the `ReadableStream` reader is NOT automatically cancelled in all implementations. The stream remains open, holding the credit window open, and the sender continues buffering indefinitely.

```typescript
// LEAKS the stream if called with break or error:
for await (const chunk of stream.readable) {
  if (done) break; // reader is NOT cancelled; stream stays open
}
```

This is a known WHATWG Streams / async iterator interaction where the iterator's `return()` method must be called to cancel the reader, and not all user code does this correctly.

**How to avoid:**
- Document: use `pipeTo` for production consumers (automatic propagation of cancel). Use `for await` only for simple single-read cases.
- The library's ReadableStream adapter must attach a `cancel` handler that sends a `CANCEL` frame. This is correct per WHATWG Streams spec — the `cancel()` method of the underlying source is called when the reader is cancelled.
- Add a test: consumer reads 10 chunks via `for await`, calls `break`, then asserts that the sender's WritableStream receives a `cancel` signal (or the channel sees a `CANCEL` frame) within 100ms.
- In DEBUG mode: log a warning if a stream's reader is released (consumer calls `releaseLock()`) without `cancel()` being called.

**Warning signs:**
- Memory leak: heap grows proportionally to number of "completed" streams that were iterated with `for await` and `break`.
- Sender never receives backpressure signal after consumer "finished" — credit window stays open.
- `CLOSE` frames from the sender pile up on a stream that has no active consumer.

**Phase to address:** Phase 5 (adapters/streams.ts — ReadableStream cancel handler is mandatory), Phase 5 documentation.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Use raw integer comparison for seq numbers (`seq > expected`) | Simple to write | Silent data corruption at wraparound | Never — use modular arithmetic from day one |
| Single-entry-point bundle (baseline + WASM together) | One import path for users | Violates CSP-safe guarantee; WASM forces `wasm-unsafe-eval` for all users | Never |
| Skip origin validation in Window endpoint examples | Shorter example code | XSS escalation vector; security audit failure | Never |
| Use WHATWG Streams `pipeTo` inside the relay | 3 lines vs 30 lines | OOM under load; backpressure does not propagate across postMessage | Never |
| `jsdom` for protocol unit tests | Fast, no browser needed | False confidence; structured-clone and Transferable semantics are wrong | Only for pure framing/codec tests with no I/O (Phase 1 framing layer only) |
| Global `worker.onmessage` override without MessageChannel | No wiring boilerplate | Caller's existing message handlers silently lost | Never in library code; document the pattern but make it obvious |
| initCredit = 1 (minimal initial window) | Simple to implement | High per-chunk latency (sender sends 1 chunk, waits for CREDIT, repeat) | Only for testing backpressure logic; never as production default |
| Hardcode chunk size to 64 KB | No configuration needed | Wrong size for both SAB fast path (should be larger) and structured-clone (may be smaller) | Acceptable as temporary default in Phase 3; replace with benchmark-derived default in Phase 5 |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `Window.postMessage` (cross-window) | Pass the raw `Window` object as endpoint; forget origin validation | Use `createWindowEndpoint(win, expectedOrigin)` adapter; never pass raw `Window` |
| `ServiceWorker` (page → SW) | Use SAB path with a SW endpoint; SW is in a different agent cluster | Force `sab: false` for ServiceWorker endpoints; use transferable path only |
| `MessagePort` (from MessageChannel) | Forget to call `port.start()` before the library uses it | Call `.start()` immediately after `new MessageChannel()`, before passing to library |
| `Worker` (DedicatedWorker) | Use `worker.onmessage = x` then pass worker to library; library overwrites it | Create a `MessageChannel`, pass `port2` to worker via the first `postMessage`, pass `port1` to library |
| Sandboxed iframe (`sandbox="allow-scripts"` only, no `allow-same-origin`) | Attempt to use SAB fast path; SAB unavailable without `crossOriginIsolated` | Ensure fallback path is tested in this topology; SAB is correctly auto-detected as unavailable |
| `SharedWorker` | Pass `sharedWorker.port` to library; port is MPSC, conflicts with SPSC SAB design | Mark as untested in v1 docs; use STRUCTURED_CLONE path only; document explicitly |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Too-small chunks (< 4 KB) on transferable path | Throughput much lower than expected; postMessage call count per second > 10,000 | Benchmark-derived default ≥ 256 KB; expose `chunkSize` option | At any sustained throughput > ~40 MB/s |
| Structured clone on large object graphs | Throughput 10–100× worse than ArrayBuffer of same size; CPU at 100% in clone routines | Separate binary from metadata; use transferable for binary | Payloads with > 1,000 object references |
| Main-thread relay | Relay creates event loop latency; effective throughput drops with UI activity | Use a DedicatedWorker as relay when possible (not the project's design, but a recommendation) | Any UI-heavy page with > 5 MB/s through the relay |
| SAB Atomics.wait on main thread | Blocks main thread; DevTools shows "page unresponsive" | `Atomics.wait` is forbidden on main thread in browsers — use `Atomics.waitAsync` or only `Atomics.notify` from main thread | Always — Atomics.wait throws RangeError on main thread |
| Copy instead of transfer (forget the transferList argument) | Throughput 30–100× lower for large ArrayBuffers; GC spikes | Transport must always compute and pass the `transferList` for BINARY_TRANSFER chunks | Every transfer of ArrayBuffer > 1 MB |
| Vitest benchmark without GC pressure | Benchmark shows high throughput; real workload is slower due to GC pauses | Use Vitest browser mode (real V8 GC); measure `performance.memory.usedJSHeapSize` before/after | Always in microbenchmarks |
| Tab throttling mid-benchmark | Benchmark throughput drops to near-zero; CPU throttled by browser for background tabs | Run benchmarks with tab visible (not background); note in benchmark methodology | Any benchmark run in a background or minimized tab |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Wildcard `targetOrigin: '*'` on Window.postMessage with sensitive data in frame | Any cross-origin frame intercepts library control frames, can inject streams or read credits | Use exact `targetOrigin`; better: use `MessagePort` which has no origin concept |
| No event.origin check on `window.addEventListener('message', ...)` | Malicious iframe can send crafted `__ibf_v1__` frames to open unauthorized streams | `createWindowEndpoint(win, expectedOrigin)` enforces this; raw Window never safe |
| Reusing stream IDs across channel reconnects | Stale frames from dead stream delivered to new stream with same ID | Monotonic stream IDs per channel lifetime; new channel = new epoch nonce |
| Trust frame content from untrusted endpoint | Protocol fields (streamId, seq, credit grant values) can be spoofed to cause OOM or stall | Library is not designed for adversarial endpoints; document that both sides must be trusted code |
| COOP/COEP headers on only one hop of a multi-hop topology | SAB available on hop 1 but not hop 2; DataCloneError on relay when relay tries to forward SAB signal frames | CAPABILITY negotiation ensures SAB only when both sides confirm it; relay disables SAB if any hop lacks it |

---

## "Looks Done But Isn't" Checklist

- [ ] **Credit window wired to WHATWG Streams:** Often missing — the WritableStream's `ready` promise is wired to the credit counter, not just returning a resolved promise. Verify: writer.ready must be pending when `creditsRemaining === 0`.
- [ ] **CANCEL propagates upstream through relay:** Often missing — relay handles downstream `CANCEL` frame and forwards `RESET` upstream. Verify: cancel the ReadableStream at the iframe end; assert the worker's WritableStream aborts within 100ms.
- [ ] **CLOSE after final DATA delivered (not just CLOSE frame received):** Often missing — CLOSE transitions to CLOSED only after the reorder buffer delivers the chunk with `seq === finalSeq`. Verify: send CLOSE frame before all DATA frames (out of order); assert stream closes only after last chunk delivered.
- [ ] **Stall detection suspended during page hidden:** Often missing — `visibilitychange` listener must suspend heartbeat/stall timers. Verify: hide the tab for 10 seconds; assert stream is not errored after page becomes visible again.
- [ ] **Frame namespace marker prevents host-app message misrouting:** Often missing — `decode()` must return `null` for messages without `__ibf_v1__: 1`. Verify: send a raw `{ type: 'DATA' }` object (no marker) on the channel; assert it is passed through to the caller's original handler, not processed as a library frame.
- [ ] **jsdom/happy-dom excluded from CI:** Often missing — CI matrix must not include a Node environment that uses jsdom for protocol tests. Verify: grep test configs for `environment: 'jsdom'`; only allowed for pure framing unit tests.
- [ ] **jsr.json version synced on every changeset publish:** Often missing — `scripts.version` in package.json runs `sync-jsr-version.mjs`. Verify: run `changeset version` and check that both `package.json` and `jsr.json` have the same new version.
- [ ] **SAB path explicitly disabled for ServiceWorker endpoints:** Often missing — capability probe returns `sab: false` when endpoint is a `ServiceWorker`. Verify: capability test with SW endpoint; assert `CAPABILITY` frame has `sab: false`; assert transport selects transferable path.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| DataCloneError swallowed (Pitfall 1) | HIGH | Add try/catch around all postMessage calls in transport; add RESET emission on DataCloneError; all existing stream error handling then propagates correctly |
| Detached buffer access (Pitfall 2) | MEDIUM | Audit all code paths after postMessage calls; move all size/metadata reads before transfer; update chunker to record sizes before send |
| Credit deadlock (Pitfall 3) | MEDIUM | Add stall detection timer to credit-window.ts; wire to StreamSession FSM; add stall test |
| Relay OOM (Pitfall 6) | HIGH | Replace pipeTo-based relay with credit-forwarding routing table; existing tests will validate after replacement |
| BFCache zombie (Pitfall 7) | MEDIUM | Add pagehide/pageshow listeners; stream teardown on persisted=true pause; add Playwright BFCache test |
| SW recycled mid-stream (Pitfall 8) | MEDIUM | Add heartbeat protocol to Transport; heartbeat option opt-in per endpoint |
| Seq wraparound (Pitfall 9) | LOW | Replace `>` comparisons with modular arithmetic; one-line change per comparison; add wraparound test |
| Port GC (Pitfall 11) | MEDIUM | Audit all Channel/Transport code for strong reference retention; add explicit keep-alive set |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| DataCloneError swallowed (P1) | Phase 1 (Transport) | Test: send Function in chunk; assert stream errors with DataCloneError reason |
| Detached buffer access (P2) | Phase 1 (Transport) + Phase 3 (Chunker) | Test: assert `buffer.byteLength === 0` after postMessage; assert chunker records size before transfer |
| Credit window deadlock (P3) | Phase 3 (credit-window) + Phase 4 (Session) | Test: open stream, never read, assert stream errors with 'consumer-stall' after timeout |
| Streams enqueue ignores backpressure (P4) | Phase 3 (credit-window) + Phase 5 (adapters/streams) | Test: fast sender, slow consumer; assert heap stays bounded |
| Origin not validated (P5) | Phase 1 (endpoint.ts) + docs | Test: send crafted frame from wrong origin; assert it is rejected |
| Relay unbounded buffer (P6) | Phase 6 (relay) | Benchmark: fast producer, slow consumer; assert relay heap bounded |
| BFCache zombie (P7) | Phase 4 (Session lifecycle) | Playwright test: navigate away (BFCache), navigate back; assert streams error |
| SW recycled (P8) | Phase 1 (Transport heartbeat) | Playwright test: wait 35s with SW idle; assert heartbeat-timeout error |
| Seq wraparound (P9) | Phase 3 (reorder-buffer) | Test: stream starting at 0xFFFFFFF0; assert all 32 frames delivered |
| Clone cost cliff (P10) | Phase 5 (benchmarks) | Benchmark: structured-clone large graph vs ArrayBuffer same size; publish both |
| Port GC (P11) | Phase 1 (Channel strong ref) | Test: gc() after channel create; assert messages still delivered |
| wasm-unsafe-eval leak (P12) | Phase 1 (entry point structure) | CI: CSP-strict Playwright test on baseline bundle |
| Chunk size (P13) | Phase 3 (chunker defaults) + Phase 5 (benchmarks) | Benchmark: sweep chunk sizes 1 KB–4 MB; publish results |
| SAB false positive (P14) | Phase 1 (capability probe) | Test: SW endpoint; assert SAB not selected |
| Duplicate frames on reconnect (P15) | Phase 2 (Channel stream ID monotonic) | Test: reuse stream ID on new channel; assert no old frames delivered |
| onmessage vs addEventListener (P16) | Phase 1 (Transport contract) + docs | Doc review: every example shows dedicated endpoint |
| Mock vs real semantics (P17) | Phase 1 (CI rule) | CI: assert no jsdom in test configs |
| Async iterator stream leak (P18) | Phase 5 (adapters/streams cancel) | Test: for-await with break; assert CANCEL frame sent within 100ms |

---

## Sources

- MDN: Structured clone algorithm — types that throw DataCloneError (Functions, DOM nodes, private class fields, RegExp.lastIndex) — HIGH confidence
- MDN: Transferable objects — browser support matrix, detach semantics, byteLength → 0 after transfer — HIGH confidence
- WHATWG Streams spec (streams.spec.whatwg.org) — `enqueue()` does not enforce backpressure, `desiredSize` is advisory, pull vs push source distinction — HIGH confidence
- GitHub whatwg/streams #1323 — backpressure on readable side of TransformStream; confirmed enqueue-ignores-backpressure behavior — HIGH confidence
- web.dev/articles/bfcache — BFCache freeze semantics, pagehide/pageshow, open connections eligibility, workers continue running during freeze — HIGH confidence
- Chrome Developers blog: BFCache extension messaging changes — MessagePort behavior during BFCache — MEDIUM confidence (extension-focused but same mechanism)
- GitHub w3c/ServiceWorker #980 — postMessage keeps SW alive; Chrome 30s idle timeout — HIGH confidence
- GitHub mswjs/msw #2115, #367 — Chrome SW terminated after 30s–5min inactivity — HIGH confidence (real-world observation)
- MSRC blog: "postMessaged and Compromised" (August 2025) — wildcard targetOrigin exploitation in real supply chain attack — HIGH confidence
- secureideas.com: "Being Safe and Secure with Cross-Origin Messaging" — origin validation patterns — MEDIUM confidence
- GitHub fergald/explainer-messageport-close — MessagePort GC with no close event; WeakRef behavior — MEDIUM confidence (explainer/proposal stage)
- Chrome bugtracker: Tone.js #915 — "ArrayBuffer at index 0 is already detached" real-world double-transfer error — HIGH confidence
- Mozilla Bugzilla #1659025 — Transferable ReadableStream Firefox implementation — HIGH confidence
- WebKit TP 238 (February 2026) — Transferable ReadableStream in Safari TP — HIGH confidence
- GitHub changesets/changesets #1717 — JSR version sync is not automatic; must be scripted — HIGH confidence
- surma.dev "Is postMessage slow?" — 32 MB: 302ms clone vs 6.6ms transfer; postMessage overhead per call — HIGH confidence
- wasm-bindgen CSP issues #1641, #1647 — js_sys::global uses Function constructor, violates strict CSP — HIGH confidence
- WebAssembly CSP proposal (github.com/WebAssembly/content-security-policy) — wasm-unsafe-eval semantics — HIGH confidence
- RFC 9000 (QUIC) — modular window comparison, per-stream credits, zero-initial-credit design — HIGH confidence
- GeeksforGeeks/TutorialsPoint: TCP sequence number wraparound — modular arithmetic requirement — MEDIUM confidence (secondary sources verify RFC 793 primary)

---

*Pitfalls research for: iframebuffer — postMessage streaming library*
*Researched: 2026-04-21*
