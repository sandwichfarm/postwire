// src/session/index.ts
// Stub — implementation in 02-05-PLAN.md (Wave 2)
import type { Frame } from "../framing/types.js";
import type { StreamState } from "./fsm.js";

export type { ChunkerOptions, ChunkResult } from "./chunker.js";
export type { CreditWindowOptions } from "./credit-window.js";
export type {
  IllegalTransitionError,
  StreamEvent,
  StreamState,
} from "./fsm.js";
export type { ReorderBufferOptions } from "./reorder-buffer.js";

export interface SessionOptions {
  channelId: string;
  streamId: number;
  role: "initiator" | "responder";
  maxReorderBuffer?: number;
  initialCredit?: number;
  highWaterMark?: number;
  maxChunkSize?: number;
  stallTimeoutMs?: number;
  onMetrics?: (event: never) => void;
}

export class Session {
  readonly state: StreamState = "IDLE";

  constructor(_opts: SessionOptions) {}
  receiveFrame(_frame: Frame): void {}
  sendData(_payload: unknown, _chunkType: "BINARY_TRANSFER" | "STRUCTURED_CLONE"): void {}
  close(): void {}
  cancel(_reason: string): void {}
  reset(_reason: string): void {}
  onFrameOut(_cb: (frame: Frame, transfer?: ArrayBuffer[]) => void): void {}
  onChunk(_cb: (chunk: unknown) => void): void {}
  onError(_cb: (reason: string) => void): void {}
  get desiredSize(): number {
    return 0;
  }
}
