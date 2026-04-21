// src/adapters/streams.ts
// WHATWG Streams adapter: createStream(channel, options?) → { readable, writable }
//
// WritableStream backpressure wiring (RESEARCH.md Pattern 2):
//   - sink.write(chunk) calls session.sendData() — session queues if no credit.
//   - WritableStream highWaterMark = initialCredit — WHATWG desiredSize signal aligns
//     with the credit window depth.
//   - When all queued writes have been processed by the session, desiredSize returns
//     positive and writer.ready resolves (two-queue design: WHATWG + Session #pendingSends).
//
// ReadableStream pull source (RESEARCH.md Pattern 3):
//   - pull(controller) enqueues from pendingChunks buffer or waits for next onChunk.
//   - highWaterMark = 0 so pull() is called only when the reader is actively waiting —
//     credit window is the sole backpressure gate.
//
// DataCloneError (RESEARCH.md Pattern 1 + PITFALLS Pitfall 2):
//   - Channel.#sendRaw wraps postMessage in try/catch — catches synchronous throw.
//   - Channel routes DataCloneError as session.reset('DataCloneError').
//   - session.onError() fires with 'DataCloneError' reason.
//   - Adapter's onError handler surfaces it as StreamError{code:'DataCloneError'}.
//   - Stream does NOT go silent — controller.error() is called on both sides.
//
// Zero cross-imports between adapters: streams.ts imports only from channel and types.
// (API-04 tree-shaking invariant)

import type { Channel, StreamHandle } from "../channel/channel.js";
import type { SessionOptions } from "../session/index.js";
import { StreamError } from "../types.js";

export interface StreamsOptions {
  /**
   * Session options forwarded to channel.openStream().
   * Phase 4 will add hooks?: SessionHooks here.
   */
  sessionOptions?: Partial<SessionOptions>;
}

export interface StreamsPair {
  readable: ReadableStream<unknown>;
  writable: WritableStream<unknown>;
}

/**
 * WHATWG Streams adapter with full backpressure integration.
 *
 * Returns a { readable, writable } pair backed by a single stream session.
 * The caller writes to `writable` and the remote reads from `readable` (and
 * vice versa — the session is full-duplex).
 *
 * Backpressure:
 *   - WritableStream.write() returns a Promise that resolves only after
 *     session.sendData() accepts the frame (immediately if credit available,
 *     or after CREDIT frame arrives if session is credit-exhausted).
 *   - ReadableStream uses pull source with highWaterMark: 0 so the credit
 *     window is the sole gate on the reader side.
 *
 * DataCloneError:
 *   - Non-cloneable values throw synchronously from postMessage (verified in
 *     Node 22 + browser MessagePort spec). Channel.#sendRaw catches this and
 *     calls session.reset('DataCloneError'). The adapter surfaces it as
 *     StreamError{code:'DataCloneError'} via controller.error().
 *     The stream never goes silent (FAST-03).
 */
