# Phase 3: API Adapters + Single-Hop Integration - Research

**Researched:** 2026-04-21
**Domain:** WHATWG Streams backpressure wiring, EventEmitter patterns, Channel layer design, Node MessageChannel test harness
**Confidence:** HIGH — all critical mechanics verified against Node 22 live experiments, WHATWG Streams spec, and existing codebase; LOW only on browser DataCloneError async vs sync (see Open Questions)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Channel factory**: `createChannel(endpoint, options)` is the single entry point. Returns a `Channel` handle with `openStream() → Stream`, `onStream(cb)` (inbound stream acceptance), `close()`.
- **Stream handle**: `Stream` is the neutral shape every adapter wraps. Exposes `{ session, channel }` for adapter access; not part of the public API.
- **Low-level adapter**: `createLowLevelStream(channel, options?) → { send(chunk, transfer?), onChunk(cb), onClose(cb), onError(cb), close() }`. `send` is async and resolves when the frame is handed to the endpoint; it awaits credit.
- **EventEmitter adapter**: `createEmitterStream(channel, options?) → EmitterStream` where `EmitterStream` has `.on(event, handler)`, `.off(event, handler)`, `.write(chunk)` (sync-ish; returns `true` if more can be written, `false` if buffering), `.end()`, events: `'data' | 'end' | 'error' | 'close' | 'drain'`.
- **WHATWG Streams adapter**: `createStream(channel, options?) → { readable: ReadableStream<Chunk>, writable: WritableStream<Chunk> }`. `desiredSize` wired to `credit-window.desiredSize`. Backpressure flows through `pipeTo` naturally.
- **Zero cross-imports between adapters**: each adapter independently depends on the `Channel`, not on another adapter. Tree-shakeable (API-04).
- **Error names**: `StreamError` class with `.code` discriminant. Codes: `DataCloneError`, `ORIGIN_REJECTED`, `PROTOCOL_MISMATCH`, `CONSUMER_STALL`, `CHANNEL_FROZEN`, `CHANNEL_DEAD`, `CHANNEL_CLOSED`.
- **Capability negotiation**: CAPABILITY frame on channel open; both sides take `min(local, remote)`; `PROTOCOL_MISMATCH` fires immediately on version disagreement; `sabCapable` always false in Phase 3; `transferableStreamsCapable` defaults false in Phase 3 (feature detection probe exists, wired off).
- **MockEndpoint**: `createMessageChannelPair()` backed by Node `node:worker_threads` MessageChannel. All integration tests use this. Browser-mode Vitest deferred to Phase 9.
- **FAST-01 BINARY_TRANSFER**: ArrayBuffer/TypedArray transferred; source detach proof via `buffer.byteLength === 0` post-send.
- **FAST-02 STREAM_REF**: probe logic exists, capability flag OFF by default in Phase 3.
- **FAST-03 STRUCTURED_CLONE**: non-cloneable payload surfaces `DataCloneError` as typed stream error, not silent.
- **Heap-flat slow-consumer test**: sender 64 KB chunks tight loop for N seconds; consumer reads 1/second; assert `heapUsed` delta < 10 MB.

### Claude's Discretion

All other implementation choices (how to internally split channel/session plumbing, exact option defaults, internal method names, test-helper ergonomics) are at Claude's discretion.

### Deferred Ideas (OUT OF SCOPE)

- Observability hooks (metrics/error events) — Phase 4; leave a `hooks?: SessionHooks` option slot in channel/adapter options that defaults to `{}`
- Lifecycle (BFCache, SW recycle) — Phase 4
- Real-browser cross-context integration tests — Phase 9
- SAB fast path activation — Phase 6 (capability flag lives in CAPABILITY now, defaults `false`)
- Transferable `ReadableStream` path — Phase 6 or 9 (capability flag lives in CAPABILITY now, defaults `false`)
- Multi-hop relay — Phase 7 (Channel must route frames, not reassemble — keep that invariant in mind now so Phase 7 is a small add)
- Multiplexing — Phase 8 (the current Channel carries one logical stream; adding `openStream()`/`onStream()` shapes the API for later multiplex)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FAST-01 | Transferable ArrayBuffer/TypedArray path; post-transfer source is detached | Node `node:worker_threads` MessageChannel confirmed to detach ArrayBuffer: `byteLength === 0` after transfer (verified live). Integration test can prove this without a real browser. |
| FAST-02 | Transferable ReadableStream feature-detect; fallback to chunked delivery | Probe logic: `checkReadableStreamTransferable()` try/catch in capability.ts. OFF by default in Phase 3. The probe must exist but the result must be overridden to `false` until Phase 5/9. |
| FAST-03 | Structured-clone path surfaces `DataCloneError` as typed error, never swallowed | Node `node:worker_threads` `port.postMessage({fn: ()=>{}})` throws `DataCloneError` synchronously (verified live). Try/catch in Channel send path routes to `StreamError{code:'DataCloneError'}`. |
| API-01 | Low-level `send/onChunk/close` API — the primitive all higher adapters compose on | `createLowLevelStream(channel)` wraps a `Stream` handle; `send()` async-awaits credit from the Session's credit window. |
| API-02 | Node-style EventEmitter wrapper | In-module ~40 LoC `Map<event, Set<handler>>` emitter; NOT `require('events')`. `write()` returns bool; `drain` fires when credit refills. |
| API-03 | WHATWG Streams `{readable, writable}` pair with `desiredSize` wired to credit window | `WritableStream.write()` sink returns a Promise that resolves only when send credit is available AND frame is handed off. `ReadableStream` pull source enqueues from session's buffered chunks. |
| API-04 | Independent entry points, tree-shakeable | Named exports from `src/index.ts` reference adapter modules directly; `sideEffects: false` already in `package.json`. No cross-adapter imports. |
| TOPO-01 | Two-party single-hop topology as the default | `createChannel(endpoint)` + `Session` + single stream; no relay, no mux. Proven via MockEndpoint integration tests. |
| TEST-02 | Integration tests via MockEndpoint backed by real MessageChannel pair | Node `node:worker_threads` `MessageChannel` provides real structured-clone + Transferable detach semantics (verified live). No browser required. |
</phase_requirements>

