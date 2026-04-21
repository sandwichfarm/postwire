// src/framing/encode-decode.ts
// Pure encode/decode functions for iframebuffer wire protocol frames.
// encode() is the identity function in Phase 1 — frames are already structured-clone-friendly
// plain objects. This function is a seam for future binary encoding if benchmarks justify it.
// decode() validates the namespace marker, base fields, and type-specific required fields.
// It NEVER throws — all invalid/malformed inputs return null.

import type { Frame } from "./types.js";
import { FRAME_MARKER } from "./types.js";

/**
 * Encode a Frame into a structured-clone-friendly object safe to pass to postMessage.
 * Phase 1: identity function — frames are already plain objects.
 * This is a seam for future byte-level wire encoding.
 */
export function encode(frame: Frame): Record<string, unknown> {
  return frame as unknown as Record<string, unknown>;
}

/**
 * Decode an unknown message into a Frame, or return null.
 *
 * Returns null for:
 * - null, non-objects, arrays
 * - missing __ibf_v1__ marker
 * - missing or non-string type discriminant
 * - missing required BaseFrame fields (channelId, streamId, seqNum)
 * - unknown type values
 * - type-specific required fields missing or wrong type
 *
 * Never throws — all paths return Frame | null.
 */
export function decode(msg: unknown): Frame | null {
  try {
    if (msg === null || typeof msg !== "object" || Array.isArray(msg)) return null;
    const m = msg as Record<string, unknown>;
    if (m[FRAME_MARKER] !== 1) return null;
    if (typeof m.type !== "string") return null;
    // Validate required BaseFrame fields
    if (typeof m.channelId !== "string") return null;
    if (typeof m.streamId !== "number") return null;
    if (typeof m.seqNum !== "number") return null;
    // Type-specific validation
    switch (m.type) {
      case "OPEN":
      case "OPEN_ACK":
        if (typeof m.initCredit !== "number") return null;
        return msg as Frame;
      case "DATA":
        if (typeof m.payload === "undefined") return null;
        if (typeof m.isFinal !== "boolean") return null;
        return msg as Frame;
      case "CREDIT":
        if (typeof m.credit !== "number") return null;
        return msg as Frame;
      case "CLOSE":
        if (typeof m.finalSeq !== "number") return null;
        return msg as Frame;
      case "CANCEL":
      case "RESET":
        if (typeof m.reason !== "string") return null;
        return msg as Frame;
      case "CAPABILITY":
        if (typeof m.protocolVersion !== "number") return null;
        if (typeof m.sab !== "boolean") return null;
        if (typeof m.transferableStreams !== "boolean") return null;
        return msg as Frame;
      default:
        return null;
    }
  } catch {
    return null;
  }
}
