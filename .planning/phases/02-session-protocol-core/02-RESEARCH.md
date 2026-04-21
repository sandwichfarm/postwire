# Phase 2: Session Protocol Core — Research

**Researched:** 2026-04-21
**Domain:** Per-stream session state — reorder buffer, credit window, chunker, FSM, property tests
**Confidence:** HIGH — all decisions are grounded in Phase 1 outputs, the architecture and pitfalls research from Phase 0, and verified npm registry data. No browser APIs in scope for this phase.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

None. This is a pure-infrastructure phase with no interactive questioning. All choices are Claude's discretion within the constraints listed below.

### Claude's Discretion

- Reorder buffer: Map or Array-backed — pick whichever gives cleaner `seqLT` comparisons and bounded worst-case
- Credit window: high-water-mark default configurable; pick 128 or similar (will be tuned in Phase 5 benchmarks)
- FSM: discriminated union + reducer is idiomatic TypeScript; use a state-transition table to document every valid edge
- Property/fuzz tests: use `fast-check` ONLY IF it qualifies as a dev dependency (COMP-02 forbids only runtime deps). Adding `fast-check` as a devDependency is acceptable. Otherwise roll a deterministic-seed fuzzer.
- Chunker: `maxChunkSize` default 64 KB; configurable
- Consumer-stall timeout: default 30 seconds; configurable; no timer if `stallTimeoutMs <= 0`
- All session code runs in Node (Vitest node env) — no DOM / no postMessage — this phase must be able to run under `pnpm test` with no browser

Zero-runtime-dep rule still applies (COMP-02). Test-only deps are fine.

### Deferred Ideas (OUT OF SCOPE)

- Wiring `Session` into a real `PostMessageEndpoint` — Phase 3
- WHATWG Streams adapter (uses `desiredSize` from credit window) — Phase 3
- SAB ring buffer + Atomics wait — Phase 6
- Relay bridge and credit-forwarding — Phase 7
- Multiplexer (per-stream credit windows over one channel) — Phase 8
- Observability hooks — Phase 4 (leave clean extension points here)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SESS-01 | Reorder buffer delivers chunks in sequence-number order even under out-of-order arrivals, bounded by configurable `maxReorderBuffer` with a clear error on overflow | §Reorder Buffer Algorithm, §Common Pitfalls (Pitfall 9), §Code Examples |
| SESS-02 | Credit-based flow control issues initial credits on `OPEN_ACK`, refreshes when receiver's queue drains below half the high-water mark (QUIC WINDOW_UPDATE-style), never allows write past available credit | §Credit Window Protocol, §Code Examples |
| SESS-03 | Credit refresh is driven by consumer reads, not frame arrivals — backpressure through the entire WHATWG Streams chain | §Credit Window Protocol (desiredSize accessor), §Common Pitfalls (Pitfall 3/4) |
| SESS-04 | Chunker splits oversized payloads into protocol-sized chunks and reassembles on the receiving side before surfacing to consumer | §Chunker Design, §Code Examples |
| SESS-05 | Stream lifecycle FSM covers `idle → open → data → half-closed → closed` with explicit `CANCEL` and `RESET` transitions and well-defined behavior for every source/destination pair | §FSM States and Transitions |
| SESS-06 | Sequence number wraparound is handled correctly — library passes a fuzz test that drives sequences through the wrap point | §Reorder Buffer Algorithm (wrap fuzz) |
| TEST-01 | Unit tests for framing, reorder buffer, credit window, chunker, and FSM run headless under Node with no browser | §Validation Architecture |
| TEST-06 | Property/fuzz tests for the session FSM and sequence-number wraparound | §Property Testing, §Validation Architecture |
</phase_requirements>

---

## Summary

Phase 2 is a pure-TypeScript, no-browser phase. It implements the four stateful components that the session layer owns — reorder buffer, credit window, chunker, and FSM — plus a thin `Session` entity that wires them together. All code must run under Vitest with `environment: 'node'` because it is endpoint-agnostic: sessions accept Frame objects and emit Frame objects with no knowledge of postMessage.

The implementation is grounded in well-understood prior art. The reorder buffer mirrors TCP/QUIC in-order delivery with a bounded gap buffer. The credit window is a direct application of QUIC's WINDOW_UPDATE heuristic (refresh at 50% drain). The chunker's key invariant — capture all metadata before transfer — is derived from the Transferable detach pitfall documented in Phase 0. The FSM is a pure reducer, making it directly property-testable.

**Primary recommendation:** Implement each sub-component as an independent, pure TypeScript module with explicit types, no classes for stateless logic, and complete unit tests before composing into the `Session` entity. Use `fast-check` (devDep, v4.7.0) for property/fuzz tests — it is the correct tool for FSM event sequence randomization and wraparound boundary verification.

---

## Standard Stack

### Core (Phase 1 imports — already installed)

| Module | Imported From | What Phase 2 Uses |
|--------|--------------|-------------------|
| `seqLT`, `seqGT`, `seqLTE`, `seqNext`, `seqMask`, `HALF_WINDOW`, `SEQ_MASK`, `SEQ_BITS` | `src/transport/seq.ts` | All reorder-buffer comparisons, FSM seq checks |
| `Frame`, `DataFrame`, `CreditFrame`, `CloseFrame`, `CancelFrame`, `ResetFrame`, `OpenAckFrame`, `ChunkType`, `BaseFrame` | `src/framing/types.ts` | FSM event types, chunker output shape, credit frame production |

### New devDependency

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `fast-check` | `4.7.0` | Property-based / fuzz testing | Best-in-class shrinking; devDep only (COMP-02 safe); makes FSM event-sequence tests and wraparound fuzz concise and reproducible; latest as of 2026-04-21 |

**Installation:**

```bash
pnpm add -D fast-check
```