---

## Summary

Phase 3 connects the fully-implemented `Session` (Phase 2) to a real postMessage boundary and exposes it via three independent public API surfaces. The primary work is:

1. A `Channel` class that owns one `PostMessageEndpoint`, drives capability negotiation, encodes/decodes frames via `encode()`/`decode()`, and wires a `Session` to handle one logical stream.
2. A `StreamError` class covering all named error codes the CONTEXT.md specifies.
3. Three adapter factories: `createLowLevelStream`, `createEmitterStream`, `createStream` (WHATWG Streams).
4. A `createMessageChannelPair()` test helper in `tests/helpers/mock-endpoint.ts`.
5. Integration tests that prove real structured-clone and Transferable semantics.

The highest-risk item is the WHATWG Streams backpressure wiring (`createStream`). The correct model is: `WritableStream`'s underlying sink `write()` method returns a Promise that stays pending until send credit is available AND the frame is handed to `endpoint.postMessage`. This is verified via live Node 22 experiments. The `ReadableStream` side uses a pull source that enqueues buffered chunks from the session's `onChunk` callback.

Node 22's `MessageChannel` from `node:worker_threads` fully satisfies `PostMessageEndpoint` as-is — it has `postMessage()` and an `onmessage` getter/setter that wraps received data in a `MessageEvent`-compatible object with `.data`. It detaches `ArrayBuffer` on transfer (verified live). DataCloneError throws synchronously from `port.postMessage()` in Node (verified live).

**Primary recommendation:** Build in this order: (1) `StreamError` + `Channel` + capability negotiation, (2) `createLowLevelStream`, (3) `createEmitterStream`, (4) `createStream`, (5) MockEndpoint + integration tests. The low-level adapter validates the session layer before the higher-complexity adapters are layered on.

---

## Project Constraints (from CLAUDE.md)

Directives from `CLAUDE.md` in working directory (project-level):

- Follow guidelines in `AGENTS.md` (system-level safety, Wayland awareness, file management)
- Do not use `--break-system-packages`; use environments
- Do not wildcard-stage with `git add -A`; prefer specific filenames
- No inline review comment confusion: only unresolved comments

Directives applicable to this phase:

- **Zero runtime deps** (COMP-02): All Phase 3 source — `Channel`, adapters, `StreamError` — must have no runtime imports outside this package. The `EventEmitter` is hand-rolled in ~40 LoC, not imported from Node `events`.
- **TypeScript 6 strict + `isolatedDeclarations: true`**: Every exported symbol needs an explicit type annotation. Return type inference is not enough for exported functions. Pattern from Phase 2: `export const X: SomeType = ...` rather than `export const X = ...`.
- **Biome 2.4.12**: Run `pnpm exec biome check --write <file>` before each commit. The `files.includes` pattern with `!!` negation prefix is in use (from Phase 1 learning).
- **ESM with `.js` import extensions**: All imports in source files use `.js` extension (e.g., `import { Session } from './session/index.js'`).
- **Vitest 4 Node env (`--project=unit`)**: Phase 3 tests run in the existing `unit` project. The `integration` test directory does not exist yet — it must be created. The `vitest.config.ts` `unit` project already covers `tests/unit/**/*.{test,spec}.ts` — if integration tests go under `tests/integration/`, a new project entry is needed in `vitest.config.ts`.
- **`sideEffects: false`** is already set in `package.json` — no change needed.

---

## Standard Stack

### Core (all already in project)

| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| TypeScript | 6.0.3 | Source language | Installed |
| Vitest | 4.1.4 | Test runner | Installed |
| node:worker_threads MessageChannel | Node built-in (v22.22.1) | MockEndpoint backing | Available |
| WHATWG ReadableStream / WritableStream | Node 22 global | Streams adapter target | Available in Node 22 |

### No New Runtime Dependencies

Phase 3 introduces zero new runtime dependencies. The `events` module from Node is explicitly NOT used — the `EventEmitter` implementation is hand-rolled (COMP-02, browser-safe). All Phase 3 source only imports from:
- `src/framing/` (existing)
- `src/transport/endpoint.ts` (existing)
- `src/session/index.ts` (existing)
- `src/framing/types.ts` (existing)
- `src/framing/encode-decode.ts` (existing)

### Vitest Config Change Required

The `vitest.config.ts` currently covers `tests/unit/**/*.{test,spec}.ts` only. Integration tests must go in `tests/integration/` — add a second project entry OR extend the include glob. Recommended: extend the `unit` project's include to also cover `tests/integration/**/*.{test,spec}.ts` since all Phase 3 tests still run in Node environment (no browser required). This avoids adding a new project config and matches the spirit — these ARE unit/integration tests in Node environment.

---

## Architecture Patterns

### Recommended Project Structure (Phase 3 additions)

```
src/
├── channel/
│   └── channel.ts         # Channel class — capability negotiation, frame routing to Session
├── adapters/
│   ├── lowlevel.ts        # createLowLevelStream()
│   ├── emitter.ts         # createEmitterStream() + EventEmitter impl
│   └── streams.ts         # createStream() — WHATWG Streams
├── types.ts               # StreamError class, exported type shapes
└── index.ts               # Updated re-exports for Phase 3

tests/
├── helpers/
│   └── mock-endpoint.ts   # createMessageChannelPair() — test-only
├── unit/
│   ├── channel/
│   │   └── channel.test.ts
│   └── adapters/
│       ├── lowlevel.test.ts
│       ├── emitter.test.ts
│       └── streams.test.ts
└── integration/
    ├── binary-transfer.test.ts    # FAST-01: ArrayBuffer transfer + detach
    ├── streams-backpressure.test.ts # API-03: 16 MB pipe + backpressure
    ├── emitter-drain.test.ts       # API-02: data/drain events
    ├── heap-flat.test.ts           # Heap-flat slow-consumer test
    └── data-clone-error.test.ts    # FAST-03: DataCloneError surfacing
```

