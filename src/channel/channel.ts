// src/channel/channel.ts
// Channel: Layer 3 — owns one PostMessageEndpoint and drives one Session per logical stream.
// Responsibilities:
//   1. Sets endpoint.onmessage to decode incoming frames (uses decode() from framing layer)
//   2. Registers session.onFrameOut to encode + postMessage outgoing frames
//   3. Drives CAPABILITY handshake on construction; resolves #capabilityReady when remote cap arrives
//   4. Routes all non-CAPABILITY frames to Session.receiveFrame()
//   5. Catches DataCloneError from postMessage and routes to StreamError
//   6. Tracks lastDataSeqOut for Session.close(finalSeq) wiring (per RESEARCH.md Pitfall 6)
//
// NOT responsible for: stream-level protocol logic, credit accounting, reassembly.
// Those live in Session (Layer 4).

import { decode, encode } from "../framing/encode-decode.js";

/**
 * Detect if ReadableStream is transferable in this environment.
 *
 * Phase 3: Always returns false (safely disabled for initial launch).
 * Phase 5/9: Flip the guard to true and enable the actual probe.
 *
 * Design notes (RESEARCH.md FAST-02):
 *   The actual probe would use try/catch around:
 *     const rs = new ReadableStream();
 *     port1.postMessage(rs, [rs as unknown as Transferable]);
 *   If postMessage does not throw, ReadableStream is transferable in this runtime.
 *   Node 22's MessageChannel does NOT support transferable ReadableStream —
 *   this probe would return false in Node regardless of the guard below.
 *   Chrome/Firefox 120+ DO support it. The guard ensures Phase 3 always produces
 *   a CAPABILITY frame with transferableStreams: false, deferring the STREAM_REF
 *   fast path to Phase 5/9 where benchmarks validate it.
 */
function checkReadableStreamTransferable(): boolean {
  // Phase 3: safely disabled — always returns false.
  return false;

  // Phase 5/9: remove the early return above and uncomment the probe below.
  /* eslint-disable no-unreachable */
  /*
  try {
    const { port1, port2 } = new MessageChannel();
    const rs = new ReadableStream();
    port1.postMessage(rs, [rs as unknown as Transferable]);
    port1.close();
    port2.close();
    return true;
  } catch {
    return false;
  }
  */
  /* eslint-enable no-unreachable */
}

import {
  type CapabilityFrame,
  FRAME_MARKER,
  type Frame,
  PROTOCOL_VERSION,
} from "../framing/types.js";
import { Session, type SessionOptions } from "../session/index.js";
import type { PostMessageEndpoint } from "../transport/endpoint.js";
import { StreamError } from "../types.js";

export interface ChannelOptions {
  /** Identifier for this channel — shared between both sides. Default: random string. */
  channelId?: string;
  /**
   * Extension point for Phase 4 observability hooks.
   * Defaults to {} — deferred per CONTEXT.md.
   */
  hooks?: Record<string, never>;
  /** Session options forwarded to new Session() for each stream opened. */
  sessionOptions?: Partial<Omit<SessionOptions, "channelId" | "streamId" | "role">>;
}

/** Internal stream handle — NOT part of the public API. */
export interface StreamHandle {
  readonly session: Session;
  readonly channel: Channel;
}

export class Channel {
  readonly #endpoint: PostMessageEndpoint; // strong ref — prevents GC (LIFE-04)
  readonly #channelId: string;
  readonly #sessionOptions: Partial<Omit<SessionOptions, "channelId" | "streamId" | "role">>;

  // Capability negotiation — probe is evaluated once at channel construction.
  // checkReadableStreamTransferable() always returns false in Phase 3 (FAST-02).
  #localCap = { sab: false, transferableStreams: checkReadableStreamTransferable() };
  #remoteCap: { sab: boolean; transferableStreams: boolean } | null = null;
  readonly #capabilityReady: Promise<void>;
  #resolveCapability!: () => void;
  #rejectCapability!: (err: StreamError) => void;

  // Stream registry — one session per logical stream (Phase 8 mux adds more)
  #session: Session | null = null;
  #streamIdCounter = 1; // monotonically increasing, never reset (PITFALLS P15)

  // Last DATA frame seqNum emitted outbound — passed to session.close(finalSeq)
  #lastDataSeqOut = -1;

  // inbound stream callback (onStream)
  #onStreamCb: ((stream: StreamHandle) => void) | null = null;

  // error callback (channel-level errors: PROTOCOL_MISMATCH, DataCloneError)
  #onErrorCb: ((err: StreamError) => void) | null = null;

