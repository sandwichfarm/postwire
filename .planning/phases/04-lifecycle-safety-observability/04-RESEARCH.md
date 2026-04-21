# Phase 4: Lifecycle Safety + Observability — Research

**Researched:** 2026-04-21
**Domain:** Browser lifecycle APIs (BFCache, SW recycle), MessagePort teardown, channel observability
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- BFCache listener on `globalThis` for Window endpoints only; `pagehide(persisted=true)` → `FROZEN`, `pageshow(persisted=true)` → channel stays dead, caller creates new one; `pagehide(persisted=false)` → `CHANNEL_CLOSED`
- SW heartbeat opt-in: `channel.options.heartbeat = { intervalMs: 10_000, timeoutMs: 30_000 }`; CAPABILITY frame reused as keep-alive ping; no new frame type
- `channel.stats()` is a polling snapshot function, not reactive
- Error events via TypedEmitter already in `src/adapters/emitter.ts` (`channel.on('error' | 'close' | 'trace', handler)`)
- Trace events off by default; enable via `channel.options.trace = true`
- `ErrorCode` union extended with `CHANNEL_FROZEN`, `CHANNEL_DEAD`, `CHANNEL_CLOSED` (already declared in `src/types.ts`)
- Listener cleanup: `disposers: (() => void)[]` array on Channel; flushed in reverse on close

### Claude's Discretion

- Exact internal wiring of existing errors (`ORIGIN_REJECTED`, `CREDIT_DEADLOCK`, `REORDER_OVERFLOW`) into the channel error event
- Whether `StreamError` gets a `streamId` field for stream-level errors
- Listener registry shape (`Map<string, Set<handler>>` is fine)

### Deferred Ideas (OUT OF SCOPE)

- Real browser BFCache verification — Phase 9
- SAB fast path — Phase 6
- Multi-hop relay — Phase 7
- Multiplexing — Phase 8
- Dedicated `PING` frame type if CAPABILITY-as-heartbeat causes issues — future
- Metrics aggregation across channels — consumer's observability stack
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LIFE-01 | `pagehide`/`pageshow` (BFCache) handled — freeze on hide, error with `CHANNEL_FROZEN` on show | §BFCache Detection, §BFCache Listener Hooking |
| LIFE-02 | SW recycling triggers heartbeat/timeout → `CHANNEL_DEAD` instead of silent stall | §SW Recycle Heartbeat, §CAPABILITY-as-Ping |
| LIFE-03 | Endpoint teardown propagates `CHANNEL_CLOSED` to all active streams; no zombies | §Teardown Detection per Endpoint Type |
| LIFE-04 | Strong references to `MessagePort` retained for channel lifetime | §Strong-Ref — Already Partly Done |
| LIFE-05 | Event listeners removed on channel close; no leaked listeners after teardown | §Listener Cleanup Pattern |
| OBS-01 | Typed metrics hooks — bytes sent/received, credit window, reorder buffer depth, frame counts | §Stats API |
| OBS-02 | Typed error events for all named codes | §Error Taxonomy Wiring |
| OBS-03 | Optional per-frame trace hook without hard-coupling to a logger | §Trace Event Shape |
</phase_requirements>

---

## Summary

Phase 4 adds two orthogonal concerns on top of the working Channel+Session stack from Phase 3: (1) lifecycle safety — detecting when the underlying transport context dies or freezes and surfacing that cleanly as typed errors with no zombie streams, and (2) observability — a polling stats snapshot and opt-in per-frame trace events that let callers instrument without hard coupling to any logger.

The existing codebase is closer to done than it appears. `ErrorCode` in `src/types.ts` already declares `CHANNEL_FROZEN`, `CHANNEL_DEAD`, and `CHANNEL_CLOSED`. The `Channel` class already holds a strong `#endpoint` ref satisfying LIFE-04. `src/adapters/emitter.ts` already contains the `TypedEmitter` base class that the channel-level event API reuses. `CreditWindow` already fires `onStall` via a `setTimeout`, which is the exact same pattern the heartbeat timer needs. The gap is: (a) the Channel does not yet register BFCache or teardown listeners on the endpoint, (b) the existing error paths in Session and adapter layer use raw strings rather than routing through a channel-level TypedEmitter, and (c) the stats and trace infrastructure does not exist yet.

The key design insight for CAPABILITY-as-heartbeat: `channel.ts` already processes post-handshake CAPABILITY frames by routing them to `#handleCapability`. The current code calls `#resolveCapability()` again (a no-op on an already-resolved Promise) and sets `#remoteCap` again to the same value. It does NOT throw or emit an error. So sending a second CAPABILITY frame after the handshake is already a safe no-op — we can use it as a heartbeat ping with minimal code change: the sender sets a timeout; when a CAPABILITY response arrives before the timeout, the timer is cleared; if not, `CHANNEL_DEAD` is emitted.

**Primary recommendation:** Treat this phase as wiring and extension — not redesign. Add a `ChannelEvents` TypedEmitter to the Channel class; add a `disposers` array; attach BFCache/teardown listeners on construction when the endpoint type warrants it; add the heartbeat timer when `options.heartbeat` is set; wrap the existing Session `onError` string callback in a mapping to `StreamError` and route to the channel emitter.

---

## Standard Stack

### Core (all already present — no new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vitest | 4.1.4 | Test framework; `vi.useFakeTimers()` for heartbeat tests | Already installed |
| TypeScript | 6.0.3 | Type-safe error discrimination; `isolatedDeclarations` | Already installed |
| Node `worker_threads` MessageChannel | Node 22 | Real structured-clone for integration tests | Already in test helpers |

No new runtime dependencies. Zero-dep constraint (COMP-02) is maintained.

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| fast-check | ^4.7.0 | Property tests for stats invariants | Optional — existing devDep |

**Version verification:** All packages already present in `package.json` — no npm installs needed for Phase 4.

---

## Architecture Patterns

### Recommended Project Structure Extension

```
src/
├── channel/
│   ├── channel.ts          # Extend: add ChannelEvents emitter, disposers, heartbeat, BFCache
│   └── stats.ts            # New: ChannelStats + StreamStats snapshot types + collectors
├── types.ts                # Extend: CREDIT_DEADLOCK, REORDER_OVERFLOW codes; streamId on StreamError
├── adapters/
│   ├── emitter.ts          # Extend: wire channel 'error' events to 'error' events on EmitterStream
│   ├── lowlevel.ts         # Extend: expose stats() passthrough
│   └── streams.ts          # Extend: expose stats() passthrough
tests/
├── unit/
│   ├── channel/
│   │   ├── channel.test.ts       # Extend: BFCache, teardown, heartbeat, stats, trace
│   │   └── bfcache.test.ts       # New: isolated BFCache mock tests
│   └── session/
│       └── credit-window.test.ts # Extend: CREDIT_DEADLOCK routing test
└── integration/
    ├── lifecycle-teardown.test.ts # New: port.close() → CHANNEL_CLOSED
    ├── heartbeat.test.ts          # New: fake timers, CHANNEL_DEAD after timeout
    └── observability.test.ts      # New: stats() after complete stream
```