**Version verified:** `npm view fast-check version` → `4.7.0` (2026-04-21)

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `fast-check` | Hand-rolled deterministic-seed fuzzer | Hand-roll is ~80 lines and produces no shrinking; failing cases are full-length random sequences, hard to diagnose. `fast-check` shrinks to a minimal counterexample automatically. Use `fast-check`. |
| `Map<number, DataFrame>` reorder buffer | `Array` with sorted insertion | `Map` has O(1) insert/lookup by seq number (the natural key). Array requires binary search on every insert. `Map` is cleaner and faster for sparse out-of-order arrivals. |

---

## Architecture Patterns

### Recommended File Structure (Phase 2 creates)

```
src/session/
├── reorder-buffer.ts   # Map-backed, seqLT-ordered, bounded by maxReorderBuffer
├── credit-window.ts    # QUIC-style credit accounting; stall timer; desiredSize accessor
├── chunker.ts          # Metadata-capture-before-transfer invariant; split + reassemble map
├── fsm.ts              # Pure reducer: (state, event) → state | throws; state enum + event enum
└── index.ts            # Session entity: wires the four above; accepts/emits Frame objects

tests/unit/session/
├── reorder-buffer.test.ts   # In-order, out-of-order, overflow, wrap fuzz
├── credit-window.test.ts    # Block/unblock/half-HWM refresh/stall timeout/drain trigger
├── chunker.test.ts          # Metadata-before-transfer, chunk sizing, reassembly
├── fsm.test.ts              # All valid transitions, all invalid transitions throw, CANCEL vs RESET
└── session.test.ts          # Integration: full frame lifecycle through the composed Session
```

### Pattern 1: Reorder Buffer — Map-Backed, seqLT-Ordered

**What:** A `Map<number, DataFrame>` that holds frames received out-of-order. On each insert, deliver all consecutive frames from the current `nextExpectedSeq` and advance the counter. Reject frames beyond `maxReorderBuffer` distance with `REORDER_OVERFLOW`.

**When to use:** Always on the receive path. Every incoming DATA frame passes through the buffer.

**Key invariants:**
- `nextExpectedSeq` is advanced using `seqNext()` — never with `+ 1` directly
- Gap detection uses `seqGT(frame.seqNum, nextExpectedSeq + maxReorderBuffer)` with modular arithmetic via `seqLT`/`seqGT` from Phase 1
- Overflow is `buffered.size >= maxReorderBuffer` when the new frame is not the next expected — this is the capacity-induced overflow path (distinct from gap-induced overflow)
- Wrap fuzz: test must start at `seqNum = 0xFFFFFFF0` and drive ~32 frames through the wrap point — a direct extension of the Phase 1 seq fuzz

**Example:**

```typescript
// Source: derived from ARCHITECTURE.md + Phase 1 seq.ts exports
import { seqLT, seqGT, seqNext } from '../transport/seq.js';
import type { DataFrame } from '../framing/types.js';

export interface ReorderBufferOptions {
  maxReorderBuffer: number;   // default: 64
}

export class ReorderBuffer {
  readonly #buffer = new Map<number, DataFrame>();
  #nextExpected: number;
  readonly #maxBuffer: number;

  constructor(initSeq: number, opts: ReorderBufferOptions = { maxReorderBuffer: 64 }) {
    this.#nextExpected = initSeq;
    this.#maxBuffer = opts.maxReorderBuffer;
  }

  /**
   * Insert a frame. Returns an array of in-order frames to deliver (may be empty).
   * Throws 'REORDER_OVERFLOW' if frame is beyond the window.
   */
  insert(frame: DataFrame): DataFrame[] {
    const seq = frame.seqNum;

    // Already delivered (duplicate or stale)?
    if (seqLT(seq, this.#nextExpected) || seq === this.#nextExpected - 1) {
      return []; // drop silently — duplicate
    }

    // Is this frame in the next-expected slot?
    if (seq === this.#nextExpected) {
      const out: DataFrame[] = [frame];
      this.#nextExpected = seqNext(this.#nextExpected);
      // Drain any buffered consecutive frames
      while (this.#buffer.has(this.#nextExpected)) {
        out.push(this.#buffer.get(this.#nextExpected)!);
        this.#buffer.delete(this.#nextExpected);
        this.#nextExpected = seqNext(this.#nextExpected);
      }
      return out;
    }

    // Out-of-order: buffer capacity check
    if (this.#buffer.size >= this.#maxBuffer) {
      throw new Error('REORDER_OVERFLOW');
    }

    this.#buffer.set(seq, frame);
    return [];
  }
}
```

**Gap-induced vs capacity-induced overflow:**
- **Capacity-induced:** `buffer.size >= maxReorderBuffer` when attempting to buffer a new out-of-order frame. This is the normal overflow path — too many frames buffered without delivery.
- **Gap-induced:** When a CLOSE frame arrives with `finalSeq` that the reorder buffer will never see because too many frames in the gap were dropped. This is detected at the Session level (not inside `ReorderBuffer`), where `seqGT(closeFrame.finalSeq, nextExpected + maxReorderBuffer)` triggers a RESET with reason `"gap-overflow"`.

Both overflow types must surface as named errors, not silent drops.

### Pattern 2: Credit Window — QUIC WINDOW_UPDATE Style

**What:** Two counters — `sendCredit` (tracks how many frames the sender may still send) and `recvBudget` (tracks how many frames the receiver has capacity for). The receiver issues `CREDIT` frames when `recvConsumed >= hwm / 2`. A stall timer fires if `sendCredit === 0` and no consumer read has occurred within `stallTimeoutMs`.

**When to use:** Send path checks `sendCredit` before each DATA frame emit. Receive path decrements `recvBudget` on each delivered frame; emits CREDIT when drain threshold crossed.

**desiredSize accessor (SESS-03):** Phase 3's WHATWG Streams adapter wires `controller.desiredSize` to this value. The accessor returns `hwm - bufferedCount` — positive means capacity available, zero or negative means backpressure. This makes the credit window the single source of truth for backpressure without Phase 3 needing to duplicate accounting.