  constructor(endpoint: PostMessageEndpoint, options: ChannelOptions = {}) {
    this.#endpoint = endpoint;
    this.#channelId = options.channelId ?? crypto.randomUUID();
    this.#sessionOptions = options.sessionOptions ?? {};

    // Capability ready promise — resolves on remote CAPABILITY, rejects on PROTOCOL_MISMATCH
    this.#capabilityReady = new Promise<void>((resolve, reject) => {
      this.#resolveCapability = resolve;
      this.#rejectCapability = reject;
    });
    // Prevent unhandled rejection if nobody attaches a .catch
    this.#capabilityReady.catch(() => {
      /* swallowed — caller gets error via onError */
    });

    // Wire inbound message handler BEFORE sending CAPABILITY (avoid race)
    endpoint.onmessage = (evt: MessageEvent): void => {
      const frame = decode(evt.data);
      if (frame === null) return; // not a library frame — pass through silently

      if (frame.type === "CAPABILITY") {
        this.#handleCapability(frame as CapabilityFrame);
        return;
      }

      // Responder path: if an OPEN frame arrives with no active session, create one.
      if (frame.type === "OPEN" && this.#session === null) {
        const session = this.#createSession(frame.streamId, "responder");
        this.#session = session;
        session.receiveFrame(frame);
        if (this.#onStreamCb !== null) {
          this.#onStreamCb({ session, channel: this });
        }
        return;
      }

      // All other frames go to the active session
      this.#session?.receiveFrame(frame);
    };

    // Send our CAPABILITY frame immediately
    this.#sendCapability();
  }

  // ---------------------------------------------------------------------------
  // Capability negotiation
  // ---------------------------------------------------------------------------

  #sendCapability(): void {
    const cap: CapabilityFrame = {
      [FRAME_MARKER]: 1,
      channelId: this.#channelId,
      streamId: 0,
      seqNum: 0,
      type: "CAPABILITY",
      protocolVersion: PROTOCOL_VERSION,
      sab: this.#localCap.sab,
      transferableStreams: this.#localCap.transferableStreams,
    };
    this.#sendRaw(encode(cap), []);
  }

  #handleCapability(frame: CapabilityFrame): void {
    if (frame.protocolVersion !== PROTOCOL_VERSION) {
      const err = new StreamError("PROTOCOL_MISMATCH", undefined);
      this.#rejectCapability(err);
      this.#onErrorCb?.(err);
      return;
    }
    this.#remoteCap = {
      sab: frame.sab && this.#localCap.sab,
      transferableStreams: frame.transferableStreams && this.#localCap.transferableStreams,
    };
    this.#resolveCapability();
  }

  /**
   * Negotiated capabilities. Available after capabilityReady resolves.
   * Phase 3: both flags always false.
   */
  get capabilities(): { sab: boolean; transferableStreams: boolean } {
    return this.#remoteCap ?? { sab: false, transferableStreams: false };
  }

  /**
   * Resolves once the remote CAPABILITY frame is received.
   * Rejects with StreamError{code:'PROTOCOL_MISMATCH'} on version mismatch.
   */
  get capabilityReady(): Promise<void> {
    return this.#capabilityReady;
  }

  // ---------------------------------------------------------------------------
  // Stream management
  // ---------------------------------------------------------------------------

  /**
   * Initiator side: open a new outbound stream.
   * Waits for capability negotiation before allowing the session to open.
   * Returns a StreamHandle that adapters wrap (not part of public API).
   */
  openStream(sessionOpts?: Partial<SessionOptions>): StreamHandle {
    const streamId = this.#streamIdCounter++;
    const session = this.#createSession(streamId, "initiator", sessionOpts);
    this.#session = session;
    // Open the session — sends OPEN frame (responder will reply with OPEN_ACK)
    session.open();
    return { session, channel: this };
  }

  /**
   * Responder side: register callback for inbound stream opens.
   * The callback receives a StreamHandle wrapping the new Session.
   */
  onStream(cb: (stream: StreamHandle) => void): void {
    this.#onStreamCb = cb;
  }

  /**
   * Register callback for channel-level errors (PROTOCOL_MISMATCH, DataCloneError).
   */
  onError(cb: (err: StreamError) => void): void {
    this.#onErrorCb = cb;
  }

  // ---------------------------------------------------------------------------
  // Frame send (used by Session.onFrameOut and internal capability send)
  // ---------------------------------------------------------------------------

  /**
   * Called by the Session via onFrameOut to send an outgoing frame.
   * Tracks lastDataSeqOut for CLOSE finalSeq (RESEARCH.md Pitfall 6).
   * Wraps postMessage in try/catch for DataCloneError (PITFALLS P1).
   */
  sendFrame(frame: Frame, transfer?: ArrayBuffer[]): void {
    if (frame.type === "DATA") {
      this.#lastDataSeqOut = frame.seqNum;
    }
    this.#sendRaw(encode(frame), transfer ?? []);
  }

  get lastDataSeqOut(): number {
    return this.#lastDataSeqOut;
  }

  /**
   * Gracefully close the channel: close the active session with correct finalSeq.
   */
  close(): void {
    if (this.#session !== null) {
      const finalSeq = this.#lastDataSeqOut >= 0 ? this.#lastDataSeqOut : 0;
      this.#session.close(finalSeq);
      this.#session = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  #sendRaw(encoded: Record<string, unknown>, transfer: ArrayBuffer[]): void {
    try {
      this.#endpoint.postMessage(encoded, transfer as Transferable[]);
    } catch (err) {
      if (
        (err instanceof DOMException && err.name === "DataCloneError") ||
        // Node: DataCloneError is not a DOMException — check message
        (err instanceof Error && err.message.includes("could not be cloned"))
      ) {
        const streamErr = new StreamError("DataCloneError", err);
        this.#session?.reset("DataCloneError");
        this.#onErrorCb?.(streamErr);
      } else {
        throw err; // unexpected error — rethrow
      }
    }
  }

  #createSession(
    streamId: number,
    role: "initiator" | "responder",
    extra?: Partial<SessionOptions>,
  ): Session {
    const session = new Session({
      channelId: this.#channelId,
      streamId,
      role,
      ...this.#sessionOptions,
      ...extra,
    });

    // Wire outbound frames from Session → Channel → endpoint
    session.onFrameOut((frame, transfer) => {
      this.sendFrame(frame, transfer);
    });

    return session;
  }
}

/**
 * Factory function — the single public entry point for creating a Channel.
 * per D-locked decision in CONTEXT.md: createChannel(endpoint, options) returns Channel.
 */
export function createChannel(endpoint: PostMessageEndpoint, options?: ChannelOptions): Channel {
  return new Channel(endpoint, options);
}