### Pattern 1: Channel as Endpoint + Session Bridge

**What:** `Channel` owns one `PostMessageEndpoint` and one `Session`. It sets `endpoint.onmessage` to decode incoming frames and dispatch to the session. For outbound frames, it registers `session.onFrameOut(...)` to encode and call `endpoint.postMessage`. The capability handshake happens in `Channel` constructor (or `open()` method), not in `Session`.

**Session wiring:**
```typescript
// Source: src/session/index.ts (Phase 2 public API)
// session.onFrameOut(cb) — registered by Channel
// session.receiveFrame(frame) — called by Channel on inbound message
// session.desiredSize — forwarded to WritableStream controller
// session.onChunk(cb) — registered by adapters
// session.onError(cb) — registered by adapters
```

**Channel constructor responsibilities:**
1. Store endpoint reference (strong reference — LIFE-04, prevents GC).
2. Set `endpoint.onmessage = handler` that calls `decode(evt.data)` then `session.receiveFrame(frame)`, filtering CAPABILITY frames for own handling.
3. Register `session.onFrameOut((frame, transfer) => endpoint.postMessage(encode(frame), transfer ?? []))`.
4. On construction, emit CAPABILITY frame immediately; wait for remote CAPABILITY before allowing `openStream()` to proceed (use an internal `#capabilityReady: Promise<void>` that resolves on receipt of remote CAPABILITY frame).

**DataCloneError handling inside Channel's send path:**
```typescript
function sendFrame(frame: Frame, transfer?: ArrayBuffer[]): void {
  const encoded = encode(frame);
  try {
    this.#endpoint.postMessage(encoded, transfer ?? []);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'DataCloneError') {
      // Route to session error — session will fire onError and transition FSM
      this.#session.reset('DataCloneError');
      // Emit typed StreamError to adapter-level listeners
      this.#emitError(new StreamError('DataCloneError', err));
    } else {
      throw err; // unexpected — rethrow
    }
  }
}
```

Note: In Node `node:worker_threads`, `postMessage` with a non-cloneable value throws a `DataCloneError` synchronously (verified). In browsers, behavior is consistent (synchronous throw for `MessagePort.postMessage`). The try/catch covers both.

### Pattern 2: WritableStream Backpressure via Credit-Awaiting Sink

**What:** The WHATWG Streams `WritableStream` underlying sink's `write(chunk)` method returns a `Promise` that only resolves when: (a) send credit is available from the `Session.#credit` window, AND (b) the frame is handed to `endpoint.postMessage`. This creates real backpressure.

**Key insight from live testing:** `WritableStream.write()` returns a Promise that resolves when `sink.write()` resolves. If `sink.write()` returns a pending Promise, `writer.write()` callers must await it. This IS the correct mechanism — no polling, no additional sentinel. The sink implementation:

```typescript
// Inside createStream() — WritableStream sink write() handler
write(chunk: Chunk): Promise<void> {
  // If no send credit, store a resolver and return pending Promise.
  // Session.#credit.addSendCredit() will call the stored resolver when credit arrives.
  return new Promise<void>((resolve, reject) => {
    function tryWrite() {
      if (session.state === 'ERRORED' || session.state === 'CANCELLED') {
        reject(new StreamError('CONSUMER_STALL', undefined)); // or appropriate code
        return;
      }
      if (session.desiredSize > 0) {
        // Has credit — consume and send
        session.sendData(chunk, chunkType);
        resolve();
      } else {
        // No credit — queue resolver; Session will drain on CREDIT received
        creditWaiters.push({ resolve, reject, chunk, chunkType });
      }
    }
    tryWrite();
  });
}
```

`creditWaiters` is drained by a callback registered with Session that fires when `addSendCredit` is called (i.e., when a CREDIT frame is received). The Session's `#drainPendingSends()` already handles this for session-level queuing; the adapter level can either trust session-level queuing OR implement its own. **Recommendation:** Let the Session handle credit queuing (it already does via `#pendingSends`), and have `sink.write()` return a Promise that resolves immediately after `session.sendData()` is called (which enqueues if no credit). To get true write-side backpressure, use `WritableStream`'s `highWaterMark` = initial credit count so that `desiredSize` signals pressure:

```typescript
new WritableStream(sink, new CountQueuingStrategy({ highWaterMark: initialCredit }))
```

This means: when `initialCredit` writes are pending in the WHATWG Streams internal queue, `desiredSize` goes to 0 and `writer.ready` is pending. The session's `#pendingSends` queue handles the actual credit gating. The WHATWG Streams layer handles the caller-facing pressure signal. These two queues are coordinated: `sink.write()` calls `session.sendData()` synchronously; session queues if no credit; `sink.write()` resolves only after `session.sendData()` returns (which means the frame is queued or sent). The WHATWG `desiredSize` advisory signal flows from `highWaterMark - queued_writes`.

**Backpressure chain:** caller `writer.write()` → pending when `desiredSize <= 0` → `desiredSize` driven by `CountQueuingStrategy(highWaterMark: initialCredit)` → once all queued writes complete (session drained them on CREDIT), `desiredSize` returns positive → `writer.ready` resolves.

### Pattern 3: ReadableStream as Pull Source

