// src/types.ts
// Public exported types for iframebuffer.
// StreamError is the single typed error class for all adapter surfaces.

/**
 * Discriminant codes for all named stream errors.
 * Phase 3 codes: DataCloneError, ORIGIN_REJECTED, PROTOCOL_MISMATCH, CONSUMER_STALL
 * Phase 4 codes (shape declared now, wired in Phase 4):
 *   CHANNEL_FROZEN, CHANNEL_DEAD, CHANNEL_CLOSED
 */
export type ErrorCode =
  | "DataCloneError"
  | "ORIGIN_REJECTED"
  | "PROTOCOL_MISMATCH"
  | "CONSUMER_STALL"
  | "CHANNEL_FROZEN"
  | "CHANNEL_DEAD"
  | "CHANNEL_CLOSED";

/**
 * Typed error class emitted by all iframebuffer API surfaces.
 * .code is a stable discriminant for programmatic error handling.
 * .cause holds the original error when available (e.g. the native DataCloneError).
 */
export class StreamError extends Error {
  readonly code: ErrorCode;
  override readonly cause: unknown;

  constructor(code: ErrorCode, cause: unknown) {
    super(`iframebuffer: ${code}`);
    this.name = "StreamError";
    this.code = code;
    this.cause = cause;
  }
}
