// src/adapters/emitter.ts
// Node-style EventEmitter adapter over the Channel/Session layer.
// Zero deps, browser-safe — TypedEmitter is ~40 LoC using Map<event, Set<handler>>.
//
// API-02: createEmitterStream(channel, options?) → EmitterStream
//   Events: data | end | error | close | drain
//   write(chunk) → boolean  (true if more can be written, false if buffering)
//   end() → void  (graceful close: emits 'end', emits 'close', then removeAllListeners)
//
// Pattern: RESEARCH.md Pattern 4 — Minimal EventEmitter ~40 LoC
// Drain event: fires once when send credit window refills after having been exhausted.
//
// Role semantics:
//   'initiator' (default): calls channel.openStream() to initiate the handshake.
//   'responder': registers channel.onStream() and wires callbacks on stream arrival.
//   In a two-party pair, one side must be initiator, one must be responder.

import type { Channel } from "../channel/channel.js";
import { type ErrorCode, StreamError } from "../types.js";

// ---------------------------------------------------------------------------
// Typed EventEmitter base (~40 LoC, zero deps, browser-safe)
// ---------------------------------------------------------------------------

type EmitterEventMap = {
  data: [chunk: unknown];
  end: [];
  error: [err: StreamError];
  close: [];
  drain: [];
};

class TypedEmitter {
  readonly #handlers = new Map<keyof EmitterEventMap, Set<(...args: unknown[]) => void>>();

  on<K extends keyof EmitterEventMap>(
    event: K,
    handler: (...args: EmitterEventMap[K]) => void,
  ): this {
    if (!this.#handlers.has(event)) {
      this.#handlers.set(event, new Set());
    }
    this.#handlers.get(event)?.add(handler as (...args: unknown[]) => void);
    return this;
  }

  off<K extends keyof EmitterEventMap>(
    event: K,
    handler: (...args: EmitterEventMap[K]) => void,
  ): this {
    this.#handlers.get(event)?.delete(handler as (...args: unknown[]) => void);
    return this;
  }

  once<K extends keyof EmitterEventMap>(
    event: K,
    handler: (...args: EmitterEventMap[K]) => void,
  ): this {
    const wrapper = (...args: unknown[]): void => {
      this.off(event, wrapper as (...args: EmitterEventMap[K]) => void);
      (handler as (...args: unknown[]) => void)(...args);
    };
    return this.on(event, wrapper as (...args: EmitterEventMap[K]) => void);
  }

  protected emit<K extends keyof EmitterEventMap>(event: K, ...args: EmitterEventMap[K]): void {
    this.#handlers.get(event)?.forEach((h) => {
      h(...args);
    });
  }

  /**
   * Remove all listeners. Called after emitting 'close' to prevent listener leaks (LIFE-05).
   */
  removeAllListeners(): void {
    this.#handlers.clear();
  }
}

// ---------------------------------------------------------------------------
// EmitterStream public interface
// ---------------------------------------------------------------------------

/** Options for {@link createEmitterStream}. */
export interface EmitterOptions {
  /**
   * Stream role for this end of the connection.
   * 'initiator' (default): calls channel.openStream() to start the handshake.
   * 'responder': registers channel.onStream() and waits for the remote OPEN frame.
   * Use 'initiator' for the side that initiates the connection;
   * use 'responder' for the side that accepts it.
   */
  role?: "initiator" | "responder";
  /** Phase 4: hooks?: SessionHooks */
  hooks?: Record<string, never>;
}

/**
 * Node-style event emitter returned by {@link createEmitterStream}.
 * Emits `data`, `end`, `error`, `close`, and `drain`.
 */
