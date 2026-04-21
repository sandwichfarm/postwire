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
import { isSabCapable } from "../transport/sab-capability.js";
import { allocSabRing, SabRingConsumer, SabRingProducer } from "../transport/sab-ring.js";
import type { ChannelStats, StreamStats, TraceEvent } from "./stats.js";

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
  type DataFrame,
  FRAME_MARKER,
  type Frame,
  PROTOCOL_VERSION,
} from "../framing/types.js";
import { Session, type SessionOptions } from "../session/index.js";
import type { PostMessageEndpoint } from "../transport/endpoint.js";
import { type ErrorCode, StreamError } from "../types.js";

// ---------------------------------------------------------------------------
// Module-level helper: map session error reason strings to typed ErrorCode
// ---------------------------------------------------------------------------

/**
 * Maps session-level error reason strings to OBS-02 typed ErrorCode values.
 * Called when session.onError fires to convert the raw string into a typed code
 * before emitting on the channel error emitter.
 */
function mapSessionErrorCode(reason: string): ErrorCode {
  switch (reason) {
    case "consumer-stall":
      return "CREDIT_DEADLOCK";
    case "REORDER_OVERFLOW":
      return "REORDER_OVERFLOW";
    case "DataCloneError":
      return "DataCloneError";
    case "CHANNEL_FROZEN":
      return "CHANNEL_FROZEN";
    case "CHANNEL_DEAD":
      return "CHANNEL_DEAD";
    case "CHANNEL_CLOSED":
      return "CHANNEL_CLOSED";
    default:
      // Covers CANCEL/RESET reasons and any future unknown strings.
      return "PROTOCOL_MISMATCH";
  }
}

// ---------------------------------------------------------------------------
// Channel-level event map + typed emitter
// ---------------------------------------------------------------------------

type ChannelEventMap = {
  error: [err: StreamError];
  close: [];
  trace: [event: TraceEvent];
};

/**
 * Minimal typed emitter for channel-level events (error, close, trace).
 * Inlined here because the stream-level TypedEmitter in emitter.ts has a
 * different event map and is not reusable for channel-level events.
 */
class ChannelEmitter {
  readonly #handlers = new Map<keyof ChannelEventMap, Set<(...args: unknown[]) => void>>();

  on<K extends keyof ChannelEventMap>(
    event: K,
    handler: (...args: ChannelEventMap[K]) => void,
  ): void {
    if (!this.#handlers.has(event)) this.#handlers.set(event, new Set());
    this.#handlers.get(event)?.add(handler as (...args: unknown[]) => void);
  }

  off<K extends keyof ChannelEventMap>(
    event: K,
    handler: (...args: ChannelEventMap[K]) => void,
  ): void {
    this.#handlers.get(event)?.delete(handler as (...args: unknown[]) => void);
  }

  emit<K extends keyof ChannelEventMap>(event: K, ...args: ChannelEventMap[K]): void {
    this.#handlers.get(event)?.forEach((h) => {
      h(...args);
    });
  }

  removeAllListeners(): void {
    this.#handlers.clear();
  }
}

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
  /**
   * 'window' enables BFCache listeners (pagehide/pageshow) on globalThis.
   * Other values are reserved for documentation / future use in Phase 4.
   */
  endpointKind?: "window" | "worker" | "messageport" | "serviceworker";
  /**
   * Opt-in SW heartbeat (LIFE-02). When set, a CAPABILITY ping is sent every intervalMs;
   * if no pong arrives within timeoutMs, CHANNEL_DEAD is emitted.
   */
  heartbeat?: { intervalMs: number; timeoutMs: number };
  /**
   * Enable per-frame trace events on channel.on('trace', ...) (OBS-03).
   * Off by default — no overhead when disabled.
   */
  trace?: boolean;
  /**
   * Opt-in to the SAB (SharedArrayBuffer) fast path for DATA frames (Phase 6, FAST-04).
   * When true and both sides are SAB-capable, DATA frames bypass postMessage entirely.
   * Falls back transparently to postMessage if either side is not capable.
   * Default: false.
   */
  sab?: boolean;
  /**
   * Ring buffer capacity in bytes for the SAB fast path (Phase 6, FAST-04).
   * Default: 1_048_576 (1 MB). Must fit the largest individual data chunk.
   */
  sabBufferSize?: number;
  /**
   * Opt-in to multiplex mode (Phase 8, MUX-01).
   * When true on BOTH sides, the channel hosts multiple concurrent Sessions keyed by
   * unique stream IDs. A stalled stream's credit window cannot block other streams.
   * If only one side opts in, the channel falls back to single-stream mode (default false).
   * Default: false.
   */
  multiplex?: boolean;
  /**
   * Role for stream ID allocation in multiplex mode (Phase 8, MUX-01).
   * 'initiator' allocates odd IDs (1, 3, 5, ...); 'responder' allocates even IDs (2, 4, 6, ...).
   * Mirrors HTTP/2 stream ID rules — avoids collision without an extra per-stream handshake.
   * Default: 'initiator'.
   */
  role?: "initiator" | "responder";
}

/** Internal stream handle — NOT part of the public API. */
export interface StreamHandle {
  readonly session: Session;
  readonly channel: Channel;
}

export class Channel {
  readonly #endpoint: PostMessageEndpoint; // strong ref — prevents GC (LIFE-04)
  readonly #channelId: string;
  readonly #options: ChannelOptions;
  readonly #sessionOptions: Partial<Omit<SessionOptions, "channelId" | "streamId" | "role">>;

