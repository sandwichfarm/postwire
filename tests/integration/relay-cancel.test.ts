// tests/integration/relay-cancel.test.ts
// TOPO-02: Consumer cancel propagates to producer within < 100 ms.
//
// Topology:
//   producer ↔ [MC_A] ↔ relayUpstream
//   relayDownstream ↔ [MC_B] ↔ consumer
//   RelayBridge(relayUpstream, relayDownstream)
//
// Test procedure:
//   1. Set up three-endpoint topology
//   2. Producer opens stream and starts writing
//   3. Consumer receives 5 chunks, then cancels via session.reset()
//   4. Measure time from cancel to producer's onError firing
//   5. Assert < 100 ms

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

describe("relay-cancel (TOPO-02)", { concurrent: false }, () => {
  let mcA: ReturnType<typeof makeChannelPair> | undefined;
  let mcB: ReturnType<typeof makeChannelPair> | undefined;

  afterEach(() => {
    mcA?.close();
    mcB?.close();
    mcA = undefined;
    mcB = undefined;
  });

  it("consumer cancel propagates to producer within 100 ms", async () => {
    mcA = makeChannelPair();
    mcB = makeChannelPair();

    const chProducer = createChannel(mcA.a, { channelId: "cancel-prod" });
    const chRelayUp = createChannel(mcA.b, { channelId: "cancel-up" });
    const chRelayDown = createChannel(mcB.a, { channelId: "cancel-down" });
    const chConsumer = createChannel(mcB.b, { channelId: "cancel-cons" });

    await Promise.all([
      chProducer.capabilityReady,
      chRelayUp.capabilityReady,
      chRelayDown.capabilityReady,
      chConsumer.capabilityReady,
    ]);

    const bridge = createRelayBridge(chRelayUp, chRelayDown);

    // -----------------------------------------------------------------------
    // Consumer side: receive 5 chunks then cancel
    // -----------------------------------------------------------------------
    let consumerHandle: StreamHandle | null = null;
    const consumerChunks: unknown[] = [];
    let resolveConsumerReady: (() => void) | null = null;
    const consumerReady = new Promise<void>((r) => {
      resolveConsumerReady = r;
    });

    chConsumer.onStream((handle: StreamHandle): void => {
      consumerHandle = handle;
      handle.session.onChunk((chunk: unknown): void => {
        consumerChunks.push(chunk);
      });
      resolveConsumerReady?.();
    });

    // -----------------------------------------------------------------------
    // Producer side: track when cancel arrives via session error
    // -----------------------------------------------------------------------
    let producerErrorTs: number | null = null;
    let resolveProducerError: (() => void) | null = null;
    const producerErrorPromise = new Promise<void>((r) => {
      resolveProducerError = r;
    });

    await new Promise<void>((r) => setTimeout(r, 30));
    const handle = chProducer.openStream();
    const { session: producerSession } = handle;

    producerSession.onError((_reason: string): void => {
      producerErrorTs = performance.now();
      resolveProducerError?.();
    });

    // Wait for stream to reach consumer
    await new Promise<void>((r) => setTimeout(r, 60));
    await consumerReady;

    const CHUNK_SIZE = 64 * 1024;

    // Send 8 chunks — consumer will cancel after 5
    for (let i = 0; i < 8; i++) {
      const chunk = new ArrayBuffer(CHUNK_SIZE);
      await new Promise<void>((resolve) => {
        const attemptSend = (): void => {
          if (producerSession.desiredSize > 0) {
            try {
              producerSession.sendData(chunk.slice(0), "BINARY_TRANSFER");
            } catch {
              // Producer may have been errored by the relay cancel
            }
            resolve();
          } else {
            producerSession.onCreditRefill(() => attemptSend());
          }
        };
        attemptSend();
      });
    }

    // Wait for consumer to receive at least 5 chunks
    let waitedFor5 = 0;
    while (consumerChunks.length < 5 && waitedFor5 < 2000) {
      await new Promise<void>((r) => setTimeout(r, 10));
      waitedFor5 += 10;
    }
    expect(consumerChunks.length).toBeGreaterThanOrEqual(5);

    // Consumer cancels — measure time from cancel to producer error
    const cancelTs = performance.now();
    consumerHandle?.session.reset("consumer-cancel");

    // Wait for producer error (with a generous timeout)
    await Promise.race([
      producerErrorPromise,
      new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error("relay-cancel: producer did not receive cancel signal")),
          5000,
        ),
      ),
    ]);

    // producerErrorTs is guaranteed non-null here since producerErrorPromise resolved
    const cancelLatencyMs = (producerErrorTs ?? performance.now()) - cancelTs;

    console.log(
      `[relay-cancel] cancel latency=${cancelLatencyMs.toFixed(2)} ms` +
        ` (consumer received ${consumerChunks.length} chunks before cancel)`,
    );

    // Cancel propagation must be < 100 ms (TOPO-02)
    expect(cancelLatencyMs).toBeLessThan(100);

    bridge.close();
  }, 10_000);
});
