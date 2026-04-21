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

import type { Channel } from "../channel/channel.js";
import { StreamError } from "../types.js";

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

export interface EmitterOptions {
  /** Phase 4: hooks?: SessionHooks */
  hooks?: Record<string, never>;
}

export interface EmitterStream {
  on<K extends keyof EmitterEventMap>(
    event: K,
    handler: (...args: EmitterEventMap[K]) => void,
  ): this;
  off<K extends keyof EmitterEventMap>(
    event: K,
    handler: (...args: EmitterEventMap[K]) => void,
  ): this;
  once<K extends keyof EmitterEventMap>(
    event: K,
    handler: (...args: EmitterEventMap[K]) => void,
  ): this;
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
 */
export function createEmitterStream(channel: Channel, _options?: EmitterOptions): EmitterStream {
  const stream = channel.openStream();
  const session = stream.session;

  // Track whether backpressure is currently active.
  // drain fires only when transitioning from backpressure → no-backpressure.
  let backpressureActive = false;

  class EmitterStreamImpl extends TypedEmitter implements EmitterStream {
    constructor() {
      super();

      // Wire inbound chunks → 'data' event
      session.onChunk((chunk: unknown) => {
        this.emit("data", chunk);
      });

      // Wire session errors → 'error' event
      session.onError((reason: string) => {
        const code = reason === "consumer-stall" ? "CONSUMER_STALL" : "CONSUMER_STALL";
        this.emit("error", new StreamError(code, new Error(reason)));
      });

      // Wire credit refill → 'drain' event
      // Session calls this after draining #pendingSends on CREDIT/OPEN_ACK receipt.
      session.onCreditRefill(() => {
        if (backpressureActive) {
          backpressureActive = false;
          this.emit("drain");
        }
      });
    }

    write(chunk: unknown): boolean {
      session.sendData(chunk, "STRUCTURED_CLONE");
      // desiredSize > 0 means send credit is available for more writes
      const hasRoom = session.desiredSize > 0;
      if (!hasRoom) {
        backpressureActive = true;
      }
      return hasRoom;
    }

    end(): void {
      // Close the underlying channel (sends CLOSE frame)
      channel.close();

      // Emit lifecycle events while listeners are still registered
      this.emit("end");
      this.emit("close");

      // Clear all listeners AFTER emitting close to prevent future leaks (LIFE-05)
      this.removeAllListeners();
    }
  }

  return new EmitterStreamImpl();
}
