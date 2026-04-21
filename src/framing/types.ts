// src/framing/types.ts
// Wire protocol frame type definitions for iframebuffer
// FRAME_MARKER is a string literal (NOT a Symbol) — Symbols are not structured-cloneable
// and would be silently dropped by postMessage.

export const FRAME_MARKER = "__ibf_v1__" as const;
export const PROTOCOL_VERSION: number = 1;

/** Identifies the data transfer strategy in a DATA frame */
export type ChunkType = "BINARY_TRANSFER" | "STRUCTURED_CLONE" | "STREAM_REF" | "SAB_SIGNAL";

/** Common header present on every frame */
export interface BaseFrame {
  [FRAME_MARKER]: 1;
  channelId: string;
  streamId: number;
  seqNum: number;
}

export interface OpenFrame extends BaseFrame {
  type: "OPEN";
  initCredit: number;
}

export interface OpenAckFrame extends BaseFrame {
  type: "OPEN_ACK";
  initCredit: number;
}

export interface DataFrame extends BaseFrame {
  type: "DATA";
  chunkType: ChunkType;
  payload: unknown;
  isFinal: boolean;
}

export interface CreditFrame extends BaseFrame {
  type: "CREDIT";
  credit: number;
}

export interface CloseFrame extends BaseFrame {
  type: "CLOSE";
  finalSeq: number;
}

export interface CancelFrame extends BaseFrame {
  type: "CANCEL";
  reason: string;
}

export interface ResetFrame extends BaseFrame {
  type: "RESET";
  reason: string;
}

/**
 * CAPABILITY frame — exchanged once at channel open to negotiate protocol version
 * and feature flags. Both sides compute min(local, remote) and cache for the channel lifetime.
 * Required by PROTO-04 and PROTO-05.
 */
export interface CapabilityFrame extends BaseFrame {
  type: "CAPABILITY";
  protocolVersion: number;
  sab: boolean;
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