**What:** Use a ReadableStream pull source. `pull(controller)` is called by the Streams engine when `desiredSize > 0` (consumer is ready for more data). The pull source enqueues from a buffer populated by `session.onChunk()`.

**Buffering strategy:**
- `session.onChunk(chunk)` fills an internal `pendingChunks: unknown[]` array.
- If `controller.desiredSize > 0` when a chunk arrives, call `controller.enqueue(chunk)` immediately.
- If `controller.desiredSize <= 0`, the chunk sits in `pendingChunks` (bounded by credit window — session will not deliver more than HWM chunks before credit is refreshed, so this buffer is bounded).
- `pull(controller)` dequeues from `pendingChunks` if any; otherwise records a pending pull and the next `onChunk` fires the enqueue.

**`cancel(reason)` handler** sends `session.cancel(reason)` which emits a CANCEL frame to remote.

```typescript
// Inside createStream() — ReadableStream underlying source
const pendingChunks: unknown[] = [];
let pullResolve: (() => void) | null = null;

session.onChunk((chunk) => {
  if (pullResolve) {
    // pull() was called and waiting for data
    controller.enqueue(chunk);
    pullResolve();
    pullResolve = null;
  } else {
    pendingChunks.push(chunk);
  }
});

const source: UnderlyingSource = {
  pull(controller) {
    if (pendingChunks.length > 0) {
      controller.enqueue(pendingChunks.shift()!);
      return;
    }
    return new Promise<void>(resolve => { pullResolve = resolve; });
  },
  cancel(reason) {
    session.cancel(String(reason ?? 'consumer-cancel'));
  }
};
```

`highWaterMark: 0` on the ReadableStream so pull() is called only when the reader is actively waiting — this makes the credit window the sole backpressure gate, not the Streams internal queue. This correctly implements SESS-03 (credit refresh driven by consumer reads, not frame arrivals).

### Pattern 4: Minimal EventEmitter (~40 LoC)

**What:** A plain `Map<string, Set<Function>>` structure with `.on/.off/.emit/.once`. Zero deps, browser-safe. The `EmitterStream` class extends this with stream-specific methods.

```typescript
type EventMap = {
  data: [chunk: unknown];
  end: [];
  error: [err: StreamError];
  close: [];
  drain: [];
};

class TypedEmitter<T extends Record<string, unknown[]>> {
  readonly #handlers = new Map<keyof T, Set<(...args: unknown[]) => void>>();

  on<K extends keyof T>(event: K, handler: (...args: T[K]) => void): this {
    if (!this.#handlers.has(event)) this.#handlers.set(event, new Set());
    this.#handlers.get(event)!.add(handler as (...args: unknown[]) => void);
    return this;
  }

  off<K extends keyof T>(event: K, handler: (...args: T[K]) => void): this {
    this.#handlers.get(event)?.delete(handler as (...args: unknown[]) => void);
    return this;
  }

  once<K extends keyof T>(event: K, handler: (...args: T[K]) => void): this {
    const wrapper = (...args: unknown[]) => {
      this.off(event, wrapper as (...args: T[K]) => void);
      (handler as (...args: unknown[]) => void)(...args);
    };
    return this.on(event, wrapper as (...args: T[K]) => void);
  }

  emit<K extends keyof T>(event: K, ...args: T[K]): void {
    this.#handlers.get(event)?.forEach(h => h(...args));
  }

  /** Must be called on close to prevent listener leak (LIFE-05). */
  removeAllListeners(): void {
    this.#handlers.clear();
  }
}
```

**Memory safety:** `close()` and `end()` on `EmitterStream` call `removeAllListeners()` after emitting `'close'`. This prevents the listener leak described in PITFALLS LIFE-05.

### Pattern 5: MockEndpoint via Node MessageChannel

**Verified shape (Node 22 `node:worker_threads`):**

```typescript
// tests/helpers/mock-endpoint.ts
import { MessageChannel } from 'node:worker_threads';
import type { PostMessageEndpoint } from '../../src/transport/endpoint.js';

export function createMessageChannelPair(): { a: PostMessageEndpoint; b: PostMessageEndpoint } {
  const { port1, port2 } = new MessageChannel();
  // Node's MessagePort from worker_threads already satisfies PostMessageEndpoint:
  // - port.postMessage(msg, transfer) — matches signature
  // - port.onmessage = handler — getter/setter, wraps in MessageEvent with .data
  // - Setting onmessage= auto-starts the port (no explicit .start() needed in Node)
  // - ArrayBuffer in transfer list IS detached (byteLength === 0 after transfer) — verified
  // - Non-cloneable values throw DataCloneError synchronously — verified
  return {
    a: port1 as unknown as PostMessageEndpoint,
    b: port2 as unknown as PostMessageEndpoint,
  };
}
```

**Key verified facts about Node `node:worker_threads` MessageChannel:**
- `port.onmessage = handler` receives a `MessageEvent`-compatible object with `.data` property (verified).
- No explicit `.start()` call needed when using `onmessage =` (auto-starts in Node).
- `ArrayBuffer` in transfer list IS detached after `postMessage` — `byteLength === 0` (verified live with Node 22.22.1).
- Non-cloneable values (functions) throw `DataCloneError` synchronously from `port.postMessage()` (verified live).
- Message delivery is asynchronous (next task), NOT synchronous — tests must `await` or use event-driven patterns.

### Anti-Patterns to Avoid