**Consumer-stall detection:**
- Stall condition: `sendCredit === 0 AND inFlight === 0 AND timeSinceLastConsumerRead > stallTimeoutMs`
- Timer reset: on every successful consumer read (the session calls `creditWindow.notifyRead()`)
- Timer disabled: when `stallTimeoutMs <= 0`
- On stall: emit error `'consumer-stall'`; transition FSM to `ERRORED`

**Configurable defaults:**

| Parameter | Default | Basis |
|-----------|---------|-------|
| `initialCredit` | 16 | Protocol-derived: enough to fill one RTT pipe at typical latency without unbounded buffering. QUIC uses 64 KB initial window; at 64 KB/chunk that's ~1 chunk. 16 chunks × 64 KB = 1 MB in-flight maximum — safe default. Benchmark-tunable in Phase 5. |
| `highWaterMark` (recvHwm) | 32 | Protocol-derived: `initialCredit × 2` is a reasonable HWM to prevent the sender from draining credits before the first refresh arrives. |
| `creditRefreshThreshold` | `hwm / 2` = 16 | Directly from RFC 9000 QUIC WINDOW_UPDATE: "send update when window falls below 50%". Not configurable — this is protocol-derived. |
| `stallTimeoutMs` | 30000 (30s) | Chosen conservatively to avoid false positives under BFCache or visibility changes. Configurable down to 0 to disable. |

**Example:**

```typescript
// Source: derived from ARCHITECTURE.md §Backpressure, RFC 9000 §4.1
export interface CreditWindowOptions {
  initialCredit: number;     // default: 16
  highWaterMark: number;     // default: 32
  stallTimeoutMs: number;    // default: 30000; 0 = disabled
  onStall: () => void;       // called when consumer-stall detected
  onCreditNeeded: (grant: number) => void;  // called to emit CREDIT frame
}

export class CreditWindow {
  #sendCredit: number;
  #recvConsumed = 0;
  #stallTimer: ReturnType<typeof setTimeout> | null = null;
  // ... (implementation)

  /** Returns desiredSize: positive = capacity, <=0 = backpressure */
  get desiredSize(): number {
    return this.#opts.highWaterMark - this.#recvConsumed;
  }

  /** Called by send path before emitting a DATA frame */
  consumeSendCredit(): boolean {
    if (this.#sendCredit <= 0) return false;
    this.#sendCredit--;
    this.#resetStallTimer();
    return true;
  }

  /** Called by receive path when a chunk is delivered to consumer */
  notifyRead(): void {
    this.#recvConsumed = Math.max(0, this.#recvConsumed - 1);
    this.#resetStallTimer();
    if (this.#recvConsumed <= Math.floor(this.#opts.highWaterMark / 2)) {
      const grant = this.#opts.highWaterMark - this.#recvConsumed;
      this.#opts.onCreditNeeded(grant);
    }
  }

  /** Called when a CREDIT frame arrives from the remote */
  addSendCredit(grant: number): void {
    this.#sendCredit += grant;
    // wake blocked sender (via external signal — see Session)
  }
}
```

**Credit never goes negative invariant:** `consumeSendCredit()` returns `false` and does NOT decrement when at zero. The caller (Session) must block on a `creditAvailable` event/promise. This is the invariant that property tests must verify.

### Pattern 3: Chunker — Metadata-Before-Transfer Invariant

**What:** Splits a large payload into `maxChunkSize`-sized DataFrame objects. For `ArrayBuffer`/`TypedArray` (BINARY_TRANSFER), all metadata (`byteLength`, `chunkType`, `streamId`, `seqNum`, `isFinal`) MUST be captured into local variables BEFORE the ArrayBuffer is appended to a `transferList` and BEFORE any call to `postMessage`. After `postMessage`, the source `ArrayBuffer` is detached (`byteLength === 0`) and must never be accessed again.

**Exact order of operations for BINARY_TRANSFER:**

```typescript
// Source: PITFALLS.md §Pitfall 2 — Accessing a Detached ArrayBuffer After Transfer
// CORRECT ORDER — do NOT reorder these steps:

// Step 1: Capture all metadata BEFORE touching the transferList
const byteLen = ab.byteLength;           // captured BEFORE transfer
const chunkType: ChunkType = 'BINARY_TRANSFER';
const seq = seqNext(prevSeq);
const isFinal = byteLen === remaining;

// Step 2: Build the frame envelope (pure object, no ArrayBuffer reference in metadata fields)
const frame: DataFrame = {
  [FRAME_MARKER]: 1,
  channelId,
  streamId,
  seqNum: seq,
  type: 'DATA',
  chunkType,
  payload: ab,    // reference held in frame; will be detached after send
  isFinal,
};

// Step 3: Caller (Phase 3 transport layer) calls:
//   endpoint.postMessage(encode(frame), [ab])
// After this call: ab.byteLength === 0, ab is detached.

// Step 4: NEVER access ab again. No logging, no retry, no second slice.
```

**ReadableStream refs (STREAM_REF):** Also transferable in modern browsers. Same pattern applies — capture `streamId` and `seq` before appending the `ReadableStream` to the transfer list. The library cannot read from the stream after transfer.

**Structured-clone payloads (STRUCTURED_CLONE):** No transfer, no detach concern. The clone is made by the structured-clone algorithm inside `postMessage`. The source object remains readable after send. No special ordering required.

**Reassembly map:** The chunker also owns a `Map<number, DataFrame[]>` keyed by `streamId` for chunk reassembly on the receive side. Chunks accumulate until `isFinal === true`, then the complete payload is surfaced. The map entry is deleted after surfacing.

**Configurable defaults:**

| Parameter | Default | Basis |
|-----------|---------|-------|
| `maxChunkSize` | 65536 (64 KB) | PITFALLS.md §Pitfall 13: structured-clone optimal is 64 KB; BINARY_TRANSFER optimal is higher (256 KB), but 64 KB is a safe conservative default before Phase 5 benchmarks. Configurable. |