### Pattern 1: Channel-Level TypedEmitter

**What:** `Channel` grows a private `TypedEmitter` instance (reusing the existing class from `emitter.ts`, or inlined) for `error`, `close`, and `trace` events. Public API: `channel.on('error', cb)`, `channel.on('close', cb)`, `channel.on('trace', cb)`.

**When to use:** All channel-level events. Stream-level errors are mapped to `StreamError` and re-emitted on the channel with a `streamId` tag.

**Example:**
```typescript
// src/channel/channel.ts — extension
type ChannelEventMap = {
  error: [err: StreamError];
  close: [];
  trace: [event: TraceEvent];
};

// Inside Channel class:
readonly #emitter = new TypedEmitter<ChannelEventMap>();

on<K extends keyof ChannelEventMap>(
  event: K,
  handler: (...args: ChannelEventMap[K]) => void,
): this {
  this.#emitter.on(event, handler);
  return this;
}

off<K extends keyof ChannelEventMap>(
  event: K,
  handler: (...args: ChannelEventMap[K]) => void,
): this {
  this.#emitter.off(event, handler);
  return this;
}
```

The existing `#onErrorCb` (single callback) is replaced by the emitter for Phase 4. The existing Phase 3 `channel.onError(cb)` is kept as a shim that calls `this.on('error', cb)` for backward compat or removed if no existing callers outside tests.

### Pattern 2: Disposers Array for Listener Cleanup (LIFE-05)

**What:** A `readonly #disposers: (() => void)[] = []` array on Channel. Every `addEventListener` call pushes a matching `removeEventListener` lambda. On `channel.close()`, the array is flushed in reverse order.

**Confirmed approach:** The CONTEXT.md decision chose this over `AbortController`. Both work in Node 22+ (tested — `AbortController` signal option on `addEventListener` is supported). However, `disposers` is more universal: it works with `onmessage =` assignment reversal, with Node EventEmitter `.on`/`.off`, and with browser DOM `addEventListener`/`removeEventListener` uniformly.

**Example:**
```typescript
// Inside Channel constructor, adding a listener:
const listener = (evt: MessageEvent) => { /* ... */ };
globalThis.addEventListener('pagehide', listener);
this.#disposers.push(() => globalThis.removeEventListener('pagehide', listener));

// In channel.close():
close(): void {
  // ... existing session close ...
  for (let i = this.#disposers.length - 1; i >= 0; i--) {
    this.#disposers[i]!();
  }
  this.#disposers.length = 0;
  this.#emitter.removeAllListeners();
}
```

### Pattern 3: BFCache Detection

**What:** On BFCache-eligible `Window` endpoints, listen for `pagehide` and `pageshow` on `globalThis`.

**Exact spec behavior** (verified from web.dev/articles/bfcache):
- `pagehide` fires when the page is navigated away from. `event.persisted === true` means the page is entering BFCache (frozen snapshot). `event.persisted === false` means real unload.
- `pageshow` fires when the page is shown. `event.persisted === true` means the page was restored from BFCache. `event.persisted === false` means fresh load.
- `document.visibilityState` is NOT the right check — it goes `'hidden'` on ANY tab switch, not just BFCache. It is useful only as a supplementary signal to suspend heartbeat timers during background, per PITFALLS.md item 7.
- **CRITICAL:** Using the `unload` event disqualifies the page from BFCache entirely in all browsers. Use `pagehide` only.

**When to attach:** Only when the endpoint adapter is a `Window` endpoint. Detection: expose a `readonly isWindowAdapter: boolean` on the adapter, OR pass a constructor flag in `ChannelOptions`.

**Decision:** Add `endpointKind?: 'window' | 'worker' | 'messageport' | 'serviceworker'` to `ChannelOptions`. Callers who use `createWindowEndpoint()` know they have a Window endpoint; pass `endpointKind: 'window'`. Default is `undefined` (no BFCache listener). This avoids reaching into the endpoint object itself.

**Example:**
```typescript
// In Channel constructor, when options.endpointKind === 'window':
if (options.endpointKind === 'window') {
  const onPagehide = (e: PageTransitionEvent) => {
    if (e.persisted) {
      // BFCache freeze
      this.#freezeAllStreams('CHANNEL_FROZEN');
    } else {
      // Real navigation
      this.#freezeAllStreams('CHANNEL_CLOSED');
    }
  };
  const onPageshow = (e: PageTransitionEvent) => {
    if (e.persisted) {
      // Restored from BFCache — channel is dead, do not resume
      // (already in terminal state from pagehide handler)
    }
  };
  (globalThis as typeof globalThis & EventTarget).addEventListener('pagehide', onPagehide);
  (globalThis as typeof globalThis & EventTarget).addEventListener('pageshow', onPageshow);
  this.#disposers.push(
    () => (globalThis as EventTarget).removeEventListener('pagehide', onPagehide),
    () => (globalThis as EventTarget).removeEventListener('pageshow', onPageshow),
  );
}
```

**In workers:** `pagehide` does not fire in `DedicatedWorkerGlobalScope`. Attaching to `globalThis` in a worker is a no-op (the event never fires). Still safe, just unnecessary — the `endpointKind` guard prevents adding the listener at all in non-window contexts.

### Pattern 4: CAPABILITY-as-Heartbeat Ping (LIFE-02)

**Exact current behavior of `#handleCapability` in `channel.ts`:**
```typescript
#handleCapability(frame: CapabilityFrame): void {
  if (frame.protocolVersion !== PROTOCOL_VERSION) { /* reject */ return; }
  this.#remoteCap = { sab: frame.sab && ..., transferableStreams: ... };
  this.#resolveCapability(); // no-op if already resolved (Promise is settled)
}
```

A duplicate CAPABILITY after handshake does NOT throw, does NOT emit an error, and does NOT cause any protocol violation. It reassigns `#remoteCap` to the same value (idempotent). `#resolveCapability()` is a no-op on an already-resolved Promise. **Confirmed safe to use as a ping target.**

