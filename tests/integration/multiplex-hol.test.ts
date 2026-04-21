// tests/integration/multiplex-hol.test.ts
// Phase 8 MUX-02 proof: Head-of-line blocking is eliminated in multiplex mode.
//
// Design:
//   Initiator side opens 4 concurrent streams and writes 32 chunks (1 KB each) on each.
//   Streams 1, 3, 4 (open order 0, 2, 3): normal responder — consume all chunks.
//   Stream 2 (open order 1, streamId=3): CREDIT frames from its responder are intercepted
//   and dropped so the initiator's send credit for that stream never refills → stalled.
//
//   After 2 seconds: streams 0, 2, 3 must have delivered all 32 chunks.
//   Stream 1 (stalled) must still be queued (< 32 delivered to responder).
//   Per-stream stats confirm stream 1's credit window is exhausted (≤ 0).
//
// This test proves MUX-02: a stalled stream's drained credit window cannot block
// other streams on the same channel because credit windows are independent.

import { MessageChannel } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import { createChannel } from "../../src/channel/channel.js";
import { decode } from "../../src/framing/encode-decode.js";
import type { PostMessageEndpoint } from "../../src/transport/endpoint.js";

/**
 * Create a "credit-dropping" endpoint pair for the stall test.
 *
 * - Normal side (portA): used by the initiator. All inbound messages from portB
 *   are filtered: CREDIT frames for the target streamId are dropped, everything
 *   else passes through.
 * - Normal side (portB): used by the responder. All messages from portA pass through.
 *
 * This simulates a responder that never grants more credits for stream `stalledStreamId`,
 * without modifying any library source code.
 */
function createCreditDroppingPair(stalledStreamId: number): {
  initiatorEndpoint: PostMessageEndpoint;
  responderEndpoint: PostMessageEndpoint;
  close(): void;
} {
  const { port1, port2 } = new MessageChannel();

  // Wrapper around port1 (initiator side) that filters inbound CREDIT frames for the stalled stream
  const initiatorEndpoint: PostMessageEndpoint = {
    get onmessage() {
      return port1.onmessage as ((evt: MessageEvent) => void) | null;
    },
    set onmessage(handler: ((evt: MessageEvent) => void) | null) {
      if (handler === null) {
        port1.onmessage = null;
        return;
      }
      // Intercept: drop CREDIT frames for the stalled stream; pass everything else
      port1.onmessage = (evt: MessageEvent) => {
        const frame = decode(evt.data);
        if (frame !== null && frame.type === "CREDIT" && frame.streamId === stalledStreamId) {
          // Drop this CREDIT frame — initiator's send credit for stalledStreamId stays at 0
          return;
        }
        handler(evt);
      };
    },
    postMessage(data: unknown, transfer?: Transferable[]) {
      port1.postMessage(data, transfer as Transferable[]);
    },
  };

  const responderEndpoint: PostMessageEndpoint = {
    get onmessage() {
      return port2.onmessage as ((evt: MessageEvent) => void) | null;
    },
    set onmessage(handler: ((evt: MessageEvent) => void) | null) {
      port2.onmessage = handler;
    },
    postMessage(data: unknown, transfer?: Transferable[]) {
      port2.postMessage(data, transfer as Transferable[]);
    },
  };

  return {
    initiatorEndpoint,
    responderEndpoint,
    close() {
      port1.close();
      port2.close();
    },
  };
}

