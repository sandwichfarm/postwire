// src/session/index.ts
// Session entity: wires ReorderBuffer + CreditWindow + Chunker + FSM into a
// cohesive per-stream state machine. Accepts Frame objects on receiveFrame()
// and emits Frame objects via the onFrameOut() callback.
// No postMessage wiring — that is Phase 3's responsibility.

import type {
  CancelFrame,
  ChunkType,
  CloseFrame,
  CreditFrame,
  DataFrame,
  Frame,
  OpenAckFrame,
  OpenFrame,
  ResetFrame,
} from "../framing/types.js";
import { FRAME_MARKER } from "../framing/types.js";
import type { ChunkResult } from "./chunker.js";
import { Chunker } from "./chunker.js";
import { CreditWindow } from "./credit-window.js";
import type { StreamEvent, StreamState } from "./fsm.js";
import { isTerminalState, transition } from "./fsm.js";
import { ReorderBuffer } from "./reorder-buffer.js";

export type { ChunkerOptions, ChunkResult } from "./chunker.js";
export type { CreditWindowOptions } from "./credit-window.js";
// Re-export sub-module types so callers can import everything from this barrel.
export type { IllegalTransitionError, StreamEvent, StreamState } from "./fsm.js";
export type { ReorderBufferOptions } from "./reorder-buffer.js";

export interface SessionOptions {
  channelId: string;
  streamId: number;
  role: "initiator" | "responder";
  /** Maximum number of out-of-order frames to buffer before REORDER_OVERFLOW. Default: 64. */
  maxReorderBuffer?: number;
  /** Initial send/receive credit granted on OPEN_ACK. Default: 16. */
  initialCredit?: number;
  /** Receive high-water mark for CREDIT refresh threshold. Default: 32. */
  highWaterMark?: number;
  /** Maximum bytes per DATA chunk. Default: 65536 (64 KB). */
  maxChunkSize?: number;
  /** Milliseconds before consumer-stall error. 0 or negative = disabled. Default: 30000. */
  stallTimeoutMs?: number;
  /**
   * Initial sequence number for the ReorderBuffer.
   * Set to the first expected DATA seqNum when the stream starts mid-range
   * (e.g. SESS-06 wraparound tests starting at 0xFFFFFFF0).
   * Default: 0.
   */
  reorderInitSeq?: number;
  /** Phase 4 observability extension point — MetricsEvent is `never` in Phase 2. */
  onMetrics?: (event: never) => void;
}

export class Session {
  readonly #channelId: string;
  readonly #streamId: number;
  readonly #role: "initiator" | "responder";
  readonly #initialCredit: number;

  #state: StreamState = "IDLE";

  readonly #reorder: ReorderBuffer;
  readonly #credit: CreditWindow;
  readonly #chunker: Chunker;

  // Queue of payloads waiting for send credit to become available.
  readonly #pendingSends: Array<{ payload: unknown; chunkType: ChunkType }> = [];

  // Outbound sequence counter for non-DATA control frames (OPEN, OPEN_ACK, CLOSE, etc.).
  // DATA frame sequence numbers are managed by Chunker.
  #outSeq: number = 0;

  // finalSeq received via CLOSE frame — used to detect FINAL_SEQ_DELIVERED.
  #remoteFinalSeq: number | null = null;

  // Registered callbacks
  #onFrameOutCb: ((frame: Frame, transfer?: ArrayBuffer[]) => void) | null = null;
  #onChunkCb: ((chunk: unknown) => void) | null = null;
  #onErrorCb: ((reason: string) => void) | null = null;
  #onCreditRefillCb: (() => void) | null = null;