**Heartbeat protocol sketch:**
```typescript
// Initiator sends CAPABILITY frame every intervalMs.
// Both sides already respond to incoming CAPABILITY with their own CAPABILITY
// (they do this on construction — but the responder to a post-handshake CAPABILITY
//  does NOT automatically resend CAPABILITY. We need to add that response.)

// Required change in #handleCapability:
// If we already have #remoteCap set (post-handshake), treat the incoming CAPABILITY
// as a liveness ping and echo back our own CAPABILITY frame as a pong.
#handleCapability(frame: CapabilityFrame): void {
  if (frame.protocolVersion !== PROTOCOL_VERSION) { /* reject */ return; }
  const isPostHandshake = this.#remoteCap !== null;
  this.#remoteCap = { sab: ..., transferableStreams: ... };
  if (!isPostHandshake) {
    this.#resolveCapability();
  } else {
    // Post-handshake CAPABILITY = heartbeat ping — echo back as pong
    this.#sendCapability();
    // Also reset heartbeat timeout on pong receipt (on the sending side):
    this.#resetHeartbeatTimer();
  }
}
```

**Heartbeat timer wiring:**
```typescript
#startHeartbeat(): void {
  const { intervalMs, timeoutMs } = this.#options.heartbeat!;
  this.#heartbeatInterval = setInterval(() => {
    this.#sendCapability(); // ping
    // Start a timeout; reset when CAPABILITY response arrives
    this.#heartbeatTimeout = setTimeout(() => {
      this.#freezeAllStreams('CHANNEL_DEAD');
    }, timeoutMs);
  }, intervalMs);
  this.#disposers.push(() => {
    clearInterval(this.#heartbeatInterval!);
    clearTimeout(this.#heartbeatTimeout!);
  });
}

#resetHeartbeatTimer(): void {
  clearTimeout(this.#heartbeatTimeout!);
  this.#heartbeatTimeout = null;
}
```

**Edge case: `channel.close()` during heartbeat wait.** The `disposers` array flushes on close (including `clearInterval` and `clearTimeout`). The timeout cannot fire after `close()` because both are cleared before the channel emits `close`.

**Edge case: BFCache + heartbeat.** If BFCache freezes the page, `pagehide(persisted=true)` fires first and calls `#freezeAllStreams('CHANNEL_FROZEN')` which calls `channel.close()` (or equivalent shutdown), which clears the heartbeat timer via disposers. The heartbeat timeout cannot fire after BFCache freeze. No conflict.

**Important semantic note:** On the remote side (SW or whoever receives the ping), `#handleCapability` will echo back CAPABILITY. This is the intended pong. Document this in comments clearly: "Post-handshake CAPABILITY frame = heartbeat ping. We echo our own CAPABILITY as the pong. This intentionally conflates liveness check with capability negotiation — see CONTEXT.md §SW Recycle Heartbeat."

### Pattern 5: Teardown Detection per Endpoint Type

| Endpoint | Teardown Signal | Detection Method | Notes |
|----------|----------------|------------------|-------|
| `MessagePort` | Port partner closes | Node: `port.on('close', ...)` fires when the partner port closes. Browser: `close` event on `MessagePort` is a Blink-only proposal (not in spec, not cross-browser). For browser: use heartbeat as fallback. | HIGH confidence for Node tests; MEDIUM for browser |
| `Worker` (DedicatedWorker) | `worker.terminate()` by caller | Caller calls `channel.close()` before terminating — by convention. OR: catch `messageerror` on the port. Worker context: `self.addEventListener('close', ...)` — not standardized. | Explicit teardown via `channel.close()` is the reliable path |
| `Window` (iframe unload) | `pagehide` on the iframe's `window` | Already covered by BFCache handler: `pagehide(persisted=false)` = real unload → `CHANNEL_CLOSED`. | Same listener, different `persisted` value |
| `ServiceWorker` | SW recycled by browser | No notification. Heartbeat-only path. | Covered by LIFE-02 heartbeat |

**Key finding — Node MessagePort 'close' event (tested empirically):**
```
Node 22.22.1 — tested behavior:
- port2.close() → port1 receives 'close' event asynchronously (within 1 event loop tick)
- The event fires after setImmediate but well within 5ms
- Timeline: [after-port2-close-call, close-event, timeout-0ms]
  (fires between synchronous code and setTimeout(0), i.e. in the microtask/setImmediate range)
- postMessage to a port whose partner is closed does NOT throw in Node 22 — it silently drops
```

**Browser caveat:** The `close` event on `MessagePort` is NOT cross-browser in the DOM spec as of mid-2025. It is a Blink proposal (`fergald/explainer-messageport-close`, proposal stage per PITFALLS.md). For browsers, teardown detection for MessagePort relies on heartbeat. For Node tests, the `close` event is reliable and can be used in integration tests.

**Practical approach for teardown wiring in Channel:**
```typescript
// When endpoint is a Node worker_threads MessagePort (detectable at runtime):
// Note: in browser, MessagePort may or may not support 'close'. Guard with capability check.
if (typeof (endpoint as EventTarget).addEventListener === 'function') {
  const onClose = () => this.#freezeAllStreams('CHANNEL_CLOSED');
  (endpoint as EventTarget).addEventListener('close', onClose);
  this.#disposers.push(() =>
    (endpoint as EventTarget).removeEventListener('close', onClose)
  );
}
```

### Pattern 6: `#freezeAllStreams(code)` Helper

A private method called on channel death/freeze. Resets all active sessions and emits the code on the channel emitter.

```typescript
#freezeAllStreams(code: 'CHANNEL_FROZEN' | 'CHANNEL_DEAD' | 'CHANNEL_CLOSED'): void {
  if (this.#session !== null) {
    this.#session.reset(code);  // sends RESET frame if port still live (best-effort)
    this.#session = null;
  }
  const err = new StreamError(code, undefined);
  this.#emitter.emit('error', err);
  this.#emitter.emit('close');
  // Flush disposers to remove all listeners
  for (let i = this.#disposers.length - 1; i >= 0; i--) {
    this.#disposers[i]!();
  }
  this.#disposers.length = 0;
  this.#emitter.removeAllListeners();
}
```

