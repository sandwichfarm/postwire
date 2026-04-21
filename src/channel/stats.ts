// src/channel/stats.ts
// Snapshot types for channel and stream observability (OBS-01, OBS-03).
// These are plain data interfaces — no reactive state, no proxies.
// Callers poll channel.stats() to read a snapshot; trace events handle streaming observability.
import type { FrameType } from "../framing/types.js";

/**
 * Per-stream stats snapshot (OBS-01).
 * Returned as part of ChannelStats.streams[].
 */
export interface StreamStats {
  streamId: number;
  bytesSent: number;
  bytesReceived: number;
  /** Counts of each frame type seen on this stream (both directions combined). */
  frameCountsByType: Partial<Record<FrameType, number>>;
  /** Current CreditWindow.sendCredit — frames that can still be sent without waiting. */
  creditWindowAvailable: number;
  /** Current ReorderBuffer.bufferSize — out-of-order frames currently buffered. */
  reorderBufferDepth: number;
  chunkerChunksSent: number;
  chunkerChunksReceived: number;
}

/**
 * Channel-level stats snapshot (OBS-01).
 * Returned by channel.stats() after Plan 01 wires the counters.
 */
export interface ChannelStats {
  streams: StreamStats[];
  aggregate: {
    bytesSent: number;
    bytesReceived: number;
  };
  /**
   * True when the SAB fast path is active on this channel (Phase 6, FAST-04).
   * False when using the postMessage-transferable path (default, or after fallback).
   */
  sabActive: boolean;
}

/** Direction of a per-frame trace event. */
export type TraceDirection = "in" | "out";

/**
 * Per-frame trace event emitted on channel.on('trace', ...) when trace option is true (OBS-03).
 * Opt-in: disabled by default; enable via createChannel(ep, { trace: true }).
 */
export interface TraceEvent {
  /** performance.now() timestamp at the point the frame was sent/received. */
  timestamp: number;
  direction: TraceDirection;
  /** Frame['type'] discriminant string (e.g. 'DATA', 'OPEN', 'CAPABILITY'). */
  frameType: string;
  streamId: number;
  /** frame.seqNum */
  seq: number;
  /** Only present for DATA + BINARY_TRANSFER frames. */
  byteLength?: number;
}
