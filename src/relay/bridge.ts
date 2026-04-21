// src/relay/bridge.ts
// RelayBridge: routes raw frames between two Channel instances without payload reassembly.
//
// Architecture:
//   Producer ↔ [MC_A] ↔ upstream Channel ↔ RelayBridge ↔ downstream Channel ↔ [MC_B] ↔ Consumer
//
// Design principles:
//   - Routing table: each upstream stream ID maps to a unique downstream stream ID.
//   - No reassembly: DATA frames pass through as-is, only streamId is translated.
//   - Credit forwarding: downstream CREDIT → upstream CREDIT (end-to-end backpressure).
//   - Cancel propagation: downstream CANCEL/RESET → upstream RESET (< 100 ms target).
//   - The upstream channel's session handles OPEN_ACK to producer; relay manages credit thereafter.

import type { Channel } from "../channel/channel.js";
import type {
  CancelFrame,
  CloseFrame,
  CreditFrame,
  DataFrame,
  Frame,
  OpenFrame,
} from "../framing/types.js";
import { FRAME_MARKER } from "../framing/types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RelayBridgeOptions {
  /** Initial credit offered in downstream OPEN frames. Default: 16. */
  initialCredit?: number;
}

export interface RelayStats {
  /** Total DATA frames forwarded from upstream to downstream. */
  framesForwardedIn: number;
  /** Total frames forwarded from downstream to upstream (credits, resets). */
  framesForwardedOut: number;
  /** Number of currently active (mapped) streams. */
  streamsActive: number;
  /** Number of stream ID mappings in the routing table. */
  mappings: number;
}

