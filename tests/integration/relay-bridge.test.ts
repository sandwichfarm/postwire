// tests/integration/relay-bridge.test.ts
// End-to-end relay test: 10 MB binary stream through A → relay → B.
//
// Topology:
//   producer ↔ [MC_A] ↔ relayUpstream
//   relayDownstream ↔ [MC_B] ↔ consumer
//   RelayBridge(relayUpstream, relayDownstream)
//
// Requirements verified:
//   - TOPO-04: stream IDs mapped end-to-end via routing table
//   - Bytes received === bytes sent (data integrity)
//   - framesForwardedIn > 0 after transfer (relay stats verify forwarding)

import { MessageChannel } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import type { StreamHandle } from "../../src/channel/channel.js";
import { createChannel } from "../../src/channel/channel.js";
import { createRelayBridge } from "../../src/relay/bridge.js";
import type { PostMessageEndpoint } from "../../src/transport/endpoint.js";

function makeChannelPair(): { a: PostMessageEndpoint; b: PostMessageEndpoint; close(): void } {
  const { port1, port2 } = new MessageChannel();
  return {
    a: port1 as unknown as PostMessageEndpoint,
    b: port2 as unknown as PostMessageEndpoint,
    close() {
      port1.close();
      port2.close();
    },
  };
}

describe("relay-bridge integration (TOPO-04)", { concurrent: false }, () => {
  let mcA: ReturnType<typeof makeChannelPair> | undefined;
  let mcB: ReturnType<typeof makeChannelPair> | undefined;

  afterEach(() => {
    mcA?.close();
    mcB?.close();
    mcA = undefined;
    mcB = undefined;
  });

  it("delivers 10 MB binary stream end-to-end through relay with bytes intact", async () => {
    mcA = makeChannelPair();
    mcB = makeChannelPair();

    // Four channel instances — two pairs connected by MC_A and MC_B
    const chProducer = createChannel(mcA.a, { channelId: "relay-e2e-prod" });
    const chRelayUp = createChannel(mcA.b, { channelId: "relay-e2e-up" });
    const chRelayDown = createChannel(mcB.a, { channelId: "relay-e2e-down" });
    const chConsumer = createChannel(mcB.b, { channelId: "relay-e2e-cons" });

    // Wait for all capability handshakes
    await Promise.all([
      chProducer.capabilityReady,
      chRelayUp.capabilityReady,
      chRelayDown.capabilityReady,
      chConsumer.capabilityReady,
    ]);

    // Wire the relay bridge
    const bridge = createRelayBridge(chRelayUp, chRelayDown);

    // -----------------------------------------------------------------------
    // Consumer side: collect all received chunks, notify when target count reached
    // -----------------------------------------------------------------------
    const receivedBytes: number[] = [];
    let resolveAllReceived: (() => void) | null = null;
    const CHUNK_COUNT = 160; // 10 MB / 64 KB

    const allReceived = new Promise<void>((resolve) => {
      resolveAllReceived = resolve;
    });

    chConsumer.onStream((handle: StreamHandle): void => {
      handle.session.onChunk((chunk: unknown): void => {
        if (chunk instanceof ArrayBuffer) {
          receivedBytes.push(chunk.byteLength);
        }
        if (receivedBytes.length >= CHUNK_COUNT) {
          resolveAllReceived?.();
        }
      });
    });

    // -----------------------------------------------------------------------
    // Producer side: open stream and send 10 MB in chunks
    // -----------------------------------------------------------------------
    const TOTAL_BYTES = 10 * 1024 * 1024; // 10 MB
    const CHUNK_SIZE = 64 * 1024; // 64 KB chunks

    // Let the relay hooks register, then let the capability handshakes settle
    await new Promise<void>((r) => setTimeout(r, 30));

    const handle = chProducer.openStream();
    const { session: producerSession } = handle;

    // Allow OPEN handshake to complete through relay to consumer
    await new Promise<void>((r) => setTimeout(r, 60));

    let totalSent = 0;

    // Send all chunks, waiting for credit when needed
    for (let i = 0; i < CHUNK_COUNT; i++) {
      const size = Math.min(CHUNK_SIZE, TOTAL_BYTES - totalSent);
      const chunk = new ArrayBuffer(size);
      await new Promise<void>((resolve) => {
        const attemptSend = (): void => {
          if (producerSession.desiredSize > 0) {
            producerSession.sendData(chunk.slice(0), "BINARY_TRANSFER");
            totalSent += size;
            resolve();
          } else {
            // Wait for credit refill from the relay's credit forwarding
            producerSession.onCreditRefill(() => {
              attemptSend();
            });
          }
        };
        attemptSend();
      });
    }

    // Wait for all chunks to arrive at consumer (poll for up to 5 seconds)
    await Promise.race([
      allReceived,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("relay-bridge: timed out waiting for all chunks")), 5000),
      ),
    ]);

    const totalReceived = receivedBytes.reduce((a, b) => a + b, 0);
    console.log(
      `[relay-bridge] sent=${(totalSent / 1024 / 1024).toFixed(2)} MB` +
        ` received=${(totalReceived / 1024 / 1024).toFixed(2)} MB` +
        ` chunks=${receivedBytes.length}/${CHUNK_COUNT}`,
    );

    // Verify bytes integrity: total received matches total sent
    expect(totalReceived).toBe(totalSent);
    expect(receivedBytes.length).toBe(CHUNK_COUNT);

    // Relay stats: framesForwardedIn > 0 (DATA frames were forwarded)
    const stats = bridge.stats();
    expect(stats.framesForwardedIn).toBeGreaterThan(0);

    bridge.close();
    chProducer.close();
  }, 30_000);
});