### Pattern 4: FSM — Pure Reducer

**What:** A pure function `transition(state: StreamState, event: StreamEvent): StreamState` that throws a typed error for illegal transitions. No I/O, no side effects, no timers. Side effects (emit RESET frame, emit CANCEL frame) are the Session's responsibility after receiving the new state.

**State enum:**

```typescript
export type StreamState =
  | 'IDLE'
  | 'OPENING'         // OPEN sent/received, waiting for OPEN_ACK
  | 'OPEN'            // bidirectional data flow
  | 'LOCAL_HALF_CLOSED'   // we sent CLOSE; remote can still send DATA
  | 'REMOTE_HALF_CLOSED'  // remote sent CLOSE; we can still send DATA
  | 'CLOSING'         // both sides have sent CLOSE; draining reorder buffer
  | 'CLOSED'          // terminal — clean close
  | 'ERRORED'         // terminal — reset or error
  | 'CANCELLED';      // terminal — consumer-initiated cancel
```

**Event enum:**

```typescript
export type StreamEvent =
  | { type: 'OPEN_SENT' }
  | { type: 'OPEN_RECEIVED' }
  | { type: 'OPEN_ACK_SENT'; initCredit: number }
  | { type: 'OPEN_ACK_RECEIVED'; initCredit: number }
  | { type: 'DATA_SENT' }
  | { type: 'DATA_RECEIVED' }
  | { type: 'CLOSE_SENT' }
  | { type: 'CLOSE_RECEIVED' }
  | { type: 'CANCEL_SENT'; reason: string }    // consumer-initiated
  | { type: 'CANCEL_RECEIVED'; reason: string }
  | { type: 'RESET_SENT'; reason: string }     // producer/error-initiated
  | { type: 'RESET_RECEIVED'; reason: string }
  | { type: 'FINAL_SEQ_DELIVERED' }            // reorder buffer drained to finalSeq
  | { type: 'STALL_TIMEOUT' };                 // consumer-stall timer fired
```

**Transition table (complete):**

| Current State | Event | Next State | Notes |
|---------------|-------|------------|-------|
| IDLE | OPEN_SENT | OPENING | Initiator sends OPEN |
| IDLE | OPEN_RECEIVED | OPENING | Responder receives OPEN |
| OPENING | OPEN_ACK_SENT | OPEN | Responder sends ACK |
| OPENING | OPEN_ACK_RECEIVED | OPEN | Initiator receives ACK |
| OPENING | RESET_RECEIVED | ERRORED | Remote refused |
| OPEN | DATA_SENT | OPEN | No state change |
| OPEN | DATA_RECEIVED | OPEN | No state change |
| OPEN | CLOSE_SENT | LOCAL_HALF_CLOSED | We finished sending |
| OPEN | CLOSE_RECEIVED | REMOTE_HALF_CLOSED | Remote finished sending |
| OPEN | CANCEL_SENT | CANCELLED | Consumer aborted |
| OPEN | CANCEL_RECEIVED | CANCELLED | Remote consumer aborted |
| OPEN | RESET_SENT | ERRORED | Error/producer abort |
| OPEN | RESET_RECEIVED | ERRORED | Remote error |
| OPEN | STALL_TIMEOUT | ERRORED | Consumer stall |
| LOCAL_HALF_CLOSED | DATA_RECEIVED | LOCAL_HALF_CLOSED | Still receiving |
| LOCAL_HALF_CLOSED | CLOSE_RECEIVED | CLOSING | Both sides closed |
| LOCAL_HALF_CLOSED | RESET_SENT | ERRORED | — |
| LOCAL_HALF_CLOSED | RESET_RECEIVED | ERRORED | — |
| LOCAL_HALF_CLOSED | CANCEL_RECEIVED | CANCELLED | — |
| REMOTE_HALF_CLOSED | DATA_SENT | REMOTE_HALF_CLOSED | Still sending |
| REMOTE_HALF_CLOSED | CLOSE_SENT | CLOSING | Both sides closed |
| REMOTE_HALF_CLOSED | RESET_SENT | ERRORED | — |
| REMOTE_HALF_CLOSED | RESET_RECEIVED | ERRORED | — |
| REMOTE_HALF_CLOSED | CANCEL_SENT | CANCELLED | — |
| CLOSING | FINAL_SEQ_DELIVERED | CLOSED | Reorder buffer drained |
| CLOSING | RESET_SENT | ERRORED | Error during drain |
| CLOSING | RESET_RECEIVED | ERRORED | — |
| CLOSED | * | THROWS | Terminal — no further events |
| ERRORED | * | THROWS | Terminal — no further events |
| CANCELLED | * | THROWS | Terminal — no further events |

**All other (state, event) pairs throw `IllegalTransitionError`.**

**CANCEL vs RESET — semantic distinction:**

- `CANCEL` is **consumer-initiated** (the local ReadableStream caller called `cancel()`). The receiver side sends a CANCEL frame upstream. The sender (producer) receives it and must stop producing. Both sides transition to `CANCELLED`. This is a cooperative, "I don't need this data" signal. No error propagated to the producer caller — it is a normal abort.
- `RESET` is **producer-initiated or error-initiated** (unrecoverable error: seq gap, DataCloneError, stall timeout, etc.). A RESET frame propagates the error to the remote. Both sides transition to `ERRORED`. The error reason is surfaced to both caller's WritableStream (abort) and ReadableStream (error).

**Half-closed direction:** `LOCAL_HALF_CLOSED` means we sent CLOSE but the remote can still send DATA. `REMOTE_HALF_CLOSED` means the remote sent CLOSE but we can still send DATA. Both must be distinguishable to correctly gate what events are legal.

**Illegal transitions that must throw:**

