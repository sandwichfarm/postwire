// src/session/chunker.ts
// Splits oversized payloads into maxChunkSize-bounded DataFrame objects and reassembles
// them on the receive side.
//
// CRITICAL INVARIANT (metadata-before-transfer):
// All metadata (byteLength, isFinal, seqNum, chunkType, streamId) MUST be captured
// into local variables BEFORE the ArrayBuffer slice is referenced in a transfer list.
// After postMessage([ab]) is called by the Transport layer, ab.byteLength === 0 —
// reading it then would silently return 0. We prevent this by capturing up front.
// See PITFALLS.md §Pitfall 2.

import type { DataFrame } from "../framing/types.js";
import { FRAME_MARKER } from "../framing/types.js";
import { seqNext } from "../transport/seq.js";

export interface ChunkerOptions {
  channelId: string;
  streamId: number;
  maxChunkSize?: number; // default: 65536 (64 KB)
}

export interface ChunkResult {
  frame: DataFrame;
  transfer: ArrayBuffer[]; // non-empty for BINARY_TRANSFER only
}

export class Chunker {
  readonly #channelId: string;
  readonly #streamId: number;
  readonly #maxChunkSize: number;
  #nextSeq: number;

  // OBS-01: counters for stats() snapshot
  #chunksSent = 0;
  #chunksReceived = 0;

  // Reassembly map: streamId → accumulated ArrayBuffer slices
  readonly #reassemblyBufs: Map<number, ArrayBuffer[]> = new Map<number, ArrayBuffer[]>();

  constructor(initSeq: number, opts: ChunkerOptions) {
    this.#nextSeq = initSeq >>> 0;
    this.#channelId = opts.channelId;
    this.#streamId = opts.streamId;
    this.#maxChunkSize = opts.maxChunkSize ?? 65536;
  }

  /** Number of chunks sent (OBS-01). Each split() call may produce multiple chunks. */
  get chunksSent(): number {
    return this.#chunksSent;
  }

  /** Number of fully reassembled payloads received (OBS-01). */
  get chunksReceived(): number {
    return this.#chunksReceived;
  }

  /**
   * Split a payload into one or more DataFrame chunks.
   * For BINARY_TRANSFER single-chunk case: the ORIGINAL ArrayBuffer is used directly
   * as payload and placed in the transfer list — this DETACHES the caller's buffer
   * after postMessage (FAST-01: source.byteLength === 0 post-send). This is the
   * zero-copy fast path for payloads that fit in a single frame.
   * For BINARY_TRANSFER multi-chunk case: each chunk gets its own slice via ab.slice().
   * Slices are necessary because the original must be read multiple times.
   */
  split(payload: unknown, chunkType: "BINARY_TRANSFER" | "STRUCTURED_CLONE"): ChunkResult[] {
    if (chunkType === "BINARY_TRANSFER") {
      const ab: ArrayBuffer =
        payload instanceof ArrayBuffer
          ? payload
          : ((payload as ArrayBufferView).buffer as ArrayBuffer);

      // STEP 1: Capture total size BEFORE any slice or transfer operation.
      // After a real postMessage transfer, ab.byteLength would be 0 — capture now.
      const total = ab.byteLength;
      const results: ChunkResult[] = [];
      let offset = 0;

      do {
        // STEP 2: Capture ALL metadata as local variables before touching the buffer reference.
        const chunkSize = Math.min(this.#maxChunkSize, total - offset);
        const isFinal = offset + chunkSize >= total;

        // Consume and advance sequence number BEFORE building frame
        const seq = this.#nextSeq;
        this.#nextSeq = seqNext(this.#nextSeq);

        // STEP 3: Choose the buffer to use as payload.
        // Single-chunk (offset=0, isFinal=true): use the ORIGINAL ab directly.
        //   Placing it in the transfer list detaches the caller's buffer after
        //   postMessage — this is the FAST-01 zero-copy proof (source.byteLength===0).
        // Multi-chunk: use ab.slice() since we need to read ab multiple times.
        //   Each slice is an independent ArrayBuffer transferred separately.
        const bufToSend = offset === 0 && isFinal ? ab : ab.slice(offset, offset + chunkSize);

        // STEP 4: Build frame with the chosen buffer as payload.
        // All metadata fields (isFinal, seqNum, chunkType) were captured above.
        const frame: DataFrame = {
          [FRAME_MARKER]: 1,
          channelId: this.#channelId,
          streamId: this.#streamId,
          seqNum: seq,
          type: "DATA",
          chunkType: "BINARY_TRANSFER",
          payload: bufToSend,
          isFinal,
        };

        // STEP 5: Transfer list contains the buffer that will be sent.
        results.push({ frame, transfer: [bufToSend] });
        offset += chunkSize;
      } while (offset < total);

      this.#chunksSent += results.length;
      return results;
    }

    // STRUCTURED_CLONE: single chunk, no transfer list.
    // The structured-clone algorithm inside postMessage copies the object —
    // no detach concern, no ordering requirement for metadata capture.
    const seq = this.#nextSeq;
    this.#nextSeq = seqNext(this.#nextSeq);

    const frame: DataFrame = {
      [FRAME_MARKER]: 1,
      channelId: this.#channelId,
      streamId: this.#streamId,
      seqNum: seq,
      type: "DATA",
      chunkType: "STRUCTURED_CLONE",
      payload,
      isFinal: true,
    };

    this.#chunksSent += 1;
    return [{ frame, transfer: [] }];
  }

  /**
   * Reassemble incoming DataFrame chunks into the original payload.
   * Returns null until the isFinal chunk arrives, then returns the complete payload.
   * Map entry is deleted after returning to free memory.
   */
  reassemble(frame: DataFrame): unknown {
    if (frame.chunkType === "STRUCTURED_CLONE") {
      // Single-chunk: return immediately (isFinal must be true per protocol)
      if (frame.isFinal) {
        this.#chunksReceived += 1;
        return frame.payload;
      }
      return null;
    }

    // BINARY_TRANSFER: accumulate slices keyed by streamId
    const { streamId } = frame;
    let bufs = this.#reassemblyBufs.get(streamId);
    if (bufs === undefined) {
      bufs = [];
      this.#reassemblyBufs.set(streamId, bufs);
    }

    bufs.push(frame.payload as ArrayBuffer);

    if (!frame.isFinal) {
      return null;
    }

    // isFinal=true: concatenate all accumulated slices and clear the entry
    this.#reassemblyBufs.delete(streamId);

    const totalLen = bufs.reduce((acc, b) => acc + b.byteLength, 0);
    const result = new ArrayBuffer(totalLen);
    const view = new Uint8Array(result);
    let pos = 0;
    for (const buf of bufs) {
      view.set(new Uint8Array(buf), pos);
      pos += buf.byteLength;
    }

    this.#chunksReceived += 1;
    return result;
  }
}
