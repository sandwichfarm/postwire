// src/session/reorder-buffer.ts
// Stub — implementation in 02-01-PLAN.md (Wave 1)
import type { DataFrame } from "../framing/types.js";

export interface ReorderBufferOptions {
  maxReorderBuffer?: number;
}

export class ReorderBuffer {
  constructor(_initSeq: number, _opts?: ReorderBufferOptions) {}
  insert(_frame: DataFrame): DataFrame[] {
    return [];
  }
  get nextExpected(): number {
    return 0;
  }
}