```typescript
// Source: FSM design above
throw new IllegalTransitionError(
  `Illegal FSM transition: ${state} + ${event.type}`
);
```

The property tests randomize event sequences; any sequence that produces an `IllegalTransitionError` from a reachable legal state indicates a bug in the transition table.

### Pattern 5: Session Entity — Composition Layer

**What:** `Session` wires the four components above. It accepts Frame objects on its receive path and emits Frame objects on its send path. No postMessage, no endpoint knowledge.

**Public surface (what Phase 3 sees):**

```typescript
export interface SessionOptions {
  channelId: string;
  streamId: number;
  role: 'initiator' | 'responder';
  maxReorderBuffer?: number;      // default: 64
  initialCredit?: number;         // default: 16
  highWaterMark?: number;         // default: 32
  maxChunkSize?: number;          // default: 65536
  stallTimeoutMs?: number;        // default: 30000; 0 = disabled
}

export class Session {
  constructor(opts: SessionOptions);

  /** Feed an inbound Frame from the transport into the session */
  receiveFrame(frame: Frame): void;

  /** Send a payload (called by API adapter or Phase 3 wiring) */
  sendData(payload: unknown, chunkType: ChunkType): void;

  /** Graceful close — sends CLOSE frame */
  close(): void;

  /** Consumer-initiated abort — sends CANCEL frame */
  cancel(reason: string): void;

  /** Error/producer abort — sends RESET frame */
  reset(reason: string): void;

  /** Register callback for outbound frames (Phase 3 wires this to transport) */
  onFrameOut(cb: (frame: Frame, transfer?: ArrayBuffer[]) => void): void;

  /** Register callback for inbound delivered chunks (Phase 3 wires to API adapter) */
  onChunk(cb: (chunk: unknown) => void): void;

  /** Register callback for errors */
  onError(cb: (reason: string) => void): void;

  /** Current FSM state — observable for Phase 3 adapter wiring */
  get state(): StreamState;

  /**
   * desiredSize: forwarded from credit window.
   * Phase 3 WHATWG Streams adapter wires this to ReadableStreamDefaultController.desiredSize.
   * Positive = capacity available; <=0 = backpressure.
   */
  get desiredSize(): number;
}
```

**Observability extension points (Phase 4 hooks):** The Session should accept an optional `metrics` callback that receives per-frame events. Leave the parameter slot as `onMetrics?: (event: MetricsEvent) => void` with `MetricsEvent = never` in Phase 2, to be expanded in Phase 4 without breaking callers.

### Anti-Patterns to Avoid

- **Comparing seq numbers with raw `>`:** Always use `seqLT`/`seqGT` from `src/transport/seq.ts`. Raw comparison fails at the 0xFFFFFFFF → 0 wrap point.
- **Accessing ArrayBuffer after postMessage:** Capture `byteLength` and all metadata before adding to transferList. After the transfer call, treat the buffer as gone.
- **Issuing CREDIT on DATA frame arrival:** Credits must be issued when the consumer reads (calls `notifyRead()`), not when frames arrive. Arrival-based credit re-issue leads to unbounded buffering at the receiver.
- **Using `class` for the FSM reducer:** The transition function should be a pure exported function, not a class method. This makes it directly importable into property tests without instantiating a Session.
- **Stall timer that doesn't suspend during test:** Wrap timer calls in injectable clock — use `setTimeout` by default but accept an optional `clock` parameter in tests to control time deterministically.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Property/fuzz test with shrinking | Custom seed-based fuzzer | `fast-check` 4.7.0 (devDep) | `fast-check` produces minimal counterexamples automatically; a custom fuzzer without shrinking requires manual bisection of long random sequences |
| TCP-style modular seq comparison | Custom modular arithmetic | `seqLT`/`seqGT` from `src/transport/seq.ts` (Phase 1) | Already implemented, fuzz-tested across the wrap point; rebuilding is duplication and introduces divergence risk |
| Frame type definitions | Redefining frame shapes in session modules | `Frame` union from `src/framing/types.ts` (Phase 1) | Single source of truth; Phase 3 depends on type compatibility across layers |

**Key insight:** The session layer's value is the state machine and the protocol logic, not the data structures. All data structure work (seq arithmetic, frame types) was done in Phase 1. Phase 2 only adds state.

---

## Common Pitfalls

### Pitfall 1: Reorder Buffer Duplicate Detection Fails at Wrap

**What goes wrong:** A frame with `seqNum = 0` arriving after the stream has wrapped around from `0xFFFFFFFF` is misclassified as a duplicate (it looks like a "very old" frame) if the duplicate check uses raw `<` instead of `seqLT`.

**Why it happens:** Raw `<` treats `0` as less than `0xFFFFFFFF`, so `0` looks older. `seqLT(0xFFFFFFFF, 0)` correctly returns `true` (0xFFFFFFFF is before 0 in the modular space) only when using the TCP-style formula.

**How to avoid:** Use `seqLT(frame.seqNum, nextExpectedSeq)` for the "already delivered" check. Never use raw `<`.

**Warning signs:** Streams starting at `0xFFFFFFF0` deliver the first 16 frames correctly then silently drop all frames after the wrap.

### Pitfall 2: Credit Window Decrement Before Credit Check

**What goes wrong:** Decrementing `sendCredit` before the guard check produces a negative credit counter. Subsequent calls see `< 0` instead of `=== 0` and may behave differently depending on the comparison operator used.

**How to avoid:** The `consumeSendCredit()` guard must be `if (this.#sendCredit <= 0) return false;` BEFORE any decrement. The property test must verify `credit >= 0` invariant across all event sequences.

### Pitfall 3: FSM Terminal State Swallows Subsequent Events

**What goes wrong:** A `CLOSED`, `ERRORED`, or `CANCELLED` stream receives a delayed DATA frame (from the reorder buffer draining asynchronously). If the Session feeds this to the FSM reducer, the reducer throws an `IllegalTransitionError`. This must be caught and handled as a no-op (log in debug mode, but do not surface as an error to the caller — the stream is already terminal).

