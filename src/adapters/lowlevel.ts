// src/adapters/lowlevel.ts
// Low-level send/onChunk/close adapter — the primitive all higher adapters compose on.
// Per API-01 and CONTEXT.md locked decision.
// MUST NOT import from emitter.ts or streams.ts — tree-shakeable independence (API-04).

import type { Channel } from "../channel/channel.js";
import type { SessionOptions } from "../session/index.js";
import { StreamError } from "../types.js";

export interface LowLevelOptions {
  /** Session options forwarded to Channel.openStream(). */
  sessionOptions?: Partial<SessionOptions>;
}

export interface LowLevelStream {
  /**
   * Send a chunk. If transfer is provided, the payload is sent via BINARY_TRANSFER
   * (ArrayBuffer ownership is transferred — source byteLength becomes 0 post-send).
   * If omitted, STRUCTURED_CLONE path is used.
   *
   * Resolves after the frame is handed to endpoint.postMessage (or queued in session
   * if send credits are exhausted). The call is async to model the credit-await contract.
   */
  send(chunk: unknown, transfer?: ArrayBuffer[]): Promise<void>;

  /** Register callback for each reassembled inbound chunk. */
  onChunk(cb: (chunk: unknown) => void): void;

  /** Register callback for graceful stream close (remote sent CLOSE + all data delivered). */
  onClose(cb: () => void): void;

  /** Register callback for stream errors (stall, reset, cancel, DataCloneError). */
  onError(cb: (err: StreamError) => void): void;

  /** Gracefully close: sends CLOSE frame with correct finalSeq. */
  close(): void;
}

/**
 * Create a low-level stream handle wrapping the given channel.
 * This is the outbound (initiator) path. For inbound (responder) streams, use
 * channel.onStream() which delivers a StreamHandle that you can wrap the same way.
 *
 * per D-locked decision in CONTEXT.md: createLowLevelStream(channel, options?)
 */
export function createLowLevelStream(channel: Channel, options?: LowLevelOptions): LowLevelStream {
  const handle = channel.openStream(options?.sessionOptions);
  const { session } = handle;

  return {
    async send(chunk: unknown, transfer?: ArrayBuffer[]): Promise<void> {
      // Determine chunk type based on whether a transfer list was supplied.
      // BINARY_TRANSFER: ArrayBuffer ownership transferred — source detaches (FAST-01).
      // STRUCTURED_CLONE: arbitrary cloneable value (FAST-03: DataCloneError surfaced via
      //   Channel.sendFrame's try/catch, not here).
      const chunkType =
        transfer !== undefined && transfer.length > 0 ? "BINARY_TRANSFER" : "STRUCTURED_CLONE";
      // session.sendData() either emits immediately (if credit available) or queues.
      // The session's #drainPendingSends() will flush the queue when credits arrive.
      session.sendData(chunk, chunkType);
      // Resolve immediately after handoff to session — session manages the credit queue.
      // The WritableStream adapter (Plan 04) implements deeper backpressure; this
      // low-level adapter resolves after the logical enqueue.
    },

    onChunk(cb: (chunk: unknown) => void): void {
      session.onChunk(cb);
    },

    onClose(cb: () => void): void {
      // Wire to session FSM CLOSED state via observable state transitions.
      // Session reaches CLOSED when both sides have exchanged CLOSE frames and
      // all DATA up to finalSeq has been delivered.
      // We observe via: after each inbound chunk OR error notification,
      // check if the session FSM has transitioned to CLOSED.
      session.onChunk((_chunk: unknown) => {
        if (session.state === "CLOSED") cb();
      });
      session.onError((_reason: string) => {
        if (session.state === "CLOSED") cb();
      });
    },

    onError(cb: (err: StreamError) => void): void {
      session.onError((reason: string) => {
        // Map session error reason string to StreamError.
        // The session fires 'consumer-stall' for stall timeout,
        // 'DataCloneError' for clone errors (routed via channel),
        // and arbitrary reason strings for RESET/CANCEL.
        if (reason === "consumer-stall") {
          cb(new StreamError("CONSUMER_STALL", undefined));
        } else if (reason === "DataCloneError") {
          cb(new StreamError("DataCloneError", undefined));
        } else {
          // Generic session error (RESET/CANCEL reason string)
          cb(new StreamError("CONSUMER_STALL", new Error(reason)));
        }
      });
    },

    close(): void {
      channel.close();
    },
  };
}