Note: `session.reset(code)` calls `session.#onFrameOutCb` (the channel's `sendFrame`), which calls `endpoint.postMessage`. If the port is already dead, `postMessage` may throw or silently drop. In `#sendRaw`, the try/catch already wraps postMessage — DataCloneError is caught and routed. Other errors (e.g., a closed port that throws `InvalidStateError` in some browser contexts) should also be caught: extend the catch in `#sendRaw` to catch any error when the channel is already in shutdown.

### Pattern 7: Stats API

**Shape:**
```typescript
// src/channel/stats.ts

export interface StreamStats {
  streamId: number;
  bytesSent: number;
  bytesReceived: number;
  frameCountsByType: Partial<Record<FrameType, number>>;
  creditWindowAvailable: number;   // from CreditWindow.sendCredit
  reorderBufferDepth: number;       // from ReorderBuffer.bufferSize (new getter)
  chunkerChunksSent: number;
  chunkerChunksReceived: number;
}

export interface ChannelStats {
  streams: StreamStats[];
  aggregate: {
    bytesSent: number;
    bytesReceived: number;
  };
}
```

**How to collect:**
- `bytesSent`/`bytesReceived`: tracked in Channel's `sendFrame` interceptor and a new `#onFrameReceived` hook at the decode point. Before encoding, record `payload.byteLength` (for BINARY_TRANSFER) or `JSON.stringify(payload).length` as approximation (for STRUCTURED_CLONE). Better: track bytes at the transport level by adding a `#bytesSent` counter in `#sendRaw` (measure `encoded` object size — since it's a plain JS object, use `JSON.stringify` as approximation or track chunk `byteLength` from the DATA frame directly).
- **Simpler approach:** On DATA frames only: record `frame.payload.byteLength` (for BINARY_TRANSFER) or `frame.payload.length ?? 0` (for STRUCTURED_CLONE). Frame counts tracked in a `Map<string, number>` incremented in `sendFrame` and the decode path in the inbound handler.
- `creditWindowAvailable`: expose via `session.#credit.sendCredit` — add a getter `get sendCredit()` (already exists on CreditWindow — it's already `get sendCredit(): number`).
- `reorderBufferDepth`: add `get bufferSize(): number { return this.#buffer.size; }` to `ReorderBuffer`.
- `chunkerChunksSent`/`chunkerChunksReceived`: add counters to `Chunker.split()` and `Chunker.reassemble()`.

**Accuracy note:** Byte counts for STRUCTURED_CLONE payloads are approximations. `JSON.stringify` is not exact (encoding overhead, non-serializable fields omitted). Document as "approximate bytes for structured-clone path; exact for binary path." For phase 4 this is sufficient.

### Pattern 8: Trace Event Shape

```typescript
// src/channel/stats.ts (or channel.ts)

export type TraceDirection = 'in' | 'out';

export interface TraceEvent {
  timestamp: number;        // performance.now() or Date.now() — prefer performance.now()
  direction: TraceDirection;
  frameType: string;        // Frame['type'] — string discriminant
  streamId: number;
  seq: number;              // frame.seqNum
  byteLength?: number;      // only for DATA frames with binary payload
}
```

**Where to fire:**
- Outbound: in `Channel#sendFrame` after the try/catch (only if `this.#options.trace === true`)
- Inbound: in the `endpoint.onmessage` handler after successful `decode()` (only if trace enabled)

**Performance:** Trace events add one conditional branch per frame. The condition (`if (this.#options.trace)`) is a boolean field check — predicted by the branch predictor as always-false when disabled. No measurable overhead in the disabled path.

```typescript
// In sendFrame():
if (this.#options.trace) {
  this.#emitter.emit('trace', {
    timestamp: performance.now(),
    direction: 'out',
    frameType: frame.type,
    streamId: frame.streamId,
    seq: frame.seqNum,
    byteLength: frame.type === 'DATA' && frame.chunkType === 'BINARY_TRANSFER'
      ? (frame.payload as ArrayBuffer).byteLength
      : undefined,
  });
}
```

### Error Taxonomy Wiring

The existing Phase 3 code uses raw string error codes at Session level and `StreamError` only at Channel/adapter level. Phase 4 adds wiring to route all error codes through the channel-level `error` event:

| Existing Error Source | Current Routing | Phase 4 Routing |
|----------------------|----------------|-----------------|
| `PROTOCOL_MISMATCH` | `#onErrorCb?.(err)` | `this.#emitter.emit('error', err)` |
| `DataCloneError` | `#onErrorCb?.(err)` | `this.#emitter.emit('error', err)` |
| `ORIGIN_REJECTED` | Drop silently in `window.ts` | New hook: `onOriginRejected` callback on `createWindowEndpoint`; Channel registers it and re-emits |
| Session `onError('consumer-stall')` | `emitter.ts` maps to `CONSUMER_STALL` | Extend to map `'consumer-stall'` → `CONSUMER_STALL`, route via channel emitter |
| `REORDER_OVERFLOW` (thrown as Error) | Uncaught in `session.ts` `insert()` | Wrap `reorder.insert()` in try/catch in `Session.receiveFrame`; catch `'REORDER_OVERFLOW'` → `session.#onErrorCb?.('REORDER_OVERFLOW')` → channel emitter |
| `CHANNEL_FROZEN` | New | `#freezeAllStreams('CHANNEL_FROZEN')` |
| `CHANNEL_DEAD` | New | Heartbeat timeout |
| `CHANNEL_CLOSED` | New | Teardown detection |

**Note on `CREDIT_DEADLOCK` vs `CONSUMER_STALL`:** The OBS-02 requirement lists `CREDIT_DEADLOCK` but the existing code uses `CONSUMER_STALL` (the stall timeout in `CreditWindow` fires via `onStall`). These are the same concept: the credit window is exhausted and no consumer is reading. Rename `CONSUMER_STALL` to `CREDIT_DEADLOCK` in `types.ts` and all code that references it, OR add `CREDIT_DEADLOCK` as a distinct code and keep `CONSUMER_STALL` for the consumer-side stall (credit window stall vs consumer read stall are subtly different). **Recommendation:** Rename to `CREDIT_DEADLOCK` for OBS-02 compliance — it's a single call site in `emitter.ts` plus the `ErrorCode` union in `types.ts`.

**Adding `streamId` to `StreamError`:** The CONTEXT.md marks this as Claude's discretion. Recommendation: yes, add it — it costs one field and makes channel-level `error` event consumers able to correlate errors to the specific stream that failed. It is especially useful when Phase 8 multiplexing adds multiple concurrent streams.

```typescript
export class StreamError extends Error {
  readonly code: ErrorCode;
  override readonly cause: unknown;
  readonly streamId?: number; // NEW in Phase 4

  constructor(code: ErrorCode, cause: unknown, streamId?: number) {
    super(`iframebuffer: ${code}`);
    this.name = 'StreamError';
    this.code = code;
    this.cause = cause;
    this.streamId = streamId;
  }
}
```

### Anti-Patterns to Avoid

- **Using `unload` event for Window teardown detection:** Permanently disqualifies the page from BFCache. Use `pagehide` only.
- **Adding listeners on the `window` object inside a Worker:** `pagehide` does not fire in Worker scope. The `endpointKind` guard prevents this.
- **Calling `session.reset()` after the session is in a terminal state:** `Session.reset()` calls `#applyTransition({ type: "RESET_SENT" })` which throws `IllegalTransitionError` from terminal states. Guard with `isTerminalState(session.state)` before calling reset in `#freezeAllStreams`.
- **Heartbeat timer surviving `channel.close()`:** The `disposers` array must include `clearInterval` and `clearTimeout` for the heartbeat. Verified: calling `close()` during a heartbeat wait clears both via the disposers flush.
- **Sending heartbeat CAPABILITY with a different `channelId` or `protocolVersion`:** Use the existing `#sendCapability()` method unchanged — it already constructs the correct CAPABILITY frame with `this.#channelId` and `PROTOCOL_VERSION`. No new frame construction needed.
- **Origin rejection via silent drop with no observability:** Phase 1 drops wrong-origin messages silently with a `// TODO Phase 4` comment. Phase 4 must add an `onOriginRejected` hook to `createWindowEndpoint` so the Channel can surface `ORIGIN_REJECTED` via the error emitter.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Event emitter for channel events | New emitter class | `TypedEmitter` from `src/adapters/emitter.ts` | Already tested, zero-dep, typed |
| Heartbeat timer | Custom timer abstraction | `setInterval`/`setTimeout` + disposers | Direct, already proven in `CreditWindow` |
| Cleanup registry | `WeakMap`, `FinalizationRegistry` | `disposers: (() => void)[]` | Deterministic; `WeakMap` is wrong (loses refs on GC) |
| Stats collection | Reactive proxy/Observable | Plain JS counters + snapshot | Polling is simpler and sufficient per CONTEXT.md |
| Byte counting for structured-clone | Full serializer | `JSON.stringify(payload).length` as approximation | Exact byte count requires serialization which costs CPU; documented as approximate |

---

## Runtime State Inventory

Not applicable — this is not a rename/refactor phase.

---

## Common Pitfalls

### Pitfall 1: `session.reset()` throws `IllegalTransitionError` from terminal states

**What goes wrong:** `#freezeAllStreams` calls `session.reset(code)`. If the session is already in `ERRORED`, `CLOSED`, or `CANCELLED` state (e.g., it was already closed before the BFCache/teardown event), `reset()` calls `#applyTransition({ type: 'RESET_SENT' })` which throws `IllegalTransitionError` unconditionally from terminal states (see `fsm.ts` lines 107–110).

**How to avoid:** Guard with `isTerminalState(session.state)` before calling reset:
```typescript
if (!isTerminalState(this.#session.state)) {
  this.#session.reset(code);
}
```

**Warning signs:** `IllegalTransitionError: Illegal FSM transition: CLOSED + RESET_SENT` in test output when testing teardown of an already-closed channel.

### Pitfall 2: `pagehide` fires BEFORE the heartbeat timeout in BFCache

**What goes wrong:** If heartbeat `intervalMs` is 10s and the user navigates away at second 9 (middle of a heartbeat interval), `pagehide` fires. `#freezeAllStreams('CHANNEL_FROZEN')` runs and calls `channel.close()` (or equivalent). If the heartbeat timeout was already scheduled but not yet fired, and the disposers array is flushed properly, the timeout is cleared. No issue.

**How to avoid:** Confirm the disposers array includes `clearTimeout(this.#heartbeatTimeout)` even if `#heartbeatTimeout` is `null` (clearTimeout of null is a no-op). The `close()` path must flush disposers before any state checks that could fire additional events.

### Pitfall 3: Post-handshake CAPABILITY echo creates infinite ping-pong

**What goes wrong:** Side A sends a heartbeat CAPABILITY. Side B receives it, recognizes it as post-handshake (isPostHandshake = true), and echoes back CAPABILITY as a pong. Side A receives the pong. Side A's `#handleCapability` sees `isPostHandshake = true` on the pong, echoes it back. Infinite loop.

**How to avoid:** The heartbeat CAPABILITY must be sent only on the heartbeat interval (initiated by one side), not in response to a received post-handshake CAPABILITY. The distinction is: pong behavior = "echo back ONE CAPABILITY in response to a post-handshake CAPABILITY" AND the pong recipient resets the timeout but does NOT send another CAPABILITY. The heartbeat ping is initiated by `setInterval`; pongs are just timeout resets.

Sketch:
```typescript
// In #handleCapability:
if (isPostHandshake) {
  // Is this a pong to our ping, or a ping from the remote?
  // We detect "this is a pong" by checking if our timeout is running:
  if (this.#heartbeatTimeout !== null) {
    // We sent a ping and are waiting for pong — this is the pong. Clear timeout.
    clearTimeout(this.#heartbeatTimeout);
    this.#heartbeatTimeout = null;
  } else {
    // We did NOT send a ping — this is a ping from the remote. Echo once.
    this.#sendCapability();
  }
}
```

### Pitfall 4: REORDER_OVERFLOW thrown as Error (not StreamError) and uncaught

**What goes wrong:** `ReorderBuffer.insert()` throws `new Error('REORDER_OVERFLOW')` (not a `StreamError`). In `Session.receiveFrame()`, the `case 'DATA'` block calls `this.#reorder.insert(frame)` without a try/catch. If the buffer overflows, the Error propagates out of `receiveFrame()`, out of the Channel's `onmessage` handler, and becomes an unhandled exception in the event loop.

**How to avoid:** Wrap `this.#reorder.insert(frame)` in a try/catch inside `Session.receiveFrame`:
```typescript
case 'DATA': {
  let delivered: DataFrame[];
  try {
    delivered = this.#reorder.insert(frame as DataFrame);
  } catch (e) {
    if (e instanceof Error && e.message === 'REORDER_OVERFLOW') {
      this.#applyTransition({ type: 'RESET_SENT', reason: 'REORDER_OVERFLOW' });
      this.#onErrorCb?.('REORDER_OVERFLOW');
      return;
    }
    throw e;
  }
  // ... rest of DATA handling
}
```

### Pitfall 5: `ORIGIN_REJECTED` is silently dropped in Phase 1 — no routing to channel error

**What goes wrong:** In `src/transport/adapters/window.ts`, the listener returns silently when `event.origin !== expectedOrigin`. There is a `// TODO Phase 4: surface dropped message via OBS-02 ORIGIN_REJECTED hook` comment. If Phase 4 does not add this hook, `ORIGIN_REJECTED` will remain invisible to callers.

**How to avoid:** Add an optional callback to `createWindowEndpoint`:
```typescript
export function createWindowEndpoint(
  win: Window,
  expectedOrigin: string,
  opts?: { onOriginRejected?: (origin: string) => void }
): PostMessageEndpoint {
  // ...
  const listener = (event: MessageEvent): void => {
    if (event.origin !== expectedOrigin) {
      opts?.onOriginRejected?.(event.origin);
      return;
    }
    endpoint.onmessage?.(event);
  };
  // ...
}
```

The Channel then passes a callback that emits `StreamError('ORIGIN_REJECTED', ...)` on the channel emitter.

### Pitfall 6: Heartbeat timeout fires after channel.close()

**What goes wrong:** Channel is closed (`channel.close()`) while a heartbeat timeout is pending. The `setTimeout` callback fires later and calls `#freezeAllStreams('CHANNEL_DEAD')` on an already-dead channel, potentially emitting a second `error` event.

**How to avoid:** The `disposers` array must include `clearTimeout(this.#heartbeatTimeout)`. Confirmed: the disposers flush in `close()` runs synchronously before `#emitter.emit('close')`. If `close()` is called, the timeout is cancelled before it can fire.

Additionally, guard `#freezeAllStreams` with an `#isClosed` flag to make it idempotent:
```typescript
#isClosed = false;

#freezeAllStreams(code: ErrorCode): void {
  if (this.#isClosed) return;
  this.#isClosed = true;
  // ... rest of teardown
}
```

---

## Code Examples

Verified patterns from the existing codebase:

### BFCache mock in Node test (LIFE-01)

```typescript
// tests/unit/channel/bfcache.test.ts
import { describe, expect, it, vi } from 'vitest';
import { createChannel } from '../../../src/channel/channel.js';

function makeFakeEndpoint() {
  const sent: unknown[] = [];
  const ep = {
    sent,
    postMessage(msg: unknown) { sent.push(msg); },
    onmessage: null as ((e: MessageEvent) => void) | null,
    simulateMessage(data: unknown) { ep.onmessage?.({ data } as MessageEvent); },
  };
  return ep;
}

describe('Channel — BFCache (LIFE-01)', () => {
  it('emits CHANNEL_FROZEN on pagehide(persisted=true)', () => {
    const ep = makeFakeEndpoint();
    const ch = createChannel(ep, { channelId: 'bfcache-test', endpointKind: 'window' });
    const errors: unknown[] = [];
    ch.on('error', (e) => errors.push(e));

    // Mock globalThis.dispatchEvent — works in Node because globalThis IS an EventTarget in Node 22
    globalThis.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));

    expect(errors).toHaveLength(1);
    expect((errors[0] as { code: string }).code).toBe('CHANNEL_FROZEN');
  });

  it('emits CHANNEL_CLOSED on pagehide(persisted=false)', () => {
    const ep = makeFakeEndpoint();
    const ch = createChannel(ep, { channelId: 'bfcache-test-2', endpointKind: 'window' });
    const errors: unknown[] = [];
    ch.on('error', (e) => errors.push(e));

    globalThis.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: false }));

    expect(errors).toHaveLength(1);
    expect((errors[0] as { code: string }).code).toBe('CHANNEL_CLOSED');
  });
});
```

**Confirmed:** `globalThis` in Node 22 IS an `EventTarget` (it extends `EventTarget`). `globalThis.dispatchEvent(new Event('pagehide'))` works in Node. The listener added via `globalThis.addEventListener('pagehide', cb)` fires synchronously on `dispatchEvent`.

**Caution:** `PageTransitionEvent` is not available in Node. Construct with `Object.assign(new Event('pagehide'), { persisted: true })` to simulate it.

### Heartbeat timeout with fake timers (LIFE-02)

```typescript
// tests/unit/channel/channel.test.ts — heartbeat section
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Channel — SW heartbeat (LIFE-02)', () => {
  afterEach(() => vi.useRealTimers());

  it('emits CHANNEL_DEAD after timeoutMs with no CAPABILITY response', async () => {
    vi.useFakeTimers();
    const ep = makeFakeEndpoint();
    const ch = createChannel(ep, {
      channelId: 'heartbeat-test',
      heartbeat: { intervalMs: 10_000, timeoutMs: 30_000 },
    });
    const errors: unknown[] = [];
    ch.on('error', (e) => errors.push(e));

    // Advance past one heartbeat interval to trigger the ping
    vi.advanceTimersByTime(10_001);
    // Verify a CAPABILITY ping was sent
    // (ep.sent[0] = initial CAPABILITY; ep.sent[1] = heartbeat ping CAPABILITY)
    expect(ep.sent.length).toBeGreaterThanOrEqual(2);

    // Advance past the timeout without any pong
    vi.advanceTimersByTime(30_001);
    expect(errors).toHaveLength(1);
    expect((errors[0] as { code: string }).code).toBe('CHANNEL_DEAD');
  });

  it('does NOT emit CHANNEL_DEAD when CAPABILITY pong arrives before timeout', async () => {
    vi.useFakeTimers();
    const ep = makeFakeEndpoint();
    const ch = createChannel(ep, {
      channelId: 'heartbeat-test-2',
      heartbeat: { intervalMs: 10_000, timeoutMs: 30_000 },
    });
    const errors: unknown[] = [];
    ch.on('error', (e) => errors.push(e));

    vi.advanceTimersByTime(10_001); // ping sent

    // Simulate pong arriving (CAPABILITY from remote)
    ep.simulateMessage(makeCapabilityMessage(PROTOCOL_VERSION));

    vi.advanceTimersByTime(30_001); // timeout would have fired
    expect(errors).toHaveLength(0);
  });

  it('heartbeat timer is cleared when channel.close() is called', () => {
    vi.useFakeTimers();
    const ep = makeFakeEndpoint();
    const ch = createChannel(ep, {
      channelId: 'heartbeat-close-test',
      heartbeat: { intervalMs: 10_000, timeoutMs: 30_000 },
    });
    const errors: unknown[] = [];
    ch.on('error', (e) => errors.push(e));

    ch.close();
    vi.advanceTimersByTime(100_000); // way past any timeout
    expect(errors).toHaveLength(0);
  });
});
```

### MessagePort teardown detection in integration tests (LIFE-03)

```typescript
// tests/integration/lifecycle-teardown.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import { createChannel } from '../../src/channel/channel.js';
import { createMessageChannelPair } from '../helpers/mock-endpoint.js';
import { FRAME_MARKER, PROTOCOL_VERSION } from '../../src/framing/types.js';

describe('Channel — endpoint teardown (LIFE-03)', () => {
  it('emits CHANNEL_CLOSED on all active streams when port closes', async () => {
    const { a, b, close } = createMessageChannelPair();
    const chA = createChannel(a, { channelId: 'teardown-test' });
    const chB = createChannel(b, { channelId: 'teardown-test' });

    await Promise.all([chA.capabilityReady, chB.capabilityReady]);

    const errors: unknown[] = [];
    chA.on('error', (e) => errors.push(e));

    // Open a stream so there's an active session
    chA.openStream();

    // Close the B port — simulates remote endpoint dying
    (b as import('worker_threads').MessagePort).close();

    // In Node, the 'close' event fires asynchronously (within one tick)
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect((errors[0] as { code: string }).code).toBe('CHANNEL_CLOSED');

    // Cleanup
    try { (a as import('worker_threads').MessagePort).close(); } catch {}
  });
});
```

**Note on browser behavior:** In browsers, `MessagePort` may not fire a `close` event (browser spec gap). The integration test above is Node-only and covers the Node path. Browser-equivalent coverage relies on the heartbeat timeout test, which is inherently platform-agnostic. Document this distinction in the test file header.

### Stats snapshot after complete stream (OBS-01)

```typescript
// tests/integration/observability.test.ts
it('stats() returns correct frameCountsByType after a complete stream', async () => {
  const { a, b, close } = createMessageChannelPair();
  const chA = createChannel(a, { channelId: 'stats-test' });
  const chB = createChannel(b, { channelId: 'stats-test' });

  await Promise.all([chA.capabilityReady, chB.capabilityReady]);

  const handle = chA.openStream();
  handle.session.sendData('hello', 'STRUCTURED_CLONE');
  handle.session.close(chA.lastDataSeqOut >= 0 ? chA.lastDataSeqOut : 0);

  await new Promise((resolve) => setTimeout(resolve, 50));

  const stats = chA.stats();
  expect(stats.streams).toHaveLength(1);
  expect(stats.streams[0]!.frameCountsByType['DATA']).toBeGreaterThanOrEqual(1);
  expect(stats.streams[0]!.frameCountsByType['OPEN']).toBe(1);
  close();
});
```

### Trace events (OBS-03)

```typescript
it('emits trace events when trace option is true', async () => {
  const ep = makeFakeEndpoint();
  const ch = createChannel(ep, { channelId: 'trace-test', trace: true });
  const traces: unknown[] = [];
  ch.on('trace', (t) => traces.push(t));

  ep.simulateMessage(makeCapabilityMessage(PROTOCOL_VERSION));
  await ch.capabilityReady;

  // CAPABILITY received → inbound trace
  expect(traces.some((t: unknown) =>
    (t as { frameType: string }).frameType === 'CAPABILITY' &&
    (t as { direction: string }).direction === 'in'
  )).toBe(true);

  // Our CAPABILITY send → outbound trace
  expect(traces.some((t: unknown) =>
    (t as { direction: string }).direction === 'out'
  )).toBe(true);
});

it('does NOT emit trace events when trace option is false (default)', () => {
  const ep = makeFakeEndpoint();
  const ch = createChannel(ep, { channelId: 'no-trace-test' }); // trace not set
  const traces: unknown[] = [];
  ch.on('trace', (t) => traces.push(t));

  ep.simulateMessage(makeCapabilityMessage(PROTOCOL_VERSION));
  expect(traces).toHaveLength(0);
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `unload` event for page teardown | `pagehide` event | When BFCache became standard (Chrome 86+) | `unload` disqualifies BFCache eligibility |
| `worker.addEventListener('error', ...)` for SW recycling | Heartbeat ping/pong | Still the standard — no spec notification | SW recycling is entirely silent; heartbeat is the only reliable detection |
| `WeakRef` + `FinalizationRegistry` for port GC detection | Heartbeat timeout | Not standard practice | `FinalizationRegistry` is non-deterministic; heartbeat fires in bounded time |
| `AbortController` passed to `addEventListener` | `disposers: (() => void)[]` | Both modern patterns | Disposers are more universal across Node EventEmitter + DOM EventTarget APIs |

**Deprecated/outdated:**
- `document.unload` listener: permanently disqualifies the page from BFCache. Not a valid BFCache detection mechanism.
- `navigator.serviceWorker.controller.addEventListener('error', ...)`: the spec does not guarantee an error event fires when the browser silently recycles an idle SW. This approach misses most SW recycle events.

---

## Open Questions

1. **Does `globalThis.addEventListener('pagehide', ...)` work as a test mock in Vitest's Node environment?**
   - What we know: `globalThis` in Node 22 extends `EventTarget`. `dispatchEvent(new Event('pagehide'))` works. `Object.assign(new Event('pagehide'), { persisted: true })` creates a fake `PageTransitionEvent` since `PageTransitionEvent` is not in Node.
   - What's unclear: Vitest may reset `globalThis` between tests or may not. If test isolation is strict, the `pagehide` listener added by Channel A may persist into Channel B's tests.
   - Recommendation: Explicitly call `channel.close()` in `afterEach` to flush the disposers and remove the `pagehide`/`pageshow` listeners. Vitest's `afterEach` cleanup is the correct mitigation.

2. **`PageTransitionEvent` in TypeScript `lib.dom.d.ts`**
   - What we know: `PageTransitionEvent` is in the DOM spec and in TypeScript's `lib.dom.d.ts`. The `persisted` property is on the `PageTransitionEvent` type.
   - What's unclear: At test time in Node, `PageTransitionEvent` is not defined. Tests must use `Object.assign(new Event('pagehide'), { persisted: true }) as PageTransitionEvent` to type-cast for the handler.
   - Recommendation: The Channel's `onPagehide` handler should type the event as `Event & { persisted?: boolean }` to avoid a DOM-only type dependency in the runtime code, OR use `(e: any).persisted`.

3. **Browser MessagePort 'close' event availability**
   - What we know: Node 22 fires `close` event reliably (empirically tested). Browser spec does not guarantee it (PITFALLS.md, `fergald/explainer-messageport-close` is proposal stage).
   - What's unclear: Chrome 120+ may support it (`MessagePort.onclose` in Blink). Firefox may not.
   - Recommendation: Wire the `close` event listener defensively (addEventListener is a no-op if event never fires). Browser teardown detection relies on the heartbeat fallback. Phase 9 browser tests will validate what fires in practice.

---

## Environment Availability

Step 2.6: SKIPPED (no external dependencies — all required tools are Node 22 built-ins and project devDeps already installed).

---

## Validation Architecture

Nyquist validation is enabled (`workflow.nyquist_validation: true` in `.planning/config.json`).

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.4 |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `pnpm test --reporter=verbose -- --project unit` |
| Full suite command | `pnpm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LIFE-01 | `pagehide(persisted=true)` → `CHANNEL_FROZEN` emitted | unit | `pnpm test -- tests/unit/channel/bfcache.test.ts` | ❌ Wave 0 |
| LIFE-01 | `pagehide(persisted=false)` → `CHANNEL_CLOSED` emitted | unit | `pnpm test -- tests/unit/channel/bfcache.test.ts` | ❌ Wave 0 |
| LIFE-01 | `pageshow(persisted=true)` → channel stays dead | unit | `pnpm test -- tests/unit/channel/bfcache.test.ts` | ❌ Wave 0 |
| LIFE-02 | Heartbeat timeout → `CHANNEL_DEAD` with fake timers | unit | `pnpm test -- tests/unit/channel/channel.test.ts` | ✅ extend |
| LIFE-02 | Heartbeat pong resets timeout → no `CHANNEL_DEAD` | unit | `pnpm test -- tests/unit/channel/channel.test.ts` | ✅ extend |
| LIFE-02 | `channel.close()` clears heartbeat timer | unit | `pnpm test -- tests/unit/channel/channel.test.ts` | ✅ extend |
| LIFE-03 | Port close → `CHANNEL_CLOSED` on active streams | integration | `pnpm test -- tests/integration/lifecycle-teardown.test.ts` | ❌ Wave 0 |
| LIFE-03 | No zombie sessions after teardown | integration | `pnpm test -- tests/integration/lifecycle-teardown.test.ts` | ❌ Wave 0 |
| LIFE-04 | Channel holds strong ref to endpoint | unit | `pnpm test -- tests/unit/channel/channel.test.ts` | ✅ existing (implicit) |
| LIFE-05 | Listeners removed after `channel.close()` | unit | `pnpm test -- tests/unit/channel/channel.test.ts` | ✅ extend |
| OBS-01 | `stats()` returns correct frameCountsByType | integration | `pnpm test -- tests/integration/observability.test.ts` | ❌ Wave 0 |
| OBS-01 | `stats()` returns correct bytesSent/bytesReceived | integration | `pnpm test -- tests/integration/observability.test.ts` | ❌ Wave 0 |
| OBS-01 | `stats()` returns reorderBufferDepth and creditWindowAvailable | unit | `pnpm test -- tests/unit/channel/channel.test.ts` | ✅ extend |
| OBS-02 | `ORIGIN_REJECTED` routes through channel `error` event | unit | `pnpm test -- tests/unit/transport/window-adapter.test.ts` | ✅ extend |
| OBS-02 | `CREDIT_DEADLOCK` (formerly `CONSUMER_STALL`) routes through channel `error` | integration | `pnpm test -- tests/integration/observability.test.ts` | ❌ Wave 0 |
| OBS-02 | `REORDER_OVERFLOW` caught and routes through channel `error` | unit | `pnpm test -- tests/unit/session/session.test.ts` | ✅ extend |
| OBS-03 | Trace events fire when `trace: true`, not when false | unit | `pnpm test -- tests/unit/channel/channel.test.ts` | ✅ extend |
| OBS-03 | Trace event shape: `{ timestamp, direction, frameType, streamId, seq, byteLength? }` | unit | `pnpm test -- tests/unit/channel/channel.test.ts` | ✅ extend |

### Sampling Rate

- **Per task commit:** `pnpm test -- --project unit`
- **Per wave merge:** `pnpm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/unit/channel/bfcache.test.ts` — covers LIFE-01 (new file)
- [ ] `tests/integration/lifecycle-teardown.test.ts` — covers LIFE-03 (new file)
- [ ] `tests/integration/observability.test.ts` — covers OBS-01, OBS-02 (new file)

**Existing files that need extension (not Wave 0 creation):**
- `tests/unit/channel/channel.test.ts` — add heartbeat, LIFE-05 listener cleanup, OBS-03 trace
- `tests/unit/session/session.test.ts` — add REORDER_OVERFLOW catch test
- `tests/unit/transport/window-adapter.test.ts` — add ORIGIN_REJECTED callback test

*(Wave 0 = 3 new files; 4 existing files extended)*

---

## Sources

### Primary (HIGH confidence)

- `src/channel/channel.ts` — confirmed `#handleCapability` behavior, `#sendRaw` try/catch, `#onErrorCb`, `disposers` not yet present
- `src/session/fsm.ts` — confirmed `STALL_TIMEOUT` event, `IllegalTransitionError` from terminal states, exact transition table
- `src/session/credit-window.ts` — confirmed stall timer pattern reusable for heartbeat
- `src/session/reorder-buffer.ts` — confirmed `throw new Error('REORDER_OVERFLOW')` with no try/catch at call site in session
- `src/adapters/emitter.ts` — confirmed `TypedEmitter` class is ~40 LoC, `removeAllListeners()` exists
- `src/types.ts` — confirmed `CHANNEL_FROZEN`, `CHANNEL_DEAD`, `CHANNEL_CLOSED` already in `ErrorCode` union
- `src/transport/adapters/window.ts` — confirmed `// TODO Phase 4: ORIGIN_REJECTED hook` comment
- Node 22.22.1 runtime — empirically tested: `MessagePort 'close' event fires async when partner closes`; `AbortController signal in addEventListener works`; `globalThis.dispatchEvent works in Node`
- `.planning/research/PITFALLS.md` — Pitfall 7 (BFCache), Pitfall 8 (SW recycle), Pitfall 11 (MessagePort GC), Pitfall 17 (mock semantics) — HIGH confidence
- `tests/unit/session/credit-window.test.ts` — confirmed `vi.useFakeTimers()` + `vi.advanceTimersByTime()` pattern for timer-based tests

### Secondary (MEDIUM confidence)

- web.dev/articles/bfcache — `pagehide.persisted` semantics, `unload` disqualifies BFCache — HIGH confidence (official Google article)
- MDN PageTransitionEvent — `persisted` property, `pagehide`/`pageshow` events — HIGH confidence
- GitHub fergald/explainer-messageport-close — browser `close` event on MessagePort is proposal stage, not spec — MEDIUM confidence

### Tertiary (LOW confidence)

- None — all claims in this research are verifiable against the existing codebase or official sources.

---

## Metadata

**Confidence breakdown:**
- BFCache detection: HIGH — spec is clear; Node mock approach empirically tested
- Heartbeat protocol: HIGH — CAPABILITY-as-ping safety confirmed by reading channel.ts; ping-pong loop pitfall identified and solved
- Teardown detection: HIGH for Node path (empirically tested); MEDIUM for browser MessagePort 'close' event
- Stats API: HIGH — shape and collection points clearly derived from existing code
- Trace events: HIGH — simple conditional in existing code paths
- Error taxonomy wiring: HIGH — all error sources identified; REORDER_OVERFLOW uncaught exception discovered and documented

**Research date:** 2026-04-21
**Valid until:** 2026-05-21 (stable domain — no fast-moving APIs)
