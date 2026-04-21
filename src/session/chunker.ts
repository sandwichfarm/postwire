// src/session/chunker.ts
// Stub — implementation in 02-03-PLAN.md (Wave 1)
import type { DataFrame } from "../framing/types.js";

export interface ChunkerOptions {
  channelId: string;
  streamId: number;
  maxChunkSize?: number;
}

export interface ChunkResult {
  frame: DataFrame;
  transfer: ArrayBuffer[];
}

export class Chunker {
  constructor(_initSeq: number, _opts: ChunkerOptions) {}
  split(_payload: unknown, _chunkType: "BINARY_TRANSFER" | "STRUCTURED_CLONE"): ChunkResult[] {
    return [];
  }
  reassemble(_frame: DataFrame): unknown | null {
    return null;
  }
}