export interface RelayBridge {
  /** Polling snapshot of relay metrics. */
  stats(): RelayStats;
  /**
   * Dispose all raw-frame hooks. Does NOT close the underlying channels.
   * After close(), the relay no longer forwards frames.
   */
  close(): void;
  /**
   * Subscribe to relay-level events.
   * 'error' — relay-level error (e.g. both channels dead)
   * 'close' — bridge has been disposed
   */
  on(event: "error" | "close", handler: (payload?: unknown) => void): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a relay bridge that forwards frames between the two channels without
 * reassembly. Stream IDs are translated end-to-end via a routing table.
 *
 * @param upstream   - Channel connected to the producer side.
 * @param downstream - Channel connected to the consumer side.
 * @param options    - Optional tuning parameters.
 */
export function createRelayBridge(
  upstream: Channel,
  downstream: Channel,
  options: RelayBridgeOptions = {},
): RelayBridge {
  const initialCredit = options.initialCredit ?? 16;

  // Stream-ID translation table
  // upstreamToDown: producer's streamId → relay's downstream streamId
  // downToUpstream: relay's downstream streamId → producer's streamId
  const upstreamToDown = new Map<number, number>();
  const downToUpstream = new Map<number, number>();

  // Downstream stream ID counter — independent of upstream's IDs
  let nextDownId = 1;

  // Stats counters
  let framesForwardedIn = 0;
  let framesForwardedOut = 0;

  // Disposers for all raw-frame hooks
  const disposers: (() => void)[] = [];

  // Event handlers for relay-level events
  const errorHandlers: Set<(payload?: unknown) => void> = new Set();
  const closeHandlers: Set<(payload?: unknown) => void> = new Set();

  let closed = false;

  // ---------------------------------------------------------------------------
  // Helper: send a raw frame via a channel's endpoint
  // We use the channel's sendRawFrame method which tracks OBS-01 counters.
  // ---------------------------------------------------------------------------

  function relayFrame(channel: Channel, frame: Frame, transfer?: Transferable[]): void {
    if (closed) return;
    channel.sendRawFrame(frame, transfer);
  }

  // ---------------------------------------------------------------------------
  // Upstream → downstream: observe incoming frames from the producer side
  // ---------------------------------------------------------------------------

  // Route upstream control frames: OPEN, CLOSE, RESET from producer
  disposers.push(
    upstream.onRawControlFrame((frame) => {
      if (closed) return;

      if (frame.type === "OPEN") {
        const openFrame = frame as OpenFrame;
        // Allocate a fresh downstream stream ID for this upstream stream
        const downId = nextDownId++;
        upstreamToDown.set(openFrame.streamId, downId);
        downToUpstream.set(downId, openFrame.streamId);

        // Open a corresponding stream on the downstream channel (toward consumer).
        // Use the same initCredit as upstream negotiated so credit windows stay aligned.
        const downOpenFrame: Frame = {
          [FRAME_MARKER]: 1,
          channelId: (downstream as unknown as { _channelId?: string }).toString(),
          streamId: downId,
          seqNum: 0,
          type: "OPEN",
          initCredit: openFrame.initCredit > 0 ? openFrame.initCredit : initialCredit,
        };
        relayFrame(downstream, downOpenFrame);
        framesForwardedIn++;
        return;
      }

      if (frame.type === "CLOSE") {
        const closeFrame = frame as CloseFrame;
        const downId = upstreamToDown.get(closeFrame.streamId);
        if (downId !== undefined) {
          const downCloseFrame: Frame = {
            [FRAME_MARKER]: 1,
            channelId: "",
            streamId: downId,
            seqNum: closeFrame.seqNum,
            type: "CLOSE",
            finalSeq: closeFrame.finalSeq,
          };
          relayFrame(downstream, downCloseFrame);
          framesForwardedIn++;
          // Remove mapping — stream is done
          upstreamToDown.delete(closeFrame.streamId);
          downToUpstream.delete(downId);
        }
        return;
      }

      if (frame.type === "RESET") {
        const upId = frame.streamId;
        const downId = upstreamToDown.get(upId);
        if (downId !== undefined) {
          const downResetFrame: Frame = {
            [FRAME_MARKER]: 1,
            channelId: "",
            streamId: downId,
            seqNum: frame.seqNum,
            type: "RESET",
            reason: (frame as { reason: string }).reason,
          };
          relayFrame(downstream, downResetFrame);
          framesForwardedIn++;
          upstreamToDown.delete(upId);
          downToUpstream.delete(downId);
        }
        return;
      }
    }),
  );

  // Route upstream DATA frames to downstream (primary hot path)
  disposers.push(
    upstream.onRawDataFrame((frame: DataFrame) => {
      if (closed) return;
      const downId = upstreamToDown.get(frame.streamId);
      if (downId === undefined) {
        // No mapping yet — this DATA arrived before OPEN (race) or stream is unknown. Drop it.
        return;
      }
      // Forward DATA with translated stream ID.
      // Build a new frame object to avoid mutating the original.
      const downDataFrame: Frame = {
        [FRAME_MARKER]: 1,
        channelId: "",
        streamId: downId,
        seqNum: frame.seqNum,
        type: "DATA",
        chunkType: frame.chunkType,
        payload: frame.payload,
        isFinal: frame.isFinal,
      };
      // Do NOT transfer the payload ArrayBuffer — the upstream channel's session layer
      // still holds a reference to frame.payload after this raw handler fires, and
      // transferring would detach it before the session can reassemble the chunk.
      // Relay forwards via structured-clone (no transfer list). The relay is a middle
      // node; zero-copy doesn't apply across relay hops.
      relayFrame(downstream, downDataFrame);
      framesForwardedIn++;
      // NOTE: isFinal=true means "final chunk of this particular item (blob/object)",
      // NOT "final frame of the stream". Multiple items can be sent over one stream.
      // Stream-level cleanup happens on CLOSE or RESET — not on isFinal.
    }),
  );

  // ---------------------------------------------------------------------------
  // Downstream → upstream: observe incoming frames from the consumer side
  // ---------------------------------------------------------------------------

  disposers.push(
    downstream.onRawControlFrame((frame) => {
      if (closed) return;

      if (frame.type === "CREDIT") {
        // Consumer issued credit — forward upstream so producer can send more DATA.
        // This is the critical credit-forwarding path (TOPO-03).
        const creditFrame = frame as CreditFrame;
        const upId = downToUpstream.get(creditFrame.streamId);
        if (upId !== undefined) {
          const upCreditFrame: Frame = {
            [FRAME_MARKER]: 1,
            channelId: "",
            streamId: upId,
            seqNum: 0,
            type: "CREDIT",
            credit: creditFrame.credit,
          };
          relayFrame(upstream, upCreditFrame);
          framesForwardedOut++;
        }
        return;
      }

      if (frame.type === "CANCEL" || frame.type === "RESET") {
        // Consumer cancelled or reset — propagate upstream as RESET so producer
        // gets the cancellation signal within < 100 ms (TOPO-02).
        const upId = downToUpstream.get(frame.streamId);
        if (upId !== undefined) {
          const reason = (frame as CancelFrame | { reason: string }).reason;
          const upResetFrame: Frame = {
            [FRAME_MARKER]: 1,
            channelId: "",
            streamId: upId,
            seqNum: 0,
            type: "RESET",
            reason: reason ?? "consumer-cancel",
          };
          relayFrame(upstream, upResetFrame);
          framesForwardedOut++;
          // Clean up mapping
          downToUpstream.delete(frame.streamId);
          upstreamToDown.delete(upId);
        }
        return;
      }

      if (frame.type === "CLOSE") {
        // Consumer closed their side — propagate upstream
        const upId = downToUpstream.get(frame.streamId);
        if (upId !== undefined) {
          const closeFrame = frame as CloseFrame;
          const upCloseFrame: Frame = {
            [FRAME_MARKER]: 1,
            channelId: "",
            streamId: upId,
            seqNum: closeFrame.seqNum,
            type: "CLOSE",
            finalSeq: closeFrame.finalSeq,
          };
          relayFrame(upstream, upCloseFrame);
          framesForwardedOut++;
          downToUpstream.delete(frame.streamId);
          upstreamToDown.delete(upId);
        }
        return;
      }
    }),
  );

  // ---------------------------------------------------------------------------
  // RelayBridge public interface
  // ---------------------------------------------------------------------------

  function stats(): RelayStats {
    return {
      framesForwardedIn,
      framesForwardedOut,
      streamsActive: upstreamToDown.size,
      mappings: upstreamToDown.size,
    };
  }

  function close(): void {
    if (closed) return;
    closed = true;
    // Run all disposers to remove raw-frame hooks from both channels
    for (let i = disposers.length - 1; i >= 0; i--) {
      disposers[i]?.();
    }
    disposers.length = 0;
    for (const h of closeHandlers) {
      h();
    }
    closeHandlers.clear();
    errorHandlers.clear();
  }

  function on(event: "error" | "close", handler: (payload?: unknown) => void): void {
    if (event === "error") errorHandlers.add(handler);
    else if (event === "close") closeHandlers.add(handler);
  }

  return { stats, close, on };
}
