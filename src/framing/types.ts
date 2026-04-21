// src/framing/types.ts
// Wire protocol frame type definitions for postwire
// FRAME_MARKER is a string literal (NOT a Symbol) — Symbols are not structured-cloneable
// and would be silently dropped by postMessage.

/**
 * Namespace marker string stamped on every postwire frame.
 * A string literal (not a Symbol) so it survives structured-clone across postMessage.
 */
export const FRAME_MARKER = "__pw_v1__" as const;

/** Current wire protocol version. Bumped on any incompatible frame-shape change. */
export const PROTOCOL_VERSION: number = 1;

/** Identifies the data transfer strategy in a DATA frame. */
export type ChunkType = "BINARY_TRANSFER" | "STRUCTURED_CLONE" | "STREAM_REF" | "SAB_SIGNAL";

/** Common header present on every frame. */
export interface BaseFrame {
  /** Namespace marker — always the literal `1`, keyed by {@link FRAME_MARKER}. */
  [FRAME_MARKER]: 1;
  /** Channel identifier shared by both endpoints. */
  channelId: string;
  /** Per-channel stream identifier (allocated by {@link Channel.openStream}). */
  streamId: number;
  /** Monotonic, wraparound-safe 32-bit sequence number. */
  seqNum: number;
}

/** Initiator→responder stream-open request carrying the initial receive credit. */
export interface OpenFrame extends BaseFrame {
  /** Frame discriminant. */
  type: "OPEN";
  /** Number of DATA frames the responder may send before waiting for CREDIT. */
  initCredit: number;
}

/** Responder→initiator acknowledgement of OPEN with the responder's initial credit. */
export interface OpenAckFrame extends BaseFrame {
  /** Frame discriminant. */
  type: "OPEN_ACK";
  /** Number of DATA frames the initiator may send before waiting for CREDIT. */
  initCredit: number;
}

/** Payload-bearing frame. One DATA frame transports one chunk of a blob/object. */
export interface DataFrame extends BaseFrame {
  /** Frame discriminant. */
  type: "DATA";
  /** Payload transport strategy (binary transfer, structured clone, etc.). */
  chunkType: ChunkType;
  /** Arbitrary payload. Shape depends on `chunkType`. */
  payload: unknown;
  /** True when this is the final chunk of a single item (not the final frame of the stream). */
  isFinal: boolean;
}

/** Flow-control frame: grants the remote side `credit` more DATA frames. */
export interface CreditFrame extends BaseFrame {
  /** Frame discriminant. */
  type: "CREDIT";
  /** Additional DATA frames the remote may send. */
  credit: number;
}

/** Graceful close: sender will send no more DATA frames after `finalSeq`. */
export interface CloseFrame extends BaseFrame {
  /** Frame discriminant. */
  type: "CLOSE";
  /** seqNum of the last DATA frame the sender will ever emit on this stream. */
  finalSeq: number;
}

/** Receiver-initiated cancellation — tells the producer to stop sending. */
export interface CancelFrame extends BaseFrame {
  /** Frame discriminant. */
  type: "CANCEL";
  /** Human-readable reason for the cancellation. */
  reason: string;
}

/** Hard reset — session has failed; all queued frames are discarded on both sides. */
export interface ResetFrame extends BaseFrame {
  /** Frame discriminant. */
  type: "RESET";
  /** Human-readable reason for the reset. */
  reason: string;
}

/**
 * CAPABILITY frame — exchanged once at channel open to negotiate protocol version
 * and feature flags. Both sides compute min(local, remote) and cache for the channel lifetime.
 * Required by PROTO-04 and PROTO-05.
 */
export interface CapabilityFrame extends BaseFrame {
  /** Frame discriminant. */
  type: "CAPABILITY";
  /** Sender's {@link PROTOCOL_VERSION}. Both sides take the min. */
  protocolVersion: number;
  /** True when the sender can use the SharedArrayBuffer fast path. */
  sab: boolean;
  /** True when the sender can use transferable ReadableStream for zero-copy hand-off. */
  transferableStreams: boolean;
  /** Phase 8: opt-in multiplex mode. Both sides must advertise true for merged=true. */
  multiplex?: boolean;
}

/** Discriminated union of all eight wire protocol frame types */
export type Frame =
  | OpenFrame
  | OpenAckFrame
  | DataFrame
  | CreditFrame
  | CloseFrame
  | CancelFrame
  | ResetFrame
  | CapabilityFrame;

/** String discriminant union of all frame type values. */
export type FrameType = Frame["type"];