export function createStream(channel: Channel, options?: StreamsOptions): StreamsPair {
  // Open the outbound session — session is in IDLE state until open() sends OPEN frame.
  const handle: StreamHandle = channel.openStream(options?.sessionOptions);
  const { session } = handle;

  // Default initial credit from session options (fallback to 16 — SessionOptions default).
  const initialCredit: number =
    (options?.sessionOptions?.initialCredit as number | undefined) ?? 16;

  // ---------------------------------------------------------------------------
  // Shared state between readable and writable sides
  // ---------------------------------------------------------------------------

  // Chunks received from the remote side, buffered until the reader calls pull().
  // Bounded by the credit window — session won't deliver more DATA frames than recv credits.
  const pendingChunks: unknown[] = [];

  // Pending pull() resolver: set when pull() is called but no chunks are available yet.
  let pullResolve: (() => void) | null = null;

  // Readable controller — captured once start() fires.
  let readableController: ReadableStreamDefaultController<unknown> | null = null;

  // Error state — set when session fires onError.
  let streamError: StreamError | null = null;

  // ---------------------------------------------------------------------------
  // Session callbacks
  // ---------------------------------------------------------------------------

  // Wire inbound chunks → readable side
  session.onChunk((chunk: unknown): void => {
    if (pullResolve !== null) {
      // pull() is waiting — enqueue immediately and resolve the pending pull Promise.
      readableController?.enqueue(chunk);
      const resolve = pullResolve;
      pullResolve = null;
      resolve();
    } else {
      // No active pull — buffer the chunk (bounded by credit window).
      pendingChunks.push(chunk);
    }
  });

  // Wire session errors → both stream controllers
  session.onError((reason: string): void => {
    // Map reason string to the closest StreamError code.
    let code: StreamError["code"];
    if (reason === "DataCloneError") {
      code = "DataCloneError";
    } else if (reason === "consumer-stall") {
      code = "CONSUMER_STALL";
    } else {
      // Treat all other reasons (CANCEL, RESET from remote) as CHANNEL_DEAD.
      code = "CHANNEL_DEAD";
    }
    const err = new StreamError(code, undefined);
    streamError = err;

    // Surface on readable side — if pull() is waiting, reject it; otherwise error the controller.
    if (pullResolve !== null) {
      const resolve = pullResolve;
      pullResolve = null;
      // Resolve the pending pull so the Streams engine calls pull() again — it will see the error.
      resolve();
    }
    readableController?.error(err);
  });

  // ---------------------------------------------------------------------------
  // ReadableStream (pull source, HWM = 0)
  // ---------------------------------------------------------------------------

  const readable = new ReadableStream<unknown>(
    {
      start(controller: ReadableStreamDefaultController<unknown>): void {
        readableController = controller;
      },

      pull(controller: ReadableStreamDefaultController<unknown>): Promise<void> | void {
        // If an error already occurred, let the Streams engine surface it.
        if (streamError !== null) {
          controller.error(streamError);
          return;
        }

        // Drain buffered chunks first.
        if (pendingChunks.length > 0) {
          const next = pendingChunks.shift();
          if (next !== undefined) {
            controller.enqueue(next);
          }
          return;
        }

        // No chunks available — return a pending Promise.
        // session.onChunk will call resolve() when data arrives.
        return new Promise<void>((resolve) => {
          pullResolve = resolve;
        });
      },

      cancel(reason: unknown): void {
        // Consumer cancelled the readable — send CANCEL frame to remote.
        session.cancel(String(reason ?? "consumer-cancel"));
      },
    },
    // HWM = 0: pull() is called only when the reader is actively waiting.
    // Credit window is the sole backpressure gate (SESS-03).
    new CountQueuingStrategy({ highWaterMark: 0 }),
  );

  // ---------------------------------------------------------------------------
  // WritableStream (sink, HWM = initialCredit)
  // ---------------------------------------------------------------------------

  const writable = new WritableStream<unknown>(
    {
      write(chunk: unknown): Promise<void> {
        // If session has already errored, reject immediately.
        if (streamError !== null) {
          return Promise.reject(streamError);
        }

        // session.sendData() either sends immediately (if credit available) or
        // queues in session.#pendingSends (credit-gated, drained on CREDIT frame).
        // The Promise resolves synchronously after sendData() returns because
        // session-level queuing is our backpressure gate.
        //
        // DataCloneError path: Channel.#sendRaw wraps postMessage in try/catch.
        // On DataCloneError, Channel calls session.reset('DataCloneError').
        // session.onError fires → streamError is set (above) → next write() rejects.
        session.sendData(chunk, "STRUCTURED_CLONE");
        return Promise.resolve();
      },

      close(): Promise<void> {
        // Graceful close: process all pending sends, then send CLOSE frame.
        channel.close();
        return Promise.resolve();
      },

      abort(reason: unknown): Promise<void> {
        // Hard abort: discard queued sends, send RESET frame.
        session.reset(String(reason ?? "writable-aborted"));
        return Promise.resolve();
      },
    },
    // HWM = initialCredit: once initialCredit writes are queued in the WHATWG
    // Streams internal buffer, desiredSize goes to 0 and writer.ready pends.
    // This aligns the WHATWG Streams pressure signal with the credit window depth.
    new CountQueuingStrategy({ highWaterMark: initialCredit }),
  );

  return { readable, writable };
}
