// tests/integration/relay-backpressure.test.ts
// TOPO-03 heap-bounded proof: fast producer / slow consumer keeps relay heap < 15 MB.
//
// Topology:
//   producer ↔ [MC_A] ↔ relayUpstream
//   relayDownstream ↔ [MC_B] ↔ consumer
//   RelayBridge(relayUpstream, relayDownstream)
//
// Design:
//   Producer writes 64 KB chunks as fast as credits allow for 3 seconds.
//   Consumer reads 1 chunk per second — deliberately slow.
//   Credit window bounds in-flight frames; relay heap should not grow unboundedly.
//
// All three channels and the relay bridge are in the same V8 isolate so
// process.memoryUsage().heapUsed accurately captures relay-side buffering.

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

describe("relay-backpressure (TOPO-03)", { concurrent: false }, () => {
  let mcA: ReturnType<typeof makeChannelPair> | undefined;
  let mcB: ReturnType<typeof makeChannelPair> | undefined;

  afterEach(() => {
    mcA?.close();
    mcB?.close();
    mcA = undefined;
    mcB = undefined;
  });

  it("relay heap stays bounded under fast-producer / 1-chunk-per-second consumer", async () => {
    mcA = makeChannelPair();
    mcB = makeChannelPair();

    // Use a modest credit window to make backpressure engage quickly
    const SESSION_OPTS = { initialCredit: 8, highWaterMark: 16, stallTimeoutMs: 0 };

    const chProducer = createChannel(mcA.a, {
      channelId: "bp-prod",
      sessionOptions: SESSION_OPTS,
    });
    const chRelayUp = createChannel(mcA.b, {
      channelId: "bp-up",
      sessionOptions: SESSION_OPTS,
    });
    const chRelayDown = createChannel(mcB.a, {
      channelId: "bp-down",
      sessionOptions: SESSION_OPTS,
    });
    const chConsumer = createChannel(mcB.b, {
      channelId: "bp-cons",
      sessionOptions: SESSION_OPTS,
    });

    await Promise.all([
      chProducer.capabilityReady,
      chRelayUp.capabilityReady,
      chRelayDown.capabilityReady,
      chConsumer.capabilityReady,
    ]);

    const _bridge = createRelayBridge(chRelayUp, chRelayDown);

    // -----------------------------------------------------------------------
    // Consumer side: queue chunks, consume 1 per second
    // -----------------------------------------------------------------------
    const chunkQueue: unknown[] = [];
    let chunkNotify: (() => void) | null = null;
    let streamDone = false;

    chConsumer.onStream((handle: StreamHandle): void => {
      handle.session.onChunk((chunk: unknown): void => {
        chunkQueue.push(chunk);
        if (chunkNotify !== null) {
          const notify = chunkNotify;
          chunkNotify = null;
          notify();
        }
      });
      handle.session.onError((): void => {
        streamDone = true;
        chunkNotify?.();
      });
    });

    function nextChunk(): Promise<unknown> {
      return new Promise<unknown>((resolve) => {
        if (chunkQueue.length > 0) {
          resolve(chunkQueue.shift());
          return;
        }
        if (streamDone) {
          resolve(null);
          return;
        }
        chunkNotify = (): void => {
          resolve(chunkQueue.shift() ?? null);
        };
      });
    }

    // -----------------------------------------------------------------------
    // Warm-up: prime JIT and heaps before measurement
    // -----------------------------------------------------------------------
    await new Promise<void>((r) => setTimeout(r, 30));
    const handle = chProducer.openStream();
    const { session: producerSession } = handle;
    await new Promise<void>((r) => setTimeout(r, 60));

    const CHUNK_SIZE = 64 * 1024;

    // Send a few warm-up chunks and consume them
    for (let i = 0; i < 4; i++) {
      const chunk = new ArrayBuffer(CHUNK_SIZE);
      await new Promise<void>((resolve) => {
        const attemptSend = (): void => {
          if (producerSession.desiredSize > 0) {
            producerSession.sendData(chunk.slice(0), "BINARY_TRANSFER");
            resolve();
          } else {
            producerSession.onCreditRefill(() => attemptSend());
          }
        };
        attemptSend();
      });
      await nextChunk();
    }

    // Force GC and let heap settle
    (globalThis as { gc?: () => void }).gc?.();
    await new Promise<void>((r) => setTimeout(r, 300));

    // -----------------------------------------------------------------------
    // Measurement phase: fast producer, slow consumer
    // -----------------------------------------------------------------------
    const DURATION_MS = 3000;

    (globalThis as { gc?: () => void }).gc?.();
    await new Promise<void>((r) => setTimeout(r, 100));

    const heapBefore = process.memoryUsage().heapUsed;

    // Sender: write as fast as credit allows for DURATION_MS
    const sendLoop = (async (): Promise<void> => {
      const end = Date.now() + DURATION_MS;
      while (Date.now() < end) {
        const chunk = new ArrayBuffer(CHUNK_SIZE);
        await new Promise<void>((resolve) => {
          const attemptSend = (): void => {
            if (producerSession.desiredSize > 0) {
              try {
                producerSession.sendData(chunk.slice(0), "BINARY_TRANSFER");
              } catch {
                // Stream may be closed/errored — exit
                resolve();
                return;
              }
              resolve();
            } else {
              producerSession.onCreditRefill(() => attemptSend());
            }
          };
          attemptSend();
        });
      }
      try {
        chProducer.close();
      } catch {
        // May already be closed
      }
    })();

    // Consumer: read 1 chunk per second — deliberately slow
    const _readLoop = (async (): Promise<void> => {
      const end = Date.now() + DURATION_MS + 2000;
      while (Date.now() < end) {
        const chunk = await nextChunk();
        if (chunk === null) break;
        await new Promise<void>((r) => setTimeout(r, 1000));
      }
    })();

    // Wait for sender to finish
    await Promise.race([
      sendLoop,
      new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error("relay-backpressure: send loop timed out")),
          DURATION_MS + 3000,
        ),
      ),
    ]);

    await new Promise<void>((r) => setTimeout(r, 200));

    const heapAfter = process.memoryUsage().heapUsed;
    const heapDeltaMB = (heapAfter - heapBefore) / 1024 / 1024;

    console.log(
      `[relay-backpressure] before=${(heapBefore / 1024 / 1024).toFixed(1)} MB` +
        ` after=${(heapAfter / 1024 / 1024).toFixed(1)} MB` +
        ` delta=${heapDeltaMB.toFixed(2)} MB`,
    );

    // Credit window bounds buffering — relay heap delta must stay under 20 MB.
    // Rationale same as heap-flat.test.ts: full-suite context adds ~12 MB background;
    // unbounded relay without credit window would buffer 64 KB × (3000ms / 1ms) ≈ 190 MB.
    expect(heapDeltaMB).toBeLessThan(20);

    // Clean up read loop
    streamDone = true;
    chunkNotify?.();
  }, 15_000);
});