  constructor(opts: SessionOptions) {
    this.#channelId = opts.channelId;
    this.#streamId = opts.streamId;
    this.#role = opts.role;
    this.#initialCredit = opts.initialCredit ?? 16;

    // ReorderBuffer: pass reorderInitSeq so the buffer's first expected sequence
    // number matches the actual first DATA frame's seqNum. SESS-06 wraparound tests
    // depend on this being configurable (e.g. reorderInitSeq: 0xFFFFFFF0).
    this.#reorder = new ReorderBuffer(opts.reorderInitSeq ?? 0, {
      maxReorderBuffer: opts.maxReorderBuffer,
    });

    // CreditWindow: initiator starts with 0 send credits (must wait for OPEN_ACK);
    // responder starts with initialCredit send credits (they send first after open).
    this.#credit = new CreditWindow({
      initialCredit: this.#role === "initiator" ? 0 : this.#initialCredit,
      highWaterMark: opts.highWaterMark,
      stallTimeoutMs: opts.stallTimeoutMs,
      onStall: () => {
        this.#handleStall();
      },
      onCreditNeeded: (grant: number) => {
        this.#sendCreditFrame(grant);
      },
    });

    // Chunker: DATA sequence numbers start at 0 and advance with seqNext().
    this.#chunker = new Chunker(0, {
      channelId: this.#channelId,
      streamId: this.#streamId,
      maxChunkSize: opts.maxChunkSize,
    });
  }

  // ---------------------------------------------------------------------------
  // Public state accessors
  // ---------------------------------------------------------------------------

  get state(): StreamState {
    return this.#state;
  }

  /** Stream identifier (OBS-01). */
  get streamId(): number {
    return this.#streamId;
  }

  /** Forwarded from CreditWindow; Phase 3 WHATWG Streams adapter wires this to desiredSize. */
  get desiredSize(): number {
    return this.#credit.desiredSize;
  }

  /** Current available send credit (OBS-01). */
  get creditWindowAvailable(): number {
    return this.#credit.sendCredit;
  }

  /** Current reorder buffer depth — out-of-order frames buffered (OBS-01). */
  get reorderBufferDepth(): number {
    return this.#reorder.bufferSize;
  }

  /** Number of DATA chunks sent via the chunker (OBS-01). */
  get chunkerChunksSent(): number {
    return this.#chunker.chunksSent;
  }

  /** Number of complete payloads reassembled by the chunker (OBS-01). */
  get chunkerChunksReceived(): number {
    return this.#chunker.chunksReceived;
  }

  // ---------------------------------------------------------------------------
  // Callback registration
  // ---------------------------------------------------------------------------

  /** Register callback for outbound frames. Phase 3 wires this to the transport. */
  onFrameOut(cb: (frame: Frame, transfer?: ArrayBuffer[]) => void): void {
    this.#onFrameOutCb = cb;
  }

  /** Register callback for fully reassembled inbound payloads. */
  onChunk(cb: (chunk: unknown) => void): void {
    this.#onChunkCb = cb;
  }

  /** Register callback for error conditions (stall, reset, cancel). */
  onError(cb: (reason: string) => void): void {
    this.#onErrorCb = cb;
  }

  /**
   * Register callback fired when send credit refills after having been exhausted.
   * Used by the EventEmitter adapter to emit the 'drain' event (API-02).
   * Fires once per credit-refill cycle when credit transitions from 0 to positive.
   */
  onCreditRefill(cb: () => void): void {
    this.#onCreditRefillCb = cb;
  }

  // ---------------------------------------------------------------------------
  // Initiator API
  // ---------------------------------------------------------------------------

  /**
   * Initiator-only: send the OPEN frame to start the session.
   * Transitions IDLE → OPENING.
   */
  open(): void {
    const frame: OpenFrame = {
      [FRAME_MARKER]: 1,
      channelId: this.#channelId,
      streamId: this.#streamId,
      seqNum: this.#nextOutSeq(),
      type: "OPEN",
      initCredit: this.#initialCredit,
    };
    this.#applyTransition({ type: "OPEN_SENT" });
    this.#onFrameOutCb?.(frame, []);
  }

  // ---------------------------------------------------------------------------
  // Inbound frame dispatch
  // ---------------------------------------------------------------------------

  /**
   * Feed an inbound Frame from the transport into the session.
   * Frames received after the FSM reaches a terminal state are silently dropped
   * (Pitfall 3 from RESEARCH.md — no throw on delayed post-terminal frames).
   */
  receiveFrame(frame: Frame): void {
    // FSM Pitfall 3: drop all frames when already in a terminal state.
    if (isTerminalState(this.#state)) return;

    switch (frame.type) {
      case "OPEN": {
        // Responder path: receive OPEN → send OPEN_ACK and transition to OPEN.
        this.#applyTransition({ type: "OPEN_RECEIVED" });
        const ack: OpenAckFrame = {
          [FRAME_MARKER]: 1,
          channelId: this.#channelId,
          streamId: this.#streamId,
          seqNum: this.#nextOutSeq(),
          type: "OPEN_ACK",
          initCredit: this.#initialCredit,
        };
        this.#applyTransition({ type: "OPEN_ACK_SENT", initCredit: this.#initialCredit });
        this.#onFrameOutCb?.(ack, []);
        break;
      }

      case "OPEN_ACK": {
        // Initiator path: receive OPEN_ACK → gain send credits and enter OPEN.
        this.#credit.addSendCredit(frame.initCredit);
        this.#applyTransition({ type: "OPEN_ACK_RECEIVED", initCredit: frame.initCredit });
        // Drain any sends queued before credits were available.
        this.#drainPendingSends();
        break;
      }

      case "DATA": {
        // Increment receive-consumed counter for backpressure tracking.
        this.#credit.addRecvConsumed(1);

        // Insert into reorder buffer — may return multiple in-order frames.
        // REORDER_OVERFLOW is thrown as a plain Error by ReorderBuffer; catch it here
        // so it does not escape as an unhandled exception (RESEARCH.md Pitfall 4).
        let delivered: DataFrame[];
        try {
          delivered = this.#reorder.insert(frame as DataFrame);
        } catch (e) {
          if (e instanceof Error && e.message === "REORDER_OVERFLOW") {
            this.#applyTransition({ type: "RESET_SENT", reason: "REORDER_OVERFLOW" });
            this.#onErrorCb?.("REORDER_OVERFLOW");
            return;
          }
          throw e;
        }
        for (const df of delivered) {
          const reassembled = this.#chunker.reassemble(df);
          if (reassembled !== null) {
            this.#onChunkCb?.(reassembled);
            // Notify read AFTER surfacing chunk — drives CREDIT refresh (SESS-03).
            this.#credit.notifyRead();
          }
        }

        this.#applyTransition({ type: "DATA_RECEIVED" });

        // If we already received a CLOSE (and thus have remoteFinalSeq), check
        // whether we have now delivered all frames up to and including finalSeq.
        this.#checkFinalSeqDelivered();
        break;
      }

      case "CREDIT": {
        // Remote granted additional send credits — unblock queued sends.
        this.#credit.addSendCredit((frame as CreditFrame).credit);
        this.#drainPendingSends();
        break;
      }

      case "CLOSE": {
        this.#remoteFinalSeq = frame.finalSeq;
        this.#applyTransition({ type: "CLOSE_RECEIVED" });
        // It's possible all DATA already arrived before the CLOSE frame.
        this.#checkFinalSeqDelivered();
        break;
      }

      case "CANCEL": {
        this.#applyTransition({ type: "CANCEL_RECEIVED", reason: frame.reason });
        this.#onErrorCb?.(frame.reason);
        break;
      }

      case "RESET": {
        this.#applyTransition({ type: "RESET_RECEIVED", reason: (frame as ResetFrame).reason });
        this.#onErrorCb?.((frame as ResetFrame).reason);
        break;
      }

      case "CAPABILITY": {
        // CAPABILITY frames are channel-level (handled by the multiplexer in Phase 8).
        // At session level, drop silently.
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Outbound data API
  // ---------------------------------------------------------------------------

  /**
   * Send a payload as one or more DATA frames.
   * If send credit is exhausted the payload is queued and will be emitted
   * automatically once a CREDIT frame is received.
   */
  sendData(payload: unknown, chunkType: ChunkType): void {
    if (!this.#credit.consumeSendCredit()) {
      this.#pendingSends.push({ payload, chunkType });
      return;
    }
    this.#emitData(payload, chunkType);
  }

  /**
   * Returns true if the send credit window is currently exhausted.
   * Used by adapters to track whether a subsequent credit refill warrants a 'drain' event.
   */
  get isCreditExhausted(): boolean {
    return this.#credit.desiredSize <= 0;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle control
  // ---------------------------------------------------------------------------

  /**
   * Graceful half-close: sends CLOSE frame, transitions to LOCAL_HALF_CLOSED.
   * Remote can still send DATA until it also sends CLOSE.
   *
   * @param finalSeq - The seqNum of the last DATA frame this session emitted.
   *   The Channel layer tracks this by intercepting session.onFrameOut() and
   *   recording the highest DATA frame seqNum seen. Defaults to 0 if no DATA
   *   was ever sent (e.g. empty stream).
   */
  close(finalSeq = 0): void {
    const frame: CloseFrame = {
      [FRAME_MARKER]: 1,
      channelId: this.#channelId,
      streamId: this.#streamId,
      seqNum: this.#nextOutSeq(),
      type: "CLOSE",
      finalSeq,
    };
    this.#applyTransition({ type: "CLOSE_SENT" });
    this.#onFrameOutCb?.(frame, []);
  }

  /**
   * Consumer-initiated abort: sends CANCEL frame, transitions to CANCELLED.
   * Reason is surfaced to both onError and the remote via the CANCEL frame.
   */
  cancel(reason: string): void {
    const frame: CancelFrame = {
      [FRAME_MARKER]: 1,
      channelId: this.#channelId,
      streamId: this.#streamId,
      seqNum: this.#nextOutSeq(),
      type: "CANCEL",
      reason,
    };
    this.#applyTransition({ type: "CANCEL_SENT", reason });
    this.#onErrorCb?.(reason);
    this.#onFrameOutCb?.(frame, []);
  }

  /**
   * Error/producer abort: sends RESET frame, transitions to ERRORED.
   * Reason is surfaced to both onError and the remote via the RESET frame.
   */
  reset(reason: string): void {
    const frame: ResetFrame = {
      [FRAME_MARKER]: 1,
      channelId: this.#channelId,
      streamId: this.#streamId,
      seqNum: this.#nextOutSeq(),
      type: "RESET",
      reason,
    };
    this.#applyTransition({ type: "RESET_SENT", reason });
    this.#onErrorCb?.(reason);
    this.#onFrameOutCb?.(frame, []);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Emit DATA frames for a single payload, using chunker to split if necessary. */
  #emitData(payload: unknown, chunkType: ChunkType): void {
    const results: ChunkResult[] = this.#chunker.split(
      payload,
      chunkType as "BINARY_TRANSFER" | "STRUCTURED_CLONE",
    );
    for (const { frame, transfer } of results) {
      this.#onFrameOutCb?.(frame, transfer);
    }
    this.#applyTransition({ type: "DATA_SENT" });
  }

  /**
   * Drain the pending-sends queue as long as send credit is available.
   * Called after addSendCredit (CREDIT frame or OPEN_ACK received).
   * Fires onCreditRefillCb once per drain cycle if credit was previously exhausted
   * and the queue was non-empty — this signals 'drain' to the EventEmitter adapter.
   */
  #drainPendingSends(): void {
    const hadPending = this.#pendingSends.length > 0;
    while (this.#pendingSends.length > 0 && this.#credit.consumeSendCredit()) {
      const item = this.#pendingSends.shift();
      if (item !== undefined) {
        this.#emitData(item.payload, item.chunkType);
      }
    }
    // Fire credit-refill callback once if we drained at least one pending send,
    // signalling that backpressure has been relieved.
    if (hadPending && this.#onCreditRefillCb !== null) {
      this.#onCreditRefillCb();
    }
  }

  /**
   * Called by CreditWindow when the consumer-stall timer fires.
   * Transitions FSM to ERRORED and notifies onError.
   */
  #handleStall(): void {
    if (isTerminalState(this.#state)) return;
    this.#applyTransition({ type: "STALL_TIMEOUT" });
    this.#onErrorCb?.("consumer-stall");
  }

  /**
   * Emit a CREDIT frame back to the remote side.
   * Called by CreditWindow.onCreditNeeded when receive buffer drains below half HWM.
   */
  #sendCreditFrame(grant: number): void {
    if (isTerminalState(this.#state)) return;
    const frame: CreditFrame = {
      [FRAME_MARKER]: 1,
      channelId: this.#channelId,
      streamId: this.#streamId,
      seqNum: this.#nextOutSeq(),
      type: "CREDIT",
      credit: grant,
    };
    this.#onFrameOutCb?.(frame, []);
  }

  /**
   * If we are in CLOSING state (both CLOSE_SENT and CLOSE_RECEIVED) and the
   * reorder buffer has delivered all frames up to remoteFinalSeq, fire
   * FINAL_SEQ_DELIVERED to complete the drain and reach CLOSED.
   */
  #checkFinalSeqDelivered(): void {
    if (this.#state !== "CLOSING") return;
    if (this.#remoteFinalSeq === null) return;

    // The reorder buffer's nextExpected has advanced past the finalSeq,
    // meaning all frames through finalSeq have been delivered in order.
    // seqLTE(remoteFinalSeq, nextExpected - 1) in modular space is equivalent to
    // nextExpected having passed remoteFinalSeq.
    // Simpler check: nextExpected === seqNext(remoteFinalSeq) or further.
    const nextExp = this.#reorder.nextExpected;
    // If nextExpected is strictly greater than remoteFinalSeq in modular arithmetic,
    // we have delivered the final seq.
    // seqGT(nextExp, remoteFinalSeq) from seq.ts handles wraparound.
    // Rather than importing seqGT (which would add an import), we inline the check:
    // seqGT(a, b) = seqLT(b, a) = ((b - a) >>> 0) > HALF_WINDOW
    // But it's cleaner to just import it. Let's check: we already import from seq.ts
    // indirectly via reorder-buffer; we can import seqGT directly here.
    // Actually we don't import from seq.ts in this file — let's inline it.
    const HALF_WINDOW = 0x8000_0000;
    const isDelivered =
      (this.#remoteFinalSeq - nextExp + 1) >>> 0 > HALF_WINDOW ||
      nextExp === (this.#remoteFinalSeq + 1) >>> 0;

    if (isDelivered) {
      this.#applyTransition({ type: "FINAL_SEQ_DELIVERED" });
    }
  }

  /** Advance the outbound control-frame sequence counter. */
  #nextOutSeq(): number {
    const seq = this.#outSeq;
    this.#outSeq = (this.#outSeq + 1) >>> 0;
    return seq;
  }

  /** Wrap the FSM reducer to update local state. */
  #applyTransition(event: StreamEvent): void {
    this.#state = transition(this.#state, event);
  }
}
