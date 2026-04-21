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

  // Reassembly map: streamId → accumulated ArrayBuffer slices
  readonly #reassemblyBufs: Map<number, ArrayBuffer[]> = new Map<number, ArrayBuffer[]>();

  constructor(initSeq: number, opts: ChunkerOptions) {
    this.#nextSeq = initSeq >>> 0;
    this.#channelId = opts.channelId;
    this.#streamId = opts.streamId;
    this.#maxChunkSize = opts.maxChunkSize ?? 65536;
  }

  /**
   * Split a payload into one or more DataFrame chunks.
   * For BINARY_TRANSFER: each chunk gets its own ArrayBuffer slice via ab.slice().
   * The slice is a copy — the original `ab` is NOT in any transfer list, so it
   * is never detached here. The caller (Transport) will transfer each slice
   * individually via postMessage.
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

        // STEP 3: Create a copy via slice — each chunk owns its own ArrayBuffer.
        // The original `ab` is never placed in a transfer list; each slice can be
        // transferred independently by the Transport layer.
        const slice = ab.slice(offset, offset + chunkSize);

        // STEP 4: Build frame with the slice as payload.
        // All metadata fields (isFinal, seqNum, chunkType) were captured above —
        // no metadata field reads the slice or original after this point.
        const frame: DataFrame = {
          [FRAME_MARKER]: 1,
          channelId: this.#channelId,
          streamId: this.#streamId,
          seqNum: seq,
          type: "DATA",
          chunkType: "BINARY_TRANSFER",
          payload: slice,
          isFinal,
        };

        // STEP 5: Transfer list contains the slice (not the original ab).
        results.push({ frame, transfer: [slice] });
        offset += chunkSize;
      } while (offset < total);

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
      return frame.isFinal ? frame.payload : null;
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

    return result;
  }
}