- **WritableStream sink that resolves immediately without credit**: `sink.write()` must not return a pre-resolved Promise if credits are at zero. This would silently queue in the Session's `#pendingSends` but the `writer.ready` Promise would resolve, giving the caller false confidence. The correct model: `sink.write()` either calls `session.sendData()` and resolves (if session accepts), or defers until the session's credit refills.
- **Using `controller.enqueue()` beyond desiredSize**: Never call `controller.enqueue()` when `controller.desiredSize <= 0`. Use `pendingChunks` buffer instead (which is bounded by the credit window — Session guarantees the sender can't send more DATA frames than we have recv credits).
- **Cross-adapter imports**: `streams.ts` must not import from `emitter.ts` or `lowlevel.ts`. Each adapter is independent.
- **Importing Node `events` for EventEmitter**: breaks browser builds. Use the in-module implementation.
- **Forgetting `.removeAllListeners()` on close**: causes listener leak on long-lived applications that open/close many streams.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WHATWG Streams backpressure mechanism | Custom polling loop | `WritableStream` sink returning pending Promise | The Streams spec provides exactly this: `write()` caller awaits the returned Promise |
| Structured clone validation | Custom type checker | Try/catch around `endpoint.postMessage()` + `DataCloneError` name check | The runtime already validates; any custom check would be incomplete or redundant |
| Async event queue | Custom event loop | Node `node:worker_threads` MessageChannel in tests | Real async semantics including structured-clone enforcement |
| ArrayBuffer detach detection | Custom flag/ref tracking | `buffer.byteLength === 0` post-transfer check | Built into the spec — detach sets byteLength to 0 |

---

## Common Pitfalls

### Pitfall 1: WHATWG Streams `desiredSize` Is Advisory — Not a Gate

**What goes wrong:** Calling `controller.enqueue()` when `desiredSize <= 0` succeeds silently but grows the internal queue without bound.

**Why it happens:** `enqueue()` does not enforce backpressure (PITFALLS.md Pitfall 4, HIGH confidence, confirmed in WHATWG Streams spec).

**How to avoid:** Keep a `pendingChunks` buffer between `session.onChunk` and `controller.enqueue()`. Only call `enqueue()` when `desiredSize > 0` OR when `pull()` is actively waiting. The credit window bounds the `pendingChunks` buffer — the sender cannot send more DATA frames than recv credits granted, so `pendingChunks.length` is bounded by the Session's `highWaterMark`.

**Warning signs:** Tab memory climbs linearly. `controller.desiredSize` becomes very negative.

### Pitfall 2: DataCloneError in Browsers May Be Synchronous OR Asynchronous

**What goes wrong:** In Node `node:worker_threads`, `postMessage` throws synchronously on non-cloneable values (verified). In browsers, `MessagePort.postMessage` also throws synchronously per spec. However, some older browser implementations may dispatch the error asynchronously. The try/catch in `Channel.sendFrame()` handles the synchronous case; the async case is a lower-confidence concern.

**How to avoid:** Wrap `endpoint.postMessage()` in try/catch (covers synchronous throw). Additionally, add a `messageerror` event listener on the endpoint if the endpoint supports it (browser `MessagePort` fires `messageerror` for deserialization failures). For Phase 3, the try/catch is sufficient — `messageerror` is a Phase 4 refinement.

**Confidence:** HIGH for Node sync behavior (verified). MEDIUM for browser async scenario (not testable in Phase 3 Node tests — deferred to Phase 9 E2E).

### Pitfall 3: WritableStream `abort()` vs `close()` Semantics

**What goes wrong:** `writable.abort(reason)` signals that the stream should abandon queued writes. `writable.close()` signals that the stream should process all queued writes and then close. If both are mapped to `session.reset()`, queued writes are silently lost on `close()`.

**How to avoid:**
- `abort(reason)` → `session.reset(reason ?? 'writable-aborted')` — hard abort, discard queue.
- `close()` → `session.close()` — graceful, waits for pending sends to drain.
- These are separate methods in the WritableStream underlying sink — implement both.

### Pitfall 4: CLOSE finalSeq Is Currently Hardcoded to 0 in Session.close()

**What goes wrong:** `Session.close()` in Phase 2 hardcodes `finalSeq: 0` with a comment "Phase 3 will wire the outbound last-seq tracking properly." The CLOSE frame tells the receiver what the last DATA seqNum was, so the receiver knows when all data has been delivered. If `finalSeq === 0` always, `#checkFinalSeqDelivered()` may fire prematurely (seq 0 may have already been delivered before CLOSE arrives).

**How to avoid:** Phase 3's Channel layer must track the last DATA frame `seqNum` emitted by the session. The Chunker already generates these — the Channel can intercept `session.onFrameOut` to record the last DATA seqNum, then pass it to `session.close()`. Alternatively, expose a `session.lastSentSeq` getter. This is a Phase 3 fix, not deferrable.

**This is a known stub** from Phase 2's SUMMARY.md — "For now use the current reorder nextExpected - 1 as a proxy... Phase 3 will wire the outbound last-seq tracking properly."

### Pitfall 5: Node MessagePort Does Not Need `.start()` But Browser MessagePort Does

**What goes wrong:** `createMessageChannelPair()` works without `.start()` in Node. If this pattern is copied into Phase 9 browser tests, the browser-side `MessagePort` will silently not receive messages (browser `MessagePort` requires `.start()` when using `addEventListener`; `onmessage =` assignment auto-starts in browsers too, but `addEventListener('message')` does not).

**How to avoid:** Document in `mock-endpoint.ts` that Node auto-starts on `onmessage =` assignment. Phase 9 browser test helpers must call `.start()` explicitly if they use `addEventListener`. The library itself uses `onmessage =` (which auto-starts in both environments) — correct pattern already established in `createMessagePortEndpoint()`.

### Pitfall 6: `finalSeq` Tracking in CLOSE Frame

**What goes wrong:** The Chunker assigns sequence numbers to DATA frames. The Channel layer receives these from `session.onFrameOut`. If the Channel doesn't track the highest DATA seqNum it has seen outbound, `session.close()` cannot know what `finalSeq` to put in the CLOSE frame.

**Concrete fix:** In the Channel's `onFrameOut` registration:
```typescript
let lastDataSeqOut = -1;
session.onFrameOut((frame, transfer) => {
  if (frame.type === 'DATA') lastDataSeqOut = frame.seqNum;
  endpoint.postMessage(encode(frame), transfer ?? []);
});
// Later, when writable.close() calls channel.close():
session.close(lastDataSeqOut >= 0 ? lastDataSeqOut : 0);
// Requires Session.close(finalSeq?: number) to accept a parameter — or patch the stub.
```

The current `Session.close()` signature does not accept `finalSeq` as a parameter. Phase 3 must patch `src/session/index.ts` to accept `finalSeq?: number` in `close()`. This is a small change to an existing file.

---

## Code Examples

### Channel: Capability Handshake Frame Shape

```typescript
// Source: src/framing/types.ts (Phase 1 — CapabilityFrame)
// Sent on both sides immediately on channel open:
const capabilityFrame: CapabilityFrame = {
  [FRAME_MARKER]: 1,
  channelId: this.#channelId,
  streamId: 0,        // Channel-level frame, not stream-specific
  seqNum: 0,
  type: 'CAPABILITY',
  protocolVersion: PROTOCOL_VERSION, // 1
  sab: false,                        // Phase 3: always false
  transferableStreams: false,         // Phase 3: probe exists, result forced false
};
```

Both sides send CAPABILITY immediately. `PROTOCOL_MISMATCH` fires if `remote.protocolVersion !== PROTOCOL_VERSION`. No silent fallback.

### Channel: onmessage Handler

```typescript
// Inside Channel constructor:
endpoint.onmessage = (evt: MessageEvent) => {
  const frame = decode(evt.data);
  if (frame === null) return; // Not a library frame — ignore (non-library messages pass through)

  if (frame.type === 'CAPABILITY') {
    this.#handleCapability(frame);
    return;
  }
  // All other frames go to the session
  this.#session.receiveFrame(frame);
};
```

`decode()` returns null for non-library messages (checked via `__ibf_v1__` marker), so non-library messages on the same port are silently ignored (ENDP-01 contract).

### Low-Level Adapter: send() resolves on hand-off

```typescript
// Source: src/adapters/lowlevel.ts
export function createLowLevelStream(channel: Channel, options?: LowLevelOptions) {
  const session = channel.session; // internal accessor
  return {
    async send(chunk: unknown, transfer?: ArrayBuffer[]): Promise<void> {
      // Resolves when the frame is handed to endpoint.postMessage (credit-gated).
      // Backpressure: if no credit, session queues the payload in #pendingSends.
      // The Promise resolves after sendData() returns — which means either:
      //   (a) credit available: frame emitted to endpoint immediately, or
      //   (b) no credit: frame queued; Promise resolves after session drains on CREDIT.
      // To implement (b), we need the session to support async sendData.
      // Simpler approach (Phase 3): sendData() is sync-enqueue; the low-level adapter's
      // send() resolves immediately after sendData() returns (fire-and-forget to session queue).
      // The queue itself is bounded by credit window.
      session.sendData(chunk, transfer ? 'BINARY_TRANSFER' : 'STRUCTURED_CLONE');
    },
    onChunk(cb: (chunk: unknown) => void): void {
      session.onChunk(cb);
    },
    onClose(cb: () => void): void { /* wire to session FSM CLOSED event */ },
    onError(cb: (err: StreamError) => void): void {
      session.onError((reason) => cb(new StreamError(reason as ErrorCode, undefined)));
    },
    close(): void { channel.close(); },
  };
}
```

### StreamError Class

```typescript
// Source: src/types.ts (new in Phase 3)
export type ErrorCode =
  | 'DataCloneError'
  | 'ORIGIN_REJECTED'
  | 'PROTOCOL_MISMATCH'
  | 'CONSUMER_STALL'
  | 'CHANNEL_FROZEN'    // Phase 4 — declare shape now
  | 'CHANNEL_DEAD'      // Phase 4 — declare shape now
  | 'CHANNEL_CLOSED';   // Phase 4 — declare shape now

export class StreamError extends Error {
  readonly code: ErrorCode;
  override readonly cause: unknown;

  constructor(code: ErrorCode, cause: unknown) {
    super(`iframebuffer: ${code}`);
    this.name = 'StreamError';
    this.code = code;
    this.cause = cause;
  }
}
```

### Heap-Flat Test Pattern

```typescript
// tests/integration/heap-flat.test.ts
// Run in non-concurrent describe (timing-sensitive)
import { describe, it, expect } from 'vitest';
import { createMessageChannelPair } from '../helpers/mock-endpoint.js';

describe('heap-flat slow-consumer', { concurrent: false }, () => {
  it('heap stays flat under fast-send/slow-consume', async () => {
    const { a, b } = createMessageChannelPair();
    // ... set up Channel + createStream() on both sides ...

    // Warm-up loop first (eliminates JIT/GC spike noise)
    // ... warm-up ...

    const heapBefore = process.memoryUsage().heapUsed;
    const DURATION_MS = 3000; // 3 seconds — keep under Vitest default timeout
    const CHUNK = new ArrayBuffer(64 * 1024); // 64 KB

    // Sender: write as fast as possible
    const sendLoop = (async () => {
      const end = Date.now() + DURATION_MS;
      while (Date.now() < end) {
        await writer.write(CHUNK.slice(0)); // slice to avoid re-transfer of detached
      }
      await writer.close();
    })();

    // Consumer: read 1 chunk per second
    const readLoop = (async () => {
      for await (const _chunk of readable) {
        await new Promise(r => setTimeout(r, 1000));
      }
    })();

    await Promise.race([sendLoop, readLoop]);
    const heapAfter = process.memoryUsage().heapUsed;
    const deltaMB = (heapAfter - heapBefore) / 1024 / 1024;
    expect(deltaMB).toBeLessThan(10); // 10 MB threshold
  }, 15_000); // 15s timeout
});
```

Note: `--expose-gc` can be used to force GC between warm-up and measurement for cleaner results, but is not required — 10 MB threshold is generous enough to accommodate Vitest overhead.

### Transferable ReadableStream Probe (OFF by Default)

```typescript
// Inside channel capability detection (src/channel/channel.ts or capability module)
function checkReadableStreamTransferable(): boolean {
  // Source: ARCHITECTURE.md — checkReadableStreamTransferable()
  // OFF by default in Phase 3 — always returns false
  // Phase 5/9: flip to actually run the probe
  return false;
  /*
  try {
    const { port1, port2 } = new MessageChannel();
    const rs = new ReadableStream();
    port1.postMessage(rs, [rs as unknown as Transferable]);
    port1.close(); port2.close();
    return true;
  } catch {
    return false;
  }
  */
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `require('events')` for EventEmitter | In-module hand-rolled emitter | This project — Phase 3 | Browser-safe, zero deps (COMP-02) |
| WritableStream `start()` returning resolved promise | `write()` sink returning credit-awaiting Promise | Phase 3 | Real end-to-end backpressure |
| Polling for credit availability | Session `#drainPendingSends` callback-driven | Phase 2 | No polling, event-driven |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All tests | Yes | 22.22.1 | — |
| node:worker_threads MessageChannel | MockEndpoint | Yes | Node built-in | — |
| ReadableStream (global) | streams adapter tests | Yes | Node 22 global | — |
| WritableStream (global) | streams adapter tests | Yes | Node 22 global | — |
| Vitest | Test runner | Yes | 4.1.4 | — |

No missing dependencies. Phase 3 runs entirely in Node environment.

---

## Validation Architecture

`workflow.nyquist_validation` is `true` in `.planning/config.json` — this section is required.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.4 |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `pnpm exec vitest run --project=unit tests/unit/adapters/` |
| Full suite command | `pnpm test` (runs all unit + integration) |

### vitest.config.ts Change Required

The current `unit` project covers `tests/unit/**/*.{test,spec}.ts`. Phase 3 integration tests go in `tests/integration/`. **Extend the `unit` project include glob** to also cover `tests/integration/**/*.{test,spec}.ts`:

```typescript
// vitest.config.ts — unit project
include: [
  'tests/unit/**/*.{test,spec}.ts',
  'tests/integration/**/*.{test,spec}.ts',
],
```

This keeps all Phase 3 tests running in Node environment (no browser required for MockEndpoint). The heap-flat test should go in a `describe({ concurrent: false })` block to avoid timing interference with other tests.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FAST-01 | ArrayBuffer transferred; `buffer.byteLength === 0` after send | integration | `pnpm exec vitest run --project=unit tests/integration/binary-transfer.test.ts` | Wave 0 |
| FAST-02 | `transferableStreams: false` in CAPABILITY frame; probe logic present but returns false | unit | `pnpm exec vitest run --project=unit tests/unit/channel/channel.test.ts` | Wave 0 |
| FAST-03 | Non-cloneable chunk → `StreamError{code:'DataCloneError'}` on writer | integration | `pnpm exec vitest run --project=unit tests/integration/data-clone-error.test.ts` | Wave 0 |
| API-01 | Low-level `send()` async; resolves after hand-off; `onChunk()` fires per chunk | unit | `pnpm exec vitest run --project=unit tests/unit/adapters/lowlevel.test.ts` | Wave 0 |
| API-02 | EmitterStream `data`/`drain`/`end`/`error`/`close` events; `write()` returns bool | unit + integration | `pnpm exec vitest run --project=unit tests/unit/adapters/emitter.test.ts tests/integration/emitter-drain.test.ts` | Wave 0 |
| API-03 | WHATWG Streams pipe 16 MB ArrayBuffer; backpressure visible via `writer.ready`; no OOM | integration | `pnpm exec vitest run --project=unit tests/integration/streams-backpressure.test.ts` | Wave 0 |
| API-04 | Channel/adapter tree-shaking: import `createLowLevelStream` without pulling `createStream` or `createEmitterStream` | unit (import graph) | `pnpm exec tsc --noEmit` + publint at build time | — |
| TOPO-01 | End-to-end send/receive over MockEndpoint without relay/mux | integration | `pnpm exec vitest run --project=unit tests/integration/` | Wave 0 |
| TEST-02 | MockEndpoint real structured-clone + Transferable semantics | integration (all integration tests) | `pnpm exec vitest run --project=unit tests/integration/` | Wave 0 |

### Heap-Flat Test Note

The heap-flat test is timing-sensitive. Run it in a `describe({ concurrent: false })` block with a 15s timeout. Do NOT run it with `--reporter=verbose` (output buffering adds heap noise). Use `--run` not `--watch`.

### Sampling Rate

- **Per task commit:** `pnpm exec vitest run --project=unit tests/unit/channel/` or `tests/unit/adapters/` (whichever owns the current task)
- **Per wave merge:** `pnpm test` — full suite (194+ tests must still pass)
- **Phase gate:** `pnpm test && pnpm exec tsc --noEmit && pnpm exec biome check .` — all green before `/gsd:verify-work`

### Wave 0 Gaps

The following test files do not yet exist and must be created in Wave 0:

- [ ] `tests/unit/channel/channel.test.ts` — covers FAST-02, capability negotiation, PROTOCOL_MISMATCH
- [ ] `tests/unit/adapters/lowlevel.test.ts` — covers API-01
- [ ] `tests/unit/adapters/emitter.test.ts` — covers API-02 (unit)
- [ ] `tests/unit/adapters/streams.test.ts` — covers API-03 (unit, no MockEndpoint)
- [ ] `tests/helpers/mock-endpoint.ts` — shared test helper (not a test file, but needed by Wave 1+)
- [ ] `tests/integration/binary-transfer.test.ts` — covers FAST-01
- [ ] `tests/integration/data-clone-error.test.ts` — covers FAST-03
- [ ] `tests/integration/emitter-drain.test.ts` — covers API-02 integration
- [ ] `tests/integration/streams-backpressure.test.ts` — covers API-03 integration
- [ ] `tests/integration/heap-flat.test.ts` — heap-flat slow-consumer test
- [ ] `vitest.config.ts` — extend `unit` project include to cover `tests/integration/`

---

## Open Questions

1. **Session.close() finalSeq parameter**
   - What we know: `Session.close()` currently has no `finalSeq` parameter and hardcodes `finalSeq: 0`. The SUMMARY.md notes "Phase 3 will wire outbound last-seq tracking properly."
   - What's unclear: Should `Session.close(finalSeq: number)` be patched directly, or should the Channel layer intercept the outbound CLOSE frame and overwrite `finalSeq`?
   - Recommendation: Patch `Session.close(finalSeq?: number)` to accept an optional parameter (defaulting to 0 for backward compatibility). The Channel layer tracks `lastDataSeqOut` from `session.onFrameOut` and passes it to `session.close(lastDataSeqOut)`. This is a 2-line change to `src/session/index.ts`.

2. **WritableStream sink.write() resolution timing**
   - What we know: `sink.write()` returning a pending Promise means `writer.write()` callers must await. The Session's `#pendingSends` already queues when no credit.
   - What's unclear: If `sink.write()` resolves immediately (after handing to `sendData()`), the WHATWG Streams layer's `desiredSize` may signal "ready" before credit is actually available on the wire, leading to an overfull `#pendingSends`. This is correct behavior — the session queue is bounded — but the caller-facing `writer.ready` might resolve prematurely.
   - Recommendation: Accept the two-queue design (WHATWG Streams internal queue + Session `#pendingSends`). Set `WritableStream highWaterMark: initialCredit` to align the WHATWG Streams queue depth with the credit window. This means `writer.ready` only goes pending after `initialCredit` writes are queued — which matches the credit window depth. Document this choice.

3. **`messageerror` event for async DataCloneError in browsers**
   - What we know: Node throws synchronously (verified). Browser `MessagePort.postMessage` throws synchronously per spec. Some older or non-conformant implementations may dispatch `messageerror` events instead.
   - What's unclear: Whether any supported browser (Chrome, Firefox, Safari latest-2) deviates from the synchronous throw for `MessagePort.postMessage` with non-cloneable data.
   - Recommendation: Phase 3 uses try/catch (covers synchronous throw, covers Node). Add a `messageerror` listener in Phase 4 when lifecycle handling is added. Flag as LOW confidence gap.

---

## Sources

### Primary (HIGH confidence)

- Node 22.22.1 live experiments — `node:worker_threads` MessageChannel: DataCloneError synchronous throw, ArrayBuffer detach, `onmessage` MessageEvent shape, auto-start behavior — verified directly
- WHATWG Streams spec (streams.spec.whatwg.org) — `enqueue()` advisory, `desiredSize` semantics, pull source contract, `write()` Promise semantics — HIGH (from PITFALLS.md and ARCHITECTURE.md, cross-referenced with live Node 22 experiments)
- `src/session/index.ts` (Phase 2) — Session public API: `onFrameOut`, `receiveFrame`, `sendData`, `onChunk`, `onError`, `desiredSize`, `close`, `cancel`, `reset` — verified by reading source
- `src/framing/types.ts` — CapabilityFrame shape, FRAME_MARKER, PROTOCOL_VERSION — verified by reading source
- `src/framing/encode-decode.ts` — `encode()`/`decode()` pure functions, null-return semantics — verified by reading source
- `src/transport/endpoint.ts` — PostMessageEndpoint interface — verified by reading source
- `.planning/research/ARCHITECTURE.md` — Channel layer design, relay invariants, backpressure model — HIGH (established project research)
- `.planning/research/PITFALLS.md` — DataCloneError pitfall, enqueue() advisory pitfall, credit deadlock — HIGH (established project research)
- `.planning/phases/02-session-protocol-core/02-05-SUMMARY.md` — Session.close() finalSeq stub, known deviations — HIGH (project record)

### Secondary (MEDIUM confidence)

- Node 22 WHATWG Streams global availability — verified via `node -e "console.log(typeof ReadableStream)"` returning `'function'`
- WritableStream `write()` Promise chain semantics — verified via live Node 22 experiment (sink returning pending Promise blocks `writer.write()` caller)
- ReadableStream `pull()` call-on-demand semantics — verified via live Node 22 experiment (pull called only when desiredSize > 0)

### Tertiary (LOW confidence)

- Browser DataCloneError async vs sync distinction — only synchronous behavior confirmed in Node; browser behavior assumed synchronous per spec but not verified with real browser in this research session

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all existing tooling verified present
- Architecture: HIGH — Channel design derived from ARCHITECTURE.md + verified Session API + live Node experiments
- WHATWG Streams wiring: HIGH — backpressure mechanism verified live in Node 22 (`sink.write()` returning pending Promise)
- Node MessageChannel semantics: HIGH — all five relevant properties verified live (detach, sync DataCloneError, MessageEvent shape, onmessage auto-start, no .start() needed)
- finalSeq stub: HIGH — confirmed by reading Phase 2 SUMMARY.md
- DataCloneError async browser case: LOW — not testable in Node, browser behavior unverified in this session

**Research date:** 2026-04-21
**Valid until:** 2026-05-21 (30 days — stable WHATWG Streams spec, stable Node 22 behavior)
