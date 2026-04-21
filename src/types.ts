// src/types.ts
// Public exported types for iframebuffer.
// StreamError is the single typed error class for all adapter surfaces.

/**
 * Discriminant codes for all named stream errors.
 * Phase 3 codes: DataCloneError, ORIGIN_REJECTED, PROTOCOL_MISMATCH, CONSUMER_STALL
 * Phase 4 codes: CREDIT_DEADLOCK, REORDER_OVERFLOW, CHANNEL_FROZEN, CHANNEL_DEAD, CHANNEL_CLOSED
 *   CONSUMER_STALL kept for backward compat with emitter.ts (renamed to CREDIT_DEADLOCK in Plan 04).
 * Phase 6 codes: SAB_INIT_FAILED — SAB handshake failed; channel fell back to postMessage.
 */
export type ErrorCode =
  | "DataCloneError"
  | "ORIGIN_REJECTED"
  | "PROTOCOL_MISMATCH"
  | "CONSUMER_STALL"
  | "CREDIT_DEADLOCK"
  | "REORDER_OVERFLOW"
  | "CHANNEL_FROZEN"
  | "CHANNEL_DEAD"
  | "CHANNEL_CLOSED"
  | "SAB_INIT_FAILED";

/**
 * Typed error class emitted by all iframebuffer API surfaces.
 * .code is a stable discriminant for programmatic error handling.
 * .cause holds the original error when available (e.g. the native DataCloneError).
 * .streamId optionally identifies the stream that raised the error (Phase 4, OBS-02).
 */
export class StreamError extends Error {
  readonly code: ErrorCode;
  override readonly cause: unknown;
  /** Optional stream-level error correlation (Phase 4, OBS-02). */
  readonly streamId?: number;

  constructor(code: ErrorCode, cause: unknown, streamId?: number) {
    super(`iframebuffer: ${code}`);
    this.name = "StreamError";
    this.code = code;
    this.cause = cause;
    this.streamId = streamId;
  }
}