**How to avoid:** Session.receiveFrame() checks `if (isTerminalState(this.#state)) { return; }` before dispatching to the FSM. Only the "CLOSING → FINAL_SEQ_DELIVERED → CLOSED" path consumes frames post-CLOSE.

### Pitfall 4: Stall Timer Fires During Tests

**What goes wrong:** Tests that exercise credit-window stall detection must control time. A 30-second real timer causes test suite slowdowns or flaky passes/failures depending on machine speed.

**How to avoid:** Accept an injectable `setTimeout`/`clearTimeout` pair in `CreditWindowOptions`. Default to the real `setTimeout`; tests inject Vitest's `vi.useFakeTimers()`. Alternatively, use `vi.useFakeTimers()` at the test-file level.

**How to use fake timers with Vitest 4:**

```typescript
// Source: Vitest 4 docs — vi.useFakeTimers()
import { vi, describe, it, expect } from 'vitest';

describe('stall detection', () => {
  it('fires after stallTimeoutMs', () => {
    vi.useFakeTimers();
    // ... set up credit window with stallTimeoutMs: 5000
    vi.advanceTimersByTime(5001);
    // assert stall callback was called
    vi.useRealTimers();
  });
});
```

### Pitfall 5: fast-check Arbitrary Interacts Poorly with Vitest 4

**What goes wrong:** `fast-check` works fine with Vitest — there is no known integration issue as of `fast-check` 4.7.0 + Vitest 4.1.4. The only gotcha is that `fc.assert` throws on failure, which Vitest catches as a test failure. This is correct behavior.

**How to avoid:** No special wiring needed. Just:

```typescript
import * as fc from 'fast-check';
import { describe, it } from 'vitest';

it('credit never goes negative', () => {
  fc.assert(
    fc.property(fc.array(fc.nat()), (grants) => {
      // property: after any sequence of grants and consumes, credit >= 0
    })
  );
});
```

**fast-check seed:** On failure, `fast-check` prints the seed. Re-run with `fc.assert(..., { seed: N })` for exact reproduction.

---

## Code Examples

### Reorder Buffer: Wraparound Insert

```typescript
// Source: derived from seq.ts + PITFALLS.md §Pitfall 9
// Correct approach: seqLT for all comparisons
import { seqLT, seqNext } from '../transport/seq.js';

// Duplicate check:
if (seqLT(frame.seqNum, this.#nextExpected)) {
  return []; // already delivered or stale — silent drop
}

// Consecutive delivery:
if (frame.seqNum === this.#nextExpected) {
  // ... deliver and advance #nextExpected = seqNext(#nextExpected)
}
```

### Credit Window: Half-HWM Refresh

```typescript
// Source: RFC 9000 §4.1 — WINDOW_UPDATE at 50% drain
// After consumer reads one chunk:
notifyRead(): void {
  this.#recvConsumed = Math.max(0, this.#recvConsumed - 1);
  this.#resetStallTimer();
  // Issue CREDIT when consumed falls below half the HWM
  if (this.#recvConsumed <= Math.floor(this.#opts.highWaterMark / 2)) {
    const grant = this.#opts.highWaterMark - this.#recvConsumed;
    this.#opts.onCreditNeeded(grant);
  }
}
```

### Chunker: Metadata Before Transfer

```typescript
// Source: PITFALLS.md §Pitfall 2 — Accessing a Detached ArrayBuffer After Transfer
// All three metadata captures MUST precede any reference to the buffer in a transfer context:
const byteLength = ab.byteLength;     // (1) capture size
const isFinal = offset + byteLength >= totalBytes;  // (2) capture finality
const seq = seqNext(this.#lastSeq);   // (3) capture sequence
this.#lastSeq = seq;

const frame: DataFrame = {
  [FRAME_MARKER]: 1,
  channelId: this.#channelId,
  streamId: this.#streamId,
  seqNum: seq,
  type: 'DATA',
  chunkType: 'BINARY_TRANSFER',
  payload: ab,
  isFinal,
};
// Hand `frame` + `[ab]` transferList to Session.onFrameOut callback.
// After that callback returns: ab.byteLength === 0. Never read ab again.
```

### FSM Reducer: Illegal Transition

```typescript
// Source: derived from FSM transition table above
export class IllegalTransitionError extends Error {
  constructor(state: StreamState, event: StreamEvent) {
    super(`Illegal FSM transition: ${state} + ${event.type}`);
    this.name = 'IllegalTransitionError';
  }
}

export function transition(state: StreamState, event: StreamEvent): StreamState {
  switch (state) {
    case 'IDLE':
      if (event.type === 'OPEN_SENT') return 'OPENING';
      if (event.type === 'OPEN_RECEIVED') return 'OPENING';
      throw new IllegalTransitionError(state, event);
    // ... (all cases per transition table)
    case 'CLOSED':
    case 'ERRORED':
    case 'CANCELLED':
      throw new IllegalTransitionError(state, event);
    default:
      throw new IllegalTransitionError(state, event);
  }
}
```

### Property Test: FSM Invariant

```typescript
// Source: fast-check docs (fast-check.dev/docs/core-blocks/runners/#assert)
import * as fc from 'fast-check';
import { transition } from '../../src/session/fsm.js';

const eventArb = fc.oneof(
  fc.constant({ type: 'OPEN_SENT' } as const),
  fc.constant({ type: 'OPEN_RECEIVED' } as const),
  fc.constant({ type: 'DATA_SENT' } as const),
  // ... all event types
);

it('FSM never reaches an undefined state', () => {
  fc.assert(
    fc.property(fc.array(eventArb, { maxLength: 50 }), (events) => {
      let state: StreamState = 'IDLE';
      for (const event of events) {
        try {
          state = transition(state, event);
        } catch (e) {
          if (e instanceof IllegalTransitionError) {
            return; // expected — random sequences hit illegal edges
          }
          throw e; // unexpected error — test failure
        }
      }
      // If no error: state must be a valid StreamState value
      const validStates: StreamState[] = [
        'IDLE', 'OPENING', 'OPEN', 'LOCAL_HALF_CLOSED', 'REMOTE_HALF_CLOSED',
        'CLOSING', 'CLOSED', 'ERRORED', 'CANCELLED',
      ];
      expect(validStates).toContain(state);
    })
  );
});
```