export interface EmitterStream {
  /** Register a handler for `event`. Returns this for chaining. */
  on<K extends keyof EmitterEventMap>(
    event: K,
    handler: (...args: EmitterEventMap[K]) => void,
  ): this;
  /** Remove a previously-registered handler for `event`. Returns this for chaining. */
  off<K extends keyof EmitterEventMap>(
    event: K,
    handler: (...args: EmitterEventMap[K]) => void,
  ): this;
  /** Register a handler that fires at most once for `event`. Returns this for chaining. */
  once<K extends keyof EmitterEventMap>(
    event: K,
    handler: (...args: EmitterEventMap[K]) => void,
  ): this;
  /** Remove every registered handler on this emitter. Called automatically on `close`. */
  removeAllListeners(): void;
  /**
   * Send a chunk to the remote side.
   * Returns true if more data can be written immediately (send credit available).
   * Returns false if the internal queue is full (backpressure — wait for 'drain').
   * Node.js stream write() semantics.
   */
  write(chunk: unknown): boolean;
  /**
   * Gracefully close the stream.
   * Emits 'end', emits 'close', then removes all listeners (LIFE-05).
   */
  end(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Node-style EventEmitter wrapper over the session.
 * Events: data, end, error, close, drain.
 *
 * write() returns boolean: true if more can be written, false if buffering.
 * drain fires exactly when the credit window refills after being exhausted.
 *
 * @param channel - The Channel to wrap.
 * @param options - Optional configuration, including role ('initiator' | 'responder').
 */
export function createEmitterStream(channel: Channel, options?: EmitterOptions): EmitterStream {
  const role = options?.role ?? "initiator";

  // Track whether backpressure is currently active.
  // drain fires only when transitioning from backpressure → no-backpressure.
  let backpressureActive = false;

  // Queued writes that arrived before the session was ready (responder role).
  const pendingWrites: unknown[] = [];

  class EmitterStreamImpl extends TypedEmitter implements EmitterStream {
    // Session is wired in once we have a StreamHandle (either immediately or on inbound OPEN).
    #session: import("../session/index.js").Session | null = null;
    // Channel reference kept for close()
    #channel: Channel = channel;

    constructor() {
      super();

      if (role === "initiator") {
        // Initiator: call openStream() now — sends OPEN frame.
        const streamHandle = channel.openStream();
        this.#wireSession(streamHandle.session);
      } else {
        // Responder: wait for the remote OPEN frame.
        channel.onStream((streamHandle) => {
          this.#wireSession(streamHandle.session);
          // Flush any writes queued before the session was ready.
          for (const chunk of pendingWrites.splice(0)) {
            streamHandle.session.sendData(chunk, "STRUCTURED_CLONE");
          }
        });
      }
    }

    #wireSession(session: import("../session/index.js").Session): void {
      this.#session = session;

      // Wire inbound chunks → 'data' event
      session.onChunk((chunk: unknown) => {
        this.emit("data", chunk);
      });

      // Wire session errors → 'error' event (OBS-02: CREDIT_DEADLOCK replaces CONSUMER_STALL)
      session.onError((reason: string) => {
        // Map 'consumer-stall' from CreditWindow to the OBS-02 typed code CREDIT_DEADLOCK.
        // All other reasons pass through as CREDIT_DEADLOCK for now (conservative fallback).
        const code: ErrorCode = reason === "consumer-stall" ? "CREDIT_DEADLOCK" : "CREDIT_DEADLOCK";
        this.emit("error", new StreamError(code, new Error(reason)));
      });

      // Wire credit refill → 'drain' event (API-02)
      session.onCreditRefill(() => {
        if (backpressureActive) {
          backpressureActive = false;
          this.emit("drain");
        }
      });
    }

    write(chunk: unknown): boolean {
      if (this.#session === null) {
        // Session not yet ready (responder waiting for OPEN frame).
        // Queue the write and return true (optimistic — we don't know credits yet).
        pendingWrites.push(chunk);
        return true;
      }
      this.#session.sendData(chunk, "STRUCTURED_CLONE");
      // desiredSize > 0 means send credit is available for more writes
      const hasRoom = this.#session.desiredSize > 0;
      if (!hasRoom) {
        backpressureActive = true;
      }
      return hasRoom;
    }

    end(): void {
      // Close the underlying channel (sends CLOSE frame via session)
      this.#channel.close();

      // Emit lifecycle events while listeners are still registered
      this.emit("end");
      this.emit("close");

      // Clear all listeners AFTER emitting close to prevent future leaks (LIFE-05)
      this.removeAllListeners();
    }
  }

  return new EmitterStreamImpl();
}