  // Capability negotiation — probe is evaluated once at channel construction.
  // checkReadableStreamTransferable() always returns false in Phase 3 (FAST-02).
  // SAB local capability: true only when caller opts in AND isSabCapable() probe passes.
  #localCap: { sab: boolean; transferableStreams: boolean; multiplex: boolean };
  #remoteCap: { sab: boolean; transferableStreams: boolean; multiplex: boolean } | null = null;
  readonly #capabilityReady: Promise<void>;
  #resolveCapability!: () => void;
  #rejectCapability!: (err: StreamError) => void;

  // Phase 6: SAB fast path state (FAST-04)
  #sabProducer: SabRingProducer | null = null;
  #sabConsumer: SabRingConsumer | null = null;
  #sabReady = false; // true once SAB_INIT handshake is complete on both sides
  #sabInitAckPending = false; // true on the initiator side while waiting for SAB_INIT_ACK
  #remoteChannelId: string | null = null; // stored when CAPABILITY arrives, used for SAB tiebreaker

  // Stream registry — Map<streamId, Session> supports both single-stream and multiplex modes.
  // In single-stream mode (#multiplexActive=false) at most one entry exists (streamId=0 for
  // responder-opened streams or streamId=1 for initiator-opened streams, whichever openStream
  // allocates first — the historical default was streamIdCounter starting at 1).
  // In multiplex mode (#multiplexActive=true) multiple concurrent sessions coexist.
  readonly #sessions: Map<number, Session> = new Map();

  // Multiplex mode: activated only when BOTH sides advertise multiplex:true in CAPABILITY.
  // Starts false; set to true in #handleCapability when merged capability resolves.
  #multiplexActive = false;

  // Stream ID allocator for openStream() (Phase 8, MUX-01).
  // Initiator allocates odd IDs (1, 3, 5, ...); responder allocates even IDs (2, 4, 6, ...).
  // In single-stream mode this starts at 1 and is only used once (historical behaviour).
  // Initialized in constructor from options.role; defaults to 'initiator' (odd, starting at 1).
  #nextStreamId: number;

  // Per-stream last DATA seqNum map — used by close() to pass the correct finalSeq.
  // Key: streamId. In single-stream mode only one key is ever present.
  readonly #lastDataSeqByStream: Map<number, number> = new Map();

  // inbound stream callback (onStream)
  #onStreamCb: ((stream: StreamHandle) => void) | null = null;

  // error callback (channel-level errors: PROTOCOL_MISMATCH, DataCloneError)
  // Kept for backward compat; new callers should use channel.on('error', cb).
  #onErrorCb: ((err: StreamError) => void) | null = null;

  // Phase 7: raw-frame hooks for relay bridge (TOPO-02, TOPO-03, TOPO-04)
  readonly #rawDataHandlers: Set<(frame: DataFrame) => void> = new Set();
  readonly #rawControlHandlers: Set<(frame: Frame) => void> = new Set();

  // Phase 4: typed emitter, disposers array, closed guard (LIFE-05, OBS-02)
  readonly #emitter = new ChannelEmitter();
  readonly #disposers: (() => void)[] = [];
  #isClosed = false; // idempotency guard for #freezeAllStreams

  // Phase 4: aggregate byte counters (OBS-01) — wired in Plan 01
  #bytesSent = 0;
  #bytesReceived = 0;
  readonly #frameCountsSent: Map<string, number> = new Map();
  readonly #frameCountsRecv: Map<string, number> = new Map();

  // Phase 4: SW heartbeat timers (LIFE-02)
  // #heartbeatInterval drives the periodic CAPABILITY ping.
  // #heartbeatTimeout arms after each ping; cleared by the pong.
  // The null-check on #heartbeatTimeout is the ping-pong loop prevention:
  //   non-null  → we sent a ping, this CAPABILITY is the pong → clear timeout
  //   null      → remote sent a ping → echo once (do NOT arm a new timeout)
  #heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  #heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(endpoint: PostMessageEndpoint, options: ChannelOptions = {}) {
    this.#endpoint = endpoint;
    this.#channelId = options.channelId ?? crypto.randomUUID();
    this.#options = options;
    this.#sessionOptions = options.sessionOptions ?? {};

