// src/session/reorder-buffer.ts
// Map-backed, seqLT-ordered, bounded reorder buffer for in-sequence delivery.
// Implements SESS-01 and SESS-06 (wraparound-safe via seqLT from Phase 1).
import type { DataFrame } from "../framing/types.js";
import { seqLT, seqNext } from "../transport/seq.js";

export interface ReorderBufferOptions {
  maxReorderBuffer?: number; // default: 64
}

export class ReorderBuffer {
  readonly #buffer = new Map<number, DataFrame>();
  #nextExpected: number;
  readonly #maxBuffer: number;

  constructor(initSeq: number, opts: ReorderBufferOptions = {}) {
    this.#nextExpected = initSeq >>> 0;
    this.#maxBuffer = opts.maxReorderBuffer ?? 64;
  }

  get nextExpected(): number {
    return this.#nextExpected;
  }

  /** Number of out-of-order frames currently buffered (OBS-01). */
  get bufferSize(): number {
    return this.#buffer.size;
  }

  /**
   * Insert a frame. Returns an array of in-order frames to deliver (may be empty).
   * Throws 'REORDER_OVERFLOW' if the buffer capacity is exceeded.
   * Silently drops stale (seqLT) or duplicate-key frames.
   */
  insert(frame: DataFrame): DataFrame[] {
    const seq = frame.seqNum >>> 0;

    // Already delivered — seqLT handles wraparound correctly:
    if (seqLT(seq, this.#nextExpected)) return [];

    // Exact duplicate already in buffer — drop silently:
    if (seq !== this.#nextExpected && this.#buffer.has(seq)) return [];

    // In-order frame — deliver and drain consecutive buffered frames:
    if (seq === this.#nextExpected) {
      const out: DataFrame[] = [frame];
      this.#nextExpected = seqNext(this.#nextExpected);
      while (this.#buffer.has(this.#nextExpected)) {
        const buffered = this.#buffer.get(this.#nextExpected);
        if (!buffered)
          throw new Error("reorder-buffer invariant violated: has() true but get() undefined");
        out.push(buffered);
        this.#buffer.delete(this.#nextExpected);
        this.#nextExpected = seqNext(this.#nextExpected);
      }
      return out;
    }

    // Out-of-order: capacity check before buffering:
    if (this.#buffer.size >= this.#maxBuffer) {
      throw new Error("REORDER_OVERFLOW");
    }
    this.#buffer.set(seq, frame);
    return [];
  }
}