describe("multiplex HoL-blocking (MUX-02)", { concurrent: false }, () => {
  it("stalled stream credit window does not block streams 1, 3, 4 delivering 32 chunks each", async () => {
    // Stream IDs allocated by the initiator (odd): 1, 3, 5, 7
    // We will stall streamId=3 (the second opened stream) by dropping its CREDIT frames.
    const STALLED_STREAM_ID = 3;

    const { initiatorEndpoint, responderEndpoint, close } =
      createCreditDroppingPair(STALLED_STREAM_ID);

    const CHUNK_COUNT = 32;
    const CHUNK_SIZE = 1024; // 1 KB per chunk
    // Small initial credit window so stream 3 stalls after a few chunks.
    const SESSION_OPTS = { initialCredit: 4, highWaterMark: 8, stallTimeoutMs: 0 };

    const chA = createChannel(initiatorEndpoint, {
      multiplex: true,
      role: "initiator",
      sessionOptions: SESSION_OPTS,
    });
    const chB = createChannel(responderEndpoint, {
      multiplex: true,
      role: "responder",
      sessionOptions: SESSION_OPTS,
    });

    try {
      await Promise.all([chA.capabilityReady, chB.capabilityReady]);

      // ---------------------------------------------------------------------------
      // Initiator: open 4 streams
      // streamIds: 1, 3 (stalled), 5, 7
      // ---------------------------------------------------------------------------
      const handles = [
        chA.openStream(), // index 0 → streamId 1
        chA.openStream(), // index 1 → streamId 3 (stalled — no CREDIT frames will arrive)
        chA.openStream(), // index 2 → streamId 5
        chA.openStream(), // index 3 → streamId 7
      ];

      // ---------------------------------------------------------------------------
      // Responder: wire chunk counters for all 4 streams
      // ---------------------------------------------------------------------------
      const chunksReceived = [0, 0, 0, 0];
      const streamIdToIndex = new Map<number, number>();

      let streamsWired = 0;
      const _allStreamsWired = new Promise<void>((r) => {
        chB.onStream((handle) => {
          // Assign index based on arrival order (OPEN frames arrive in send order)
          const idx = streamsWired++;
          streamIdToIndex.set(handle.session.streamId, idx);
          handle.session.onChunk(() => {
            chunksReceived[idx]++;
          });
          if (streamsWired === 4) r();
        });
      });

      // Wait for all 4 OPEN/OPEN_ACK handshakes
      await new Promise<void>((r) => setTimeout(r, 50));

      // ---------------------------------------------------------------------------
      // Initiator: write 32 chunks per stream concurrently.
      // Yields after each write so the event loop can process CREDIT frames.
      // Stream 3's writes will stall after 4 initial credits are consumed.
      // Streams 1, 5, 7 will get CREDIT frames back and keep flowing.
      // ---------------------------------------------------------------------------
      const writePromises = handles.map(async ({ session }) => {
        for (let i = 0; i < CHUNK_COUNT; i++) {
          session.sendData(new ArrayBuffer(CHUNK_SIZE), "BINARY_TRANSFER");
          await new Promise<void>((r) => setImmediate(r));
        }
      });

      // Run writes concurrently for 2 seconds, then check results
      const writeAll = Promise.all(writePromises);

      await new Promise<void>((r) => setTimeout(r, 2000));

      // ---------------------------------------------------------------------------
      // Assertions
      // ---------------------------------------------------------------------------
      console.log(
        "[multiplex-hol] chunk counts per stream after 2s:",
        chunksReceived.map((n, i) => `stream[${i}]=${n}`).join(", "),
      );

      // Streams 0, 2, 3 (streamIds 1, 5, 7) must have delivered all 32 chunks
      expect(chunksReceived[0]).toBe(CHUNK_COUNT);
      expect(chunksReceived[2]).toBe(CHUNK_COUNT);
      expect(chunksReceived[3]).toBe(CHUNK_COUNT);

      // Stream 1 (streamId 3, stalled) received < 32 — it stalled at initialCredit=4
      const stalledCount = chunksReceived[1];
      console.log(
        `[multiplex-hol] stalled stream (id=${STALLED_STREAM_ID}) delivered ${stalledCount}/${CHUNK_COUNT} chunks`,
      );
      expect(stalledCount).toBeLessThan(CHUNK_COUNT);

      // ---------------------------------------------------------------------------
      // Per-stream stats: initiator side shows 4 streams with different credit levels
      // ---------------------------------------------------------------------------
      const stats = chA.stats();
      console.log(
        "[multiplex-hol] per-stream creditWindowAvailable:",
        stats.streams
          .map((s) => `streamId=${s.streamId} credit=${s.creditWindowAvailable}`)
          .join(", "),
      );

      expect(stats.streams.length).toBe(4);

      // Stalled stream should have 0 or negative credit (CREDIT frames were dropped)
      const stalledStats = stats.streams.find((s) => s.streamId === STALLED_STREAM_ID);
      expect(stalledStats).toBeDefined();
      expect(stalledStats?.creditWindowAvailable).toBeLessThanOrEqual(0);

      // Active streams completed — their credit may have been refilled multiple times
      for (const h of [handles[0], handles[2], handles[3]]) {
        const ss = stats.streams.find((s) => s.streamId === h.session.streamId);
        expect(ss).toBeDefined();
      }

      // Clean up write loop
      await writeAll.catch(() => {
        /* stream 3's writes may be pending when channels close — ignore */
      });
    } finally {
      chA.close();
      chB.close();
      close();
    }
  }, 8_000); // 8-second test timeout
});