    // Phase 6: Compute local SAB capability.
    // Caller must opt in via options.sab=true AND the environment must pass the probe.
    this.#localCap = {
      sab: options.sab === true && isSabCapable(endpoint),
      transferableStreams: checkReadableStreamTransferable(),
      multiplex: options.multiplex === true,
    };

    // Phase 8: Initialize stream ID allocator based on role.
    // Initiator allocates odd IDs starting at 1; responder allocates even IDs starting at 2.
    // This mirrors HTTP/2 stream ID rules and avoids collision in multiplex mode.
    this.#nextStreamId = (options.role ?? "initiator") === "initiator" ? 1 : 2;

    // Capability ready promise — resolves on remote CAPABILITY, rejects on PROTOCOL_MISMATCH
    this.#capabilityReady = new Promise<void>((resolve, reject) => {
      this.#resolveCapability = resolve;
      this.#rejectCapability = reject;
    });
    // Prevent unhandled rejection if nobody attaches a .catch
    this.#capabilityReady.catch(() => {
      /* swallowed — caller gets error via onError */
    });

    // BFCache detection — only for Window endpoints (LIFE-01).
    // pagehide does not fire in Worker scope, so the endpointKind guard is sufficient.
    // CRITICAL: Do NOT use the 'unload' event — it disqualifies pages from BFCache.
    // Event type-cast avoids a DOM-only type dependency: PageTransitionEvent is
    // not available in Node. The persisted property is read from the event object
    // at runtime; it defaults to false if absent (i.e. in non-BFCache browsers).
    if (options.endpointKind === "window") {
      const onPagehide = (e: Event): void => {
        const persisted = (e as Event & { persisted?: boolean }).persisted ?? false;
        this.#freezeAllStreams(persisted ? "CHANNEL_FROZEN" : "CHANNEL_CLOSED");
      };
      const onPageshow = (_e: Event): void => {
        // Intentional no-op: channel stays dead after BFCache restore.
        // Caller must create a new channel if they need to reconnect.
        // #isClosed guard in #freezeAllStreams prevents any double-error.
      };
      (globalThis as unknown as EventTarget).addEventListener("pagehide", onPagehide);
      (globalThis as unknown as EventTarget).addEventListener("pageshow", onPageshow);
      this.#disposers.push(
        () => (globalThis as unknown as EventTarget).removeEventListener("pagehide", onPagehide),
        () => (globalThis as unknown as EventTarget).removeEventListener("pageshow", onPageshow),
      );
    }

    // Wire inbound message handler BEFORE sending CAPABILITY (avoid race)
    endpoint.onmessage = (evt: MessageEvent): void => {
      // Phase 6: intercept SAB control messages before normal frame decoding.
      // These are not wire-protocol frames — they are out-of-band SAB handshake messages.
      if (evt.data !== null && typeof evt.data === "object") {
        if ((evt.data as { __pw_sab_init__?: boolean }).__pw_sab_init__ === true) {
          this.#handleSabInit(evt.data as { sab: SharedArrayBuffer; bufferSize: number });
          return;
        }
        if ((evt.data as { __pw_sab_init_ack__?: boolean }).__pw_sab_init_ack__ === true) {
          this.#handleSabInitAck();
          return;
        }
      }

      const frame = decode(evt.data);
      if (frame === null) return; // not a library frame — pass through silently

      // Track inbound frame counts (OBS-01)
      this.#frameCountsRecv.set(frame.type, (this.#frameCountsRecv.get(frame.type) ?? 0) + 1);
      if (frame.type === "DATA") {
        const df = frame as DataFrame;
        if (df.chunkType === "BINARY_TRANSFER" && df.payload instanceof ArrayBuffer) {
          this.#bytesReceived += df.payload.byteLength;
        }
      }

      // Emit trace event for inbound frame (OBS-03)
      if (this.#options.trace) {
        this.#emitter.emit("trace", {
          timestamp: performance.now(),
          direction: "in",
          frameType: frame.type,
          streamId: frame.streamId,
          seq: frame.seqNum,
          byteLength:
            frame.type === "DATA" &&
            (frame as DataFrame).chunkType === "BINARY_TRANSFER" &&
            (frame as DataFrame).payload instanceof ArrayBuffer
              ? ((frame as DataFrame).payload as ArrayBuffer).byteLength
              : undefined,
        });
      }

      if (frame.type === "CAPABILITY") {
        this.#handleCapability(frame as CapabilityFrame);
        return;
      }

      // Phase 7: fan-out to raw-frame handlers (relay bridge).
      // Fires IN ADDITION to session delivery, not INSTEAD OF.
      // DATA handlers receive typed DataFrame; control handlers receive all non-DATA frames.
      if (frame.type === "DATA") {
        if (this.#rawDataHandlers.size > 0) {
          const df = frame as DataFrame;
          for (const handler of this.#rawDataHandlers) {
            handler(df);
          }
        }
      } else {
        if (this.#rawControlHandlers.size > 0) {
          for (const handler of this.#rawControlHandlers) {
            handler(frame);
          }
        }
      }

      // Responder path: OPEN frame creates a new session on demand.
      // Single-stream mode: only one session allowed; if one exists, route to it (shouldn't happen
      // since OPEN is sent once, but be defensive).
      // Multiplex mode: each distinct streamId in the incoming OPEN gets its own Session.
      if (frame.type === "OPEN") {
        const existingOnOpen = this.#sessions.get(frame.streamId);
        if (existingOnOpen === undefined) {
          // Guard: in single-stream mode, reject a second OPEN while a session is active.
          if (!this.#multiplexActive && this.#sessions.size > 0) {
            // Silently drop — peer sent a second OPEN on a non-multiplex channel. Protocol error
            // would be the strict response but graceful degradation is safer here.
            return;
          }
          const session = this.#createSession(frame.streamId, "responder");
          this.#sessions.set(frame.streamId, session);
          session.receiveFrame(frame);
          if (this.#onStreamCb !== null) {
            this.#onStreamCb({ session, channel: this });
          }
        } else {
          existingOnOpen.receiveFrame(frame);
        }
        return;
      }

      // All other frames are routed to the session matching the frame's streamId.
      this.#sessions.get(frame.streamId)?.receiveFrame(frame);
    };

    // LIFE-05: push a disposer to null out onmessage on close.
    // This removes the library's inbound listener from the endpoint.
    this.#disposers.push(() => {
      endpoint.onmessage = null;
    });

    // Endpoint teardown detection (LIFE-03).
    // Node 22: MessagePort fires 'close' when the partner port closes — detected here.
    // Browser: the 'close' event on MessagePort is a Blink-only proposal (not cross-browser).
    //   In browsers, teardown detection for MessagePort falls back to heartbeat (LIFE-02).
    //   For Window endpoints, pagehide(persisted=false) covers iframe unload (LIFE-01).
    // Adding the listener is always safe — it is a no-op if 'close' never fires.
    if (typeof (endpoint as unknown as EventTarget).addEventListener === "function") {
      const onEndpointClose = (): void => {
        this.#freezeAllStreams("CHANNEL_CLOSED");
      };
      (endpoint as unknown as EventTarget).addEventListener("close", onEndpointClose);
      this.#disposers.push(() =>
        (endpoint as unknown as EventTarget).removeEventListener("close", onEndpointClose),
      );
    }

    // Send our CAPABILITY frame immediately
    this.#sendCapability();

    // Start heartbeat if configured (opt-in for SW endpoints — LIFE-02).
    // Must be called AFTER #sendCapability() so the initial CAPABILITY ping
    // (if fired on the very first interval) follows the handshake CAPABILITY.
    if (options.heartbeat) {
      this.#startHeartbeat();
    }
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
      multiplex: this.#localCap.multiplex,
    };
    // Track outbound CAPABILITY frame counts and trace (OBS-01, OBS-03)
    this.#frameCountsSent.set("CAPABILITY", (this.#frameCountsSent.get("CAPABILITY") ?? 0) + 1);
    if (this.#options.trace) {
      this.#emitter.emit("trace", {
        timestamp: performance.now(),
        direction: "out",
        frameType: "CAPABILITY",
        streamId: 0,
        seq: 0,
        byteLength: undefined,
      });
    }
    this.#sendRaw(encode(cap), []);
  }

  #handleCapability(frame: CapabilityFrame): void {
    if (frame.protocolVersion !== PROTOCOL_VERSION) {
      const err = new StreamError("PROTOCOL_MISMATCH", undefined);
      this.#rejectCapability(err);
      this.#emitter.emit("error", err); // OBS-02: route through typed emitter
      this.#onErrorCb?.(err); // backward compat
      return;
    }
    const isPostHandshake = this.#remoteCap !== null;
    // Store remote channel ID for SAB tiebreaker determination (Phase 6)
    if (!isPostHandshake) {
      this.#remoteChannelId = frame.channelId;
    }
    this.#remoteCap = {
      sab: frame.sab && this.#localCap.sab,
      transferableStreams: frame.transferableStreams && this.#localCap.transferableStreams,
      // Phase 8: multiplex is only active when BOTH sides opt in (logical AND).
      // frame.multiplex may be absent (undefined) on older/non-multiplex channels — treat as false.
      multiplex: frame.multiplex === true && this.#localCap.multiplex,
    };
    if (!isPostHandshake) {
      // Initial handshake — resolve the capabilityReady promise.
      // Phase 8: activate multiplex mode if both sides agreed.
      this.#multiplexActive = this.#remoteCap.multiplex;
      this.#resolveCapability();
      // Phase 6: if both sides negotiated SAB, initiate the SAB ring handshake.
      // The "initiator" role is determined by alphabetical channel ID order —
      // the side with the lexicographically smaller channel ID sends SAB_INIT.
      // When IDs are equal (unusual but possible), random tiebreaker is used.
      if (this.#remoteCap.sab) {
        this.#initiateSabHandshake();
      }
    } else {
      // Post-handshake CAPABILITY: heartbeat ping/pong discrimination (LIFE-02).
      // RESEARCH.md Pitfall 3: prevent infinite ping-pong loop.
      // #heartbeatTimeout non-null  → WE sent the ping and are waiting; this is the pong.
      //                               Clear the timeout. Do NOT echo back (that would restart the loop).
      // #heartbeatTimeout null      → REMOTE sent the ping (or unsolicited CAPABILITY).
      //                               Echo once as a pong. Do NOT arm a timeout on our side.
      if (this.#heartbeatTimeout !== null) {
        clearTimeout(this.#heartbeatTimeout);
        this.#heartbeatTimeout = null;
      } else {
        // Remote-initiated ping — echo once as pong.
        this.#sendCapability();
      }
    }
  }

  /**
   * Negotiated capabilities. Available after capabilityReady resolves.
   * Phase 3: sab and transferableStreams always false.
   * Phase 8: multiplex is true only when both sides opted in.
   */
  get capabilities(): { sab: boolean; transferableStreams: boolean; multiplex: boolean } {
    return this.#remoteCap ?? { sab: false, transferableStreams: false, multiplex: false };
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
   *
   * Single-stream mode: only one stream is allowed. Throws if called a second time
   * while a session is still active (mirrors historical behaviour).
   * Multiplex mode: allocates unique stream IDs (odd for initiator, even for responder).
   */
  openStream(sessionOpts?: Partial<SessionOptions>): StreamHandle {
    if (!this.#multiplexActive && this.#sessions.size > 0) {
      throw new Error(
        "postwire: openStream() called twice in single-stream mode. " +
          "Enable multiplex:true on both sides to support concurrent streams.",
      );
    }
    // Allocate stream ID. In single-stream mode this is always #nextStreamId (starts at 1).
    // In multiplex mode increment by 2 to stay within the odd/even partition.
    const streamId = this.#nextStreamId;
    this.#nextStreamId += this.#multiplexActive ? 2 : 1;

    const session = this.#createSession(streamId, "initiator", sessionOpts);
    this.#sessions.set(streamId, session);
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
   * @deprecated Prefer channel.on('error', cb) — this shim is kept for backward compat.
   */
  onError(cb: (err: StreamError) => void): void {
    this.#onErrorCb = cb;
  }

  /**
   * Subscribe to a channel-level event (OBS-02, LIFE-03, OBS-03).
   * 'error' — StreamError with typed .code; 'close' — channel died; 'trace' — per-frame debug.
   */
  on<K extends keyof ChannelEventMap>(
    event: K,
    handler: (...args: ChannelEventMap[K]) => void,
  ): this {
    this.#emitter.on(event, handler);
    return this;
  }

  /**
   * Unsubscribe from a channel-level event.
   */
  off<K extends keyof ChannelEventMap>(
    event: K,
    handler: (...args: ChannelEventMap[K]) => void,
  ): this {
    this.#emitter.off(event, handler);
    return this;
  }

  // ---------------------------------------------------------------------------
  // Phase 7: raw-frame hooks for relay bridge (TOPO-02, TOPO-03, TOPO-04)
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to raw DATA frames as they arrive from the peer endpoint, BEFORE
   * session-layer reassembly. Used by relay bridges to forward frames without
   * reassembly. Fires once per inbound DATA frame, in addition to session delivery.
   * Returns a disposer that removes the handler.
   */
  onRawDataFrame(cb: (frame: DataFrame) => void): () => void {
    this.#rawDataHandlers.add(cb);
    return () => {
      this.#rawDataHandlers.delete(cb);
    };
  }

  /**
   * Subscribe to raw control frames (OPEN, OPEN_ACK, CREDIT, CANCEL, RESET, CLOSE)
   * as they arrive from the peer endpoint. Used by relay bridges for credit
   * forwarding and cancel/reset propagation. Fires in addition to session delivery.
   * Returns a disposer that removes the handler.
   */
  onRawControlFrame(cb: (frame: Frame) => void): () => void {
    this.#rawControlHandlers.add(cb);
    return () => {
      this.#rawControlHandlers.delete(cb);
    };
  }

  /**
   * Send a raw frame directly to the peer endpoint, bypassing the session layer.
   * Used by relay bridges to forward frames without going through the local session FSM.
   * Increments OBS-01 frame counters so channel.stats() remains accurate.
   */
  sendRawFrame(frame: Frame, transfer?: Transferable[]): void {
    // Track outbound frame counts (OBS-01) — same as sendFrame() does
    this.#frameCountsSent.set(frame.type, (this.#frameCountsSent.get(frame.type) ?? 0) + 1);
    if (frame.type === "DATA") {
      const df = frame as DataFrame;
      if (df.chunkType === "BINARY_TRANSFER" && df.payload instanceof ArrayBuffer) {
        this.#bytesSent += df.payload.byteLength;
      }
    }
    // Emit trace event when tracing is enabled (OBS-03)
    if (this.#options.trace) {
      this.#emitter.emit("trace", {
        timestamp: performance.now(),
        direction: "out",
        frameType: frame.type,
        streamId: frame.streamId,
        seq: frame.seqNum,
        byteLength:
          frame.type === "DATA" &&
          (frame as DataFrame).chunkType === "BINARY_TRANSFER" &&
          (frame as DataFrame).payload instanceof ArrayBuffer
            ? ((frame as DataFrame).payload as ArrayBuffer).byteLength
            : undefined,
      });
    }
    this.#sendRaw(encode(frame), (transfer ?? []) as ArrayBuffer[]);
  }

  /**
   * Returns a polling snapshot of channel and per-stream metrics (OBS-01).
   * Not reactive — call as needed. Safe to call before any stream is opened.
   *
   * Byte counts:
   *   - BINARY_TRANSFER frames: exact (ArrayBuffer.byteLength at intercept point)
   *   - STRUCTURED_CLONE frames: 0 (payload cannot be measured without serializing)
   *
   * frameCountsByType: combined send + receive counts per frame type for the active stream.
   */
  stats(): ChannelStats {
    const streams: StreamStats[] = [];

    // Combine sent + received frame counts (channel-level, shared across all streams).
    const combined = new Map<string, number>();
    for (const [k, v] of this.#frameCountsSent) {
      combined.set(k, (combined.get(k) ?? 0) + v);
    }
    for (const [k, v] of this.#frameCountsRecv) {
      combined.set(k, (combined.get(k) ?? 0) + v);
    }
    const frameCountsByType = Object.fromEntries(combined) as StreamStats["frameCountsByType"];

    for (const session of this.#sessions.values()) {
      streams.push({
        streamId: session.streamId,
        bytesSent: this.#bytesSent,
        bytesReceived: this.#bytesReceived,
        frameCountsByType,
        creditWindowAvailable: session.creditWindowAvailable,
        reorderBufferDepth: session.reorderBufferDepth,
        chunkerChunksSent: session.chunkerChunksSent,
        chunkerChunksReceived: session.chunkerChunksReceived,
      });
    }

    return {
      streams,
      aggregate: {
        bytesSent: this.#bytesSent,
        bytesReceived: this.#bytesReceived,
      },
      sabActive: this.#sabReady,
    };
  }

  // ---------------------------------------------------------------------------
  // Frame send (used by Session.onFrameOut and internal capability send)
  // ---------------------------------------------------------------------------

  /**
   * Called by the Session via onFrameOut to send an outgoing frame.
   * Tracks lastDataSeqOut for CLOSE finalSeq (RESEARCH.md Pitfall 6).
   * Increments OBS-01 byte/frame counters; emits OBS-03 trace event when enabled.
   * Wraps postMessage in try/catch for DataCloneError (PITFALLS P1).
   */
  sendFrame(frame: Frame, transfer?: ArrayBuffer[]): void {
    if (frame.type === "DATA") {
      // Track last DATA seqNum per stream for close(finalSeq) wiring (RESEARCH.md Pitfall 6).
      this.#lastDataSeqByStream.set(frame.streamId, frame.seqNum);
      // Track bytes for BINARY_TRANSFER path (exact); STRUCTURED_CLONE is not counted
      // because payload byteLength is unavailable at this layer without serializing.
      const df = frame as DataFrame;
      if (df.chunkType === "BINARY_TRANSFER" && df.payload instanceof ArrayBuffer) {
        this.#bytesSent += df.payload.byteLength;
      }
    }
    // Track outbound frame counts (OBS-01)
    this.#frameCountsSent.set(frame.type, (this.#frameCountsSent.get(frame.type) ?? 0) + 1);

    // Emit trace event for outbound frame (OBS-03)
    if (this.#options.trace) {
      this.#emitter.emit("trace", {
        timestamp: performance.now(),
        direction: "out",
        frameType: frame.type,
        streamId: frame.streamId,
        seq: frame.seqNum,
        byteLength:
          frame.type === "DATA" &&
          (frame as DataFrame).chunkType === "BINARY_TRANSFER" &&
          (frame as DataFrame).payload instanceof ArrayBuffer
            ? ((frame as DataFrame).payload as ArrayBuffer).byteLength
            : undefined,
      });
    }

    // Phase 6: route DATA frames via SAB ring when the fast path is active.
    // Control frames (OPEN, OPEN_ACK, CREDIT, CLOSE, etc.) always go via postMessage.
    if (frame.type === "DATA" && this.#sabReady && this.#sabProducer !== null) {
      const df = frame as DataFrame;
      // Only binary payloads can transit via the ring (payload must be an ArrayBuffer)
      if (df.payload instanceof ArrayBuffer) {
        const payload = new Uint8Array(df.payload);
        const chunkTypeNum = [
          "BINARY_TRANSFER",
          "STRUCTURED_CLONE",
          "STREAM_REF",
          "SAB_SIGNAL",
        ].indexOf(df.chunkType);
        const ctNum = chunkTypeNum >= 0 ? chunkTypeNum : 0;
        // Encode isFinal as bit 31 of the chunkType field.
        // Consumer decodes: (ctEncoded & 0x7FFFFFFF) = chunkType, (ctEncoded >>> 31) = isFinal
        const ctEncoded = df.isFinal ? ctNum | 0x8000_0000 : ctNum;
        // Fire-and-forget write — errors fall back to postMessage silently
        void this.#sabProducer.write(payload, frame.seqNum, ctEncoded >>> 0).then((ok) => {
          if (!ok && !this.#isClosed) {
            // SAB write timed out — ring consumer is dead
            this.#freezeAllStreams("CHANNEL_DEAD");
          }
        });
        return; // DATA frame sent via SAB — do NOT also send via postMessage
      }
    }

    this.#sendRaw(encode(frame), transfer ?? []);
  }

  /**
   * The seqNum of the last DATA frame emitted on the most-recently-used stream.
   * Used by adapters that track finalSeq for session.close().
   * In multiplex mode, use channel.stats().streams to get per-stream values.
   * @deprecated Prefer per-stream tracking via channel.stats().streams[].
   */
  get lastDataSeqOut(): number {
    if (this.#lastDataSeqByStream.size === 0) return -1;
    // Return the last inserted value (Map preserves insertion order).
    let last = -1;
    for (const v of this.#lastDataSeqByStream.values()) {
      last = v;
    }
    return last;
  }

  /**
   * True if there is at least one active session in the channel.
   * Used by lifecycle integration tests (LIFE-03) to assert no zombie sessions remain.
   */
  get hasActiveSession(): boolean {
    return this.#sessions.size > 0;
  }

  /**
   * Gracefully close the channel: close all active sessions with correct finalSeq values.
   * Sessions in states that accept CLOSE_SENT (OPEN, LOCAL_HALF_CLOSED, REMOTE_HALF_CLOSED,
   * CLOSING) are closed gracefully. Sessions in IDLE/OPENING (pre-handshake) or terminal
   * states are reset or skipped — they cannot accept CLOSE_SENT.
   * Idempotent — calling close() on an already-closed channel is a no-op.
   */
  close(): void {
    if (this.#isClosed) return;
    for (const [streamId, session] of this.#sessions) {
      const s = session.state;
      // CLOSE_SENT is only valid from OPEN, LOCAL_HALF_CLOSED (already locally closed — no-op),
      // and REMOTE_HALF_CLOSED. IDLE/OPENING have not completed handshake; terminal states throw.
      // For IDLE/OPENING sessions we reset them instead (abort pre-handshake).
      if (s === "OPEN" || s === "REMOTE_HALF_CLOSED") {
        const lastSeq = this.#lastDataSeqByStream.get(streamId) ?? -1;
        const finalSeq = lastSeq >= 0 ? lastSeq : 0;
        session.close(finalSeq);
      } else if (s === "IDLE" || s === "OPENING") {
        // Pre-handshake — abort gracefully without sending CLOSE (peer hasn't ACKed yet).
        // No outbound frame needed; just let the session be GC'd.
      }
      // LOCAL_HALF_CLOSED / CLOSING / terminal states: already closing or done — skip.
    }
    this.#sessions.clear();
    this.#runDisposers();
    this.#emitter.removeAllListeners();
    this.#isClosed = true;
  }

  // ---------------------------------------------------------------------------
  // Private: channel death / freeze (Phase 4)
  // ---------------------------------------------------------------------------

  /**
   * Called on channel death or freeze. Resets the active session, emits error+close,
   * flushes disposers (removing all event listeners), and marks the channel as closed.
   * Idempotent: guarded by #isClosed so calling twice is safe.
   *
   * Per RESEARCH.md Pattern 6. Phase 4 Wave 1 wires BFCache/teardown/heartbeat here.
   */
  #freezeAllStreams(code: "CHANNEL_FROZEN" | "CHANNEL_DEAD" | "CHANNEL_CLOSED"): void {
    if (this.#isClosed) return;
    this.#isClosed = true;
    for (const session of this.#sessions.values()) {
      const s = session.state;
      // RESET_SENT is only valid from OPEN, LOCAL_HALF_CLOSED, REMOTE_HALF_CLOSED, CLOSING.
      // IDLE and OPENING have not completed the handshake and do not accept RESET_SENT.
      // Terminal states (CLOSED, ERRORED, CANCELLED) throw on any event.
      // Guard: only call reset() when the session is in a state that accepts it.
      if (
        s === "OPEN" ||
        s === "LOCAL_HALF_CLOSED" ||
        s === "REMOTE_HALF_CLOSED" ||
        s === "CLOSING"
      ) {
        session.reset(code);
      }
    }
    this.#sessions.clear();
    this.#emitter.emit("error", new StreamError(code, undefined));
    this.#emitter.emit("close");
    this.#runDisposers();
    this.#emitter.removeAllListeners();
  }

  /** Flush the disposers array in reverse order (LIFE-05). */
  #runDisposers(): void {
    for (let i = this.#disposers.length - 1; i >= 0; i--) {
      this.#disposers[i]?.();
    }
    this.#disposers.length = 0;
  }

  /**
   * Start the SW heartbeat (LIFE-02). Called once from the constructor when
   * options.heartbeat is present. Sends a CAPABILITY ping every intervalMs;
   * if no pong arrives within timeoutMs, emits CHANNEL_DEAD.
   *
   * Cleanup is registered in #disposers — both the interval and any pending
   * timeout are cleared when channel.close() runs (Pitfall 6 prevention).
   */
  #startHeartbeat(): void {
    const heartbeat = this.#options.heartbeat;
    if (!heartbeat) throw new Error("heartbeat options unexpectedly absent");
    const { intervalMs, timeoutMs } = heartbeat;
    this.#heartbeatInterval = setInterval(() => {
      if (this.#isClosed) return;
      this.#sendCapability(); // ping
      // Arm timeout: if no pong arrives within timeoutMs, declare CHANNEL_DEAD.
      // The pong path (in #handleCapability) clears this via the null check.
      this.#heartbeatTimeout = setTimeout(() => {
        this.#heartbeatTimeout = null;
        this.#freezeAllStreams("CHANNEL_DEAD");
      }, timeoutMs);
    }, intervalMs);
    // Register cleanup in disposers (LIFE-05 + Pitfall 6)
    this.#disposers.push(() => {
      if (this.#heartbeatInterval !== null) {
        clearInterval(this.#heartbeatInterval);
        this.#heartbeatInterval = null;
      }
      if (this.#heartbeatTimeout !== null) {
        clearTimeout(this.#heartbeatTimeout);
        this.#heartbeatTimeout = null;
      }
    });
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
        // Guard: only call reset() from states that accept RESET_SENT (same as #freezeAllStreams).
        // OPENING and IDLE do not accept RESET_SENT in the FSM transition table.
        // DataCloneError resets ALL active sessions since the channel-level postMessage failed.
        for (const session of this.#sessions.values()) {
          const s = session.state;
          if (
            s === "OPEN" ||
            s === "LOCAL_HALF_CLOSED" ||
            s === "REMOTE_HALF_CLOSED" ||
            s === "CLOSING"
          ) {
            session.reset("DataCloneError");
          }
        }
        this.#emitter.emit("error", streamErr); // OBS-02: route through typed emitter
        this.#onErrorCb?.(streamErr); // backward compat
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

    // OBS-02: route session-level errors through the channel typed emitter.
    // Maps reason strings (e.g. 'consumer-stall', 'REORDER_OVERFLOW') to ErrorCode.
    // Both #emitter and #onErrorCb are called for full backward compat.
    session.onError((reason: string) => {
      const code = mapSessionErrorCode(reason);
      const err = new StreamError(code, new Error(reason), streamId);
      this.#emitter.emit("error", err);
      this.#onErrorCb?.(err);
    });

    return session;
  }

  // ---------------------------------------------------------------------------
  // Phase 6: SAB fast path (FAST-04)
  // ---------------------------------------------------------------------------

  /**
   * Called after CAPABILITY handshake if merged sab=true.
   * Determines which side allocates the SAB ring and sends SAB_INIT.
   * The side whose channel ID is alphabetically smaller acts as initiator
   * so both sides reach the same decision independently.
   */
  #initiateSabHandshake(): void {
    // Both sides independently decide who is the SAB ring allocator.
    // Rule: the side whose local channelId is lexicographically LESS THAN the remote
    // channelId sends SAB_INIT and acts as the producer.
    // When IDs are equal (edge case), the per-instance random tiebreaker is used.
    const remoteId = this.#remoteChannelId ?? "";
    const localId = this.#channelId;
    const iAmInitiator = localId < remoteId || (localId === remoteId && this.#sabTiebreaker);
    if (iAmInitiator) {
      this.#sendSabInit();
    }
    // The other side (remote side) will receive SAB_INIT via #handleSabInit.
  }

  /**
   * Per-instance random bit set at construction to break SAB_INIT initiator ties.
   * Used only when both channel IDs are identical (edge case).
   */
  readonly #sabTiebreaker: boolean = Math.random() < 0.5;

  /**
   * Allocate the SAB ring, wire up the producer, and send SAB_INIT to the peer.
   * Called by the initiator side after merged sab=true.
   */
  #sendSabInit(): void {
    try {
      const bufferSize = this.#options.sabBufferSize ?? 1_048_576;
      const view = allocSabRing(bufferSize);
      this.#sabProducer = new SabRingProducer(view);
      this.#sabInitAckPending = true;

      // SAB cannot be transferred (it is shared by reference).
      // Pass an empty transfer list — SharedArrayBuffer sharing is by reference, not transfer.
      this.#endpoint.postMessage({ __pw_sab_init__: true, sab: view.sab, bufferSize }, []);
    } catch (err) {
      const sabErr = new StreamError("SAB_INIT_FAILED", err);
      this.#emitter.emit("error", sabErr);
      // Fall back to postMessage path — sabReady stays false, all data goes via postMessage
    }
  }

  /**
   * Handle incoming SAB_INIT from the initiator side.
   * Wire up the consumer side on the same SharedArrayBuffer.
   */
  #handleSabInit(msg: { sab: SharedArrayBuffer; bufferSize: number }): void {
    try {
      const view = { sab: msg.sab, capacity: msg.bufferSize };
      this.#sabConsumer = new SabRingConsumer(view);
      // The consumer side is now SAB-active (receiving via ring)
      this.#sabReady = true;
      // Register consumer cleanup in disposers
      this.#disposers.push(() => {
        if (this.#sabConsumer !== null) {
          this.#sabConsumer.close();
          this.#sabConsumer = null;
        }
        this.#sabReady = false;
      });
      // Start the consumer loop BEFORE sending ACK so we don't miss frames
      this.#startSabConsumerLoop();
      // Send ACK to let initiator flip to SAB mode
      this.#endpoint.postMessage({ __pw_sab_init_ack__: true }, []);
    } catch (err) {
      // SAB init failed on receiver side — send a NACK by not sending ACK.
      // The initiator will time out and fall back.
      const sabErr = new StreamError("SAB_INIT_FAILED", err);
      this.#emitter.emit("error", sabErr);
    }
  }

  /**
   * Handle SAB_INIT_ACK from the responder side.
   * Flip #sabReady so DATA frames start routing via SAB.
   */
  #handleSabInitAck(): void {
    if (!this.#sabInitAckPending || this.#sabProducer === null) return;
    this.#sabInitAckPending = false;
    this.#sabReady = true;
    // Register producer cleanup in disposers
    this.#disposers.push(() => {
      if (this.#sabProducer !== null) {
        this.#sabProducer.writeTerminator();
        this.#sabProducer = null;
      }
      this.#sabReady = false;
    });
  }

  /**
   * Consumer loop: reads DATA frames from the SAB ring and dispatches them
   * to the active session. Runs until the ring signals closed or channel closes.
   */
  #startSabConsumerLoop(): void {
    const consumer = this.#sabConsumer;
    if (consumer === null) return;

    // Run the async loop detached — it will exit when consumer.read() returns null
    // Consumer cleanup is registered by the caller (handleSabInit).
    void (async () => {
      for (;;) {
        const msg = await consumer.read(30_000);
        if (msg === null) {
          // Ring closed or timed out
          if (!this.#isClosed) {
            // Timeout on a supposedly-live channel: emit CHANNEL_DEAD
            this.#freezeAllStreams("CHANNEL_DEAD");
          }
          break;
        }
        // Reconstruct a minimal DataFrame and dispatch it to the session
        this.#dispatchSabFrame(msg);
      }
    })();
  }

  /**
   * Reconstruct a DataFrame-compatible object from a SAB ring message and
   * route it to the active session for reassembly + credit accounting.
   */
  #dispatchSabFrame(msg: { payload: Uint8Array; seq: number; chunkType: number }): void {
    // SAB ring is single-stream — route to the first (and in practice only) active session.
    // Phase 8 note: SAB + multiplex is a deferred combination (see CONTEXT.md deferred section).
    if (this.#sessions.size === 0) return;
    const session = this.#sessions.values().next().value;
    if (session === undefined) return;

    // Decode isFinal from bit 31 of the chunkType field (encoded by sendFrame).
    // (ctEncoded & 0x7FFFFFFF) = actual chunkType; (ctEncoded >>> 31) = isFinal
    const isFinal = msg.chunkType >>> 31 === 1;
    const ctRaw = msg.chunkType & 0x7fff_ffff;

    // Map chunkType number to ChunkType string
    const CHUNK_TYPES = [
      "BINARY_TRANSFER",
      "STRUCTURED_CLONE",
      "STREAM_REF",
      "SAB_SIGNAL",
    ] as const;
    const chunkTypeStr = CHUNK_TYPES[ctRaw] ?? "BINARY_TRANSFER";

    // Build a synthetic DATA frame
    const frame = {
      [FRAME_MARKER]: 1 as const,
      channelId: this.#channelId,
      streamId: session.streamId,
      seqNum: msg.seq,
      type: "DATA" as const,
      chunkType: chunkTypeStr,
      payload: msg.payload.buffer.slice(
        msg.payload.byteOffset,
        msg.payload.byteOffset + msg.payload.byteLength,
      ) as ArrayBuffer,
      isFinal,
    };

    // Track bytes received (OBS-01)
    this.#bytesReceived += msg.payload.byteLength;

    // Route to session
    session.receiveFrame(frame);
  }
}

/**
 * Factory function — the single public entry point for creating a Channel.
 * per D-locked decision in CONTEXT.md: createChannel(endpoint, options) returns Channel.
 */
export function createChannel(endpoint: PostMessageEndpoint, options?: ChannelOptions): Channel {
  return new Channel(endpoint, options);
}