### Property Test: Credit Never Negative

```typescript
// Source: derived from CreditWindow design + fast-check
import * as fc from 'fast-check';

it('sendCredit is never negative', () => {
  fc.assert(
    fc.property(
      fc.nat({ max: 64 }).chain((init) =>
        fc.tuple(
          fc.constant(init),
          fc.array(fc.oneof(
            fc.constant('consume' as const),
            fc.nat({ max: 16 }).map((n) => ({ add: n })),
          ), { maxLength: 200 })
        )
      ),
      ([initCredit, ops]) => {
        const cw = new CreditWindow({ initialCredit: initCredit, /* ... */ });
        for (const op of ops) {
          if (op === 'consume') cw.consumeSendCredit();
          else cw.addSendCredit(op.add);
          // Invariant: credit must never go below 0
          expect(cw.sendCredit).toBeGreaterThanOrEqual(0);
        }
      }
    )
  );
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hand-rolled property test fuzzer with seed | `fast-check` 4.x with automatic shrinking | `fast-check` 1.0 (2018), matured 3.x (2022) | Shrinking eliminates manual bisection of failing random sequences |
| `Array` with sorted insertion for reorder | `Map<seq, frame>` | Standard since Map was universal (ES2015) | O(1) lookup vs O(log n) binary search; no index shifting on insert |
| Raw `>` for seq comparison | `seqLT`/`seqGT` modular arithmetic | Adopted from TCP (RFC 793, 1981) | Correct across wraparound; raw comparison silently corrupts at boundary |
| Push-based backpressure (stop signal) | Credit-based (QUIC WINDOW_UPDATE) | QUIC RFC 9000 (2021) | Sender never blocks on round-trip; pipe stays full; bounded receiver buffer |

---

## Environment Availability

Step 2.6: SKIPPED — Phase 2 is pure TypeScript code + unit tests. No external tools, services, databases, or CLIs beyond `node`, `pnpm`, `vitest`, and `fast-check` (installed via pnpm). All of these are available and verified in Phase 1.

| Dependency | Available | Version | Notes |
|------------|-----------|---------|-------|
| node | ✓ | ≥ 18 (CI: 22) | Checked in Phase 1 |
| pnpm | ✓ | 10.x | Checked in Phase 1 |
| vitest | ✓ | 4.1.4 | Already in devDependencies |
| fast-check | ✗ (not yet) | 4.7.0 | Needs `pnpm add -D fast-check` in Wave 0 |
| TypeScript | ✓ | 6.0.3 | Already in devDependencies |

**Missing dependencies with no fallback:** `fast-check` is not yet installed. Wave 0 task must run `pnpm add -D fast-check` before writing property tests.

---

## Validation Architecture

`workflow.nyquist_validation` is `true` in `.planning/config.json` — this section is required.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.4 |
| Config file | `vitest.config.ts` (root) — `unit` project covers `tests/unit/**/*.{test,spec}.ts` with `environment: 'node'` |
| Quick run command | `pnpm exec vitest run --project=unit --reporter=verbose tests/unit/session/` |
| Full suite command | `pnpm test` (runs all unit projects including framing, transport, and session) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SESS-01 | Reorder buffer delivers in-order, handles OOO, overflows with error | unit | `pnpm exec vitest run --project=unit tests/unit/session/reorder-buffer.test.ts` | ❌ Wave 0 |
| SESS-01 (wrap) | Reorder buffer handles seqNum wraparound at 0xFFFFFFF0 | property | same file | ❌ Wave 0 |
| SESS-02 | Credit window issues initial credit, refreshes at half-HWM | unit | `pnpm exec vitest run --project=unit tests/unit/session/credit-window.test.ts` | ❌ Wave 0 |
| SESS-03 | `desiredSize` accessor returns correct value; credit driven by reads not arrivals | unit | same file | ❌ Wave 0 |
| SESS-04 | Chunker splits to maxChunkSize, captures metadata before transfer, reassembles | unit | `pnpm exec vitest run --project=unit tests/unit/session/chunker.test.ts` | ❌ Wave 0 |
| SESS-05 | FSM: all valid transitions succeed; all invalid throw; CANCEL vs RESET semantics | unit | `pnpm exec vitest run --project=unit tests/unit/session/fsm.test.ts` | ❌ Wave 0 |
| SESS-06 | Wraparound fuzz: 32 frames through 0xFFFFFFF0 → 0x0000000F all delivered | property | `pnpm exec vitest run --project=unit tests/unit/session/reorder-buffer.test.ts` | ❌ Wave 0 |
| TEST-01 | All session unit tests run in Node env with no browser | CI gate | `pnpm test` exits 0 without browser | ❌ Wave 0 (tests don't exist yet) |
| TEST-06 | Property tests for FSM event sequences and wraparound | property | `pnpm exec vitest run --project=unit tests/unit/session/fsm.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm exec vitest run --project=unit tests/unit/session/` (session tests only, ~1s)
- **Per wave merge:** `pnpm test` (full unit suite including framing + transport, ~200ms)
- **Phase gate:** `pnpm test` full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/unit/session/reorder-buffer.test.ts` — covers SESS-01, SESS-06
- [ ] `tests/unit/session/credit-window.test.ts` — covers SESS-02, SESS-03
- [ ] `tests/unit/session/chunker.test.ts` — covers SESS-04
- [ ] `tests/unit/session/fsm.test.ts` — covers SESS-05, TEST-06
- [ ] `tests/unit/session/session.test.ts` — integration: full frame lifecycle
- [ ] `pnpm add -D fast-check` — install property testing devDep (TEST-06 depends on this)

---

## Open Questions

1. **`seqNum` equality check in reorder buffer duplicate detection**
   - What we know: `seqLT(seq, nextExpected)` catches frames before the window; `seq === nextExpected` is the in-order case
   - What's unclear: How to handle exact-duplicate frames (`seq === buffered key already in map`)? The map will silently overwrite. Should duplicates be detected and dropped with a debug log?
   - Recommendation: On `this.#buffer.has(seq)`, do a no-op return `[]` (drop silently). Duplicates can only arrive if the sender has a bug (SESS-02 prevents retransmission). Log in debug mode.

2. **`DataFrame.chunkType` field in `decode()` — not validated in Phase 1**
   - What we know: Phase 1's `decode()` does not validate that `chunkType` is a valid `ChunkType` string on DATA frames (it only checks `payload` and `isFinal`)
   - What's unclear: Should Phase 2's chunker/session layer validate this, or should it be patched in Phase 1's decode()?
   - Recommendation: Add validation in Phase 2's session receive path — check `chunkType` against the valid enum values and RESET the stream if invalid. Do not modify Phase 1's `decode()` to avoid changing proven-stable code.

3. **Stall timer and fake timers interaction with fast-check**
   - What we know: `vi.useFakeTimers()` works in Vitest 4 for normal `setTimeout` usage
   - What's unclear: Does `vi.useFakeTimers()` interfere with `fast-check`'s internal timing?
   - Recommendation: Keep fake-timer tests and property tests in separate `describe` blocks. Call `vi.useRealTimers()` in `afterEach` for any block using fake timers. `fast-check` has no internal timers; the interaction should be clean.

---

## Project Constraints (from CLAUDE.md)

| Directive | Impact on Phase 2 |
|-----------|------------------|
| Zero runtime dependencies (COMP-02) | `fast-check` must be a `devDependency` only — not in `dependencies` or `peerDependencies`. Verify after `pnpm add -D fast-check`. |
| ESM imports with `.js` extension in source | All session module imports must use `.js` extension: `import { seqLT } from '../transport/seq.js'` — even though the source is `.ts`. This matches Phase 1 convention. |
| `isolatedDeclarations: true` | All exported types must be explicitly annotated. No inferred return types on exports. `StreamState`, `StreamEvent`, `IllegalTransitionError`, `SessionOptions`, `CreditWindowOptions`, `ReorderBufferOptions`, `ChunkerOptions` must all be explicit. |
| Biome 2.4.12 | Run `pnpm exec biome check --write .` before committing. Bracket notation (`m["key"]`) will be flagged — use dot notation or index signatures. |
| Vitest `environment: 'node'` for unit tests | No `window`, no `document`, no `postMessage` in Phase 2 tests. Verified: `vitest.config.ts` unit project is already `environment: 'node'`. |
| `moduleResolution: "bundler"` | `.js` extensions in import paths; no `index` barrel re-export needed for sub-modules to find each other. |
| Do not import from `src/transport/adapters/*` | Session layer is endpoint-agnostic. Only `src/framing/types.ts` and `src/transport/seq.ts` are permitted imports from Phase 1. |

---

## Sources

### Primary (HIGH confidence)

- `src/transport/seq.ts` (Phase 1 deliverable) — `seqLT`, `seqGT`, `seqNext`, `seqMask`, `HALF_WINDOW` — live source, verified in Phase 1 fuzz tests
- `src/framing/types.ts` (Phase 1 deliverable) — all 8 Frame types, `ChunkType`, `BaseFrame`, `FRAME_MARKER` — live source, 40 tests green
- `.planning/research/ARCHITECTURE.md` (Phase 0 research) — Session layer component spec, credit window QUIC derivation, FSM lifecycle, reorder buffer design
- `.planning/research/PITFALLS.md` (Phase 0 research) — Pitfall 2 (detached buffer), Pitfall 3 (credit deadlock), Pitfall 4 (enqueue backpressure), Pitfall 9 (seq wraparound)
- `npm view fast-check version` → `4.7.0` (verified 2026-04-21)
- RFC 9000 (QUIC) §4 — per-stream flow control, WINDOW_UPDATE at 50% threshold
- `vitest.config.ts` (live) — `unit` project uses `environment: 'node'`; no browser mode for Phase 2

### Secondary (MEDIUM confidence)

- Phase 1 SUMMARY files (01-02, 01-04) — confirmed exported symbols, encode/decode design, seq arithmetic formula
- ARCHITECTURE.md §Testing Architecture — confirmed that session/* runs in Node env with no browser API
- Vitest 4 docs (vi.useFakeTimers) — fake timer interaction pattern for stall detection tests

### Tertiary (LOW confidence)

- fast-check 4.x + Vitest 4.1.4 compatibility: no known issues reported. Verified by checking that `fc.assert` throws on failure (standard test framework integration). No official compatibility matrix was found but the integration is straightforward.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Phase 1 exports are live code; fast-check version verified from npm registry
- Architecture: HIGH — all patterns derived from Phase 0 research (ARCHITECTURE.md + PITFALLS.md), which are HIGH confidence
- FSM transition table: HIGH — derived exhaustively from the 9-state, 14-event model; cross-checked against ARCHITECTURE.md lifecycle diagram
- Pitfalls: HIGH — direct from PITFALLS.md Phase 0 research plus implementation-specific gotchas
- Property test examples: MEDIUM — patterns are standard fast-check usage; exact Vitest 4 interaction is not officially documented but follows standard throw-on-failure behavior

**Research date:** 2026-04-21
**Valid until:** 2026-06-01 (stable domain; fast-check version may drift but 4.7.0 is pinned in lockfile once installed)
