// tests/integration/heap-flat.test.ts
// SESS-03 proof: credit window bounds heap growth under fast-send / slow-consume.
//
// Design:
//   Side A (initiator) writes 64 KB chunks as fast as credits allow.
//   Side B (responder) reads 1 chunk per second — deliberately slow consumer.
//   Credit window HWM bounds the in-flight buffer; heap should plateau, not climb.
//
// Test is run non-concurrent (timing-sensitive) with a 15-second timeout.
// Warm-up loop runs first to eliminate JIT / GC spike noise before measurement.

import { afterEach, describe, expect, it } from "vitest";
import { createStream } from "../../src/adapters/streams.js";
import type { StreamHandle } from "../../src/channel/channel.js";
import { createChannel } from "../../src/channel/channel.js";
import type { MockEndpointPair } from "../helpers/mock-endpoint.js";
import { createMessageChannelPair } from "../helpers/mock-endpoint.js";

describe("heap-flat slow-consumer (SESS-03)", { concurrent: false }, () => {
  let pair: MockEndpointPair | undefined;

  afterEach(() => {
    pair?.close();
    pair = undefined;
  });

  it("heap stays flat under fast-send / slow-consume (credit window proof)", async () => {
    pair = createMessageChannelPair();
    const CHANNEL_ID = "heap-flat-test";

    // Use a modest credit window so backpressure kicks in quickly.
    const SESSION_OPTS = { initialCredit: 8, highWaterMark: 16, stallTimeoutMs: 0 };

    const chA = createChannel(pair.a, { channelId: CHANNEL_ID, sessionOptions: SESSION_OPTS });
    const chB = createChannel(pair.b, { channelId: CHANNEL_ID, sessionOptions: SESSION_OPTS });

    await Promise.all([chA.capabilityReady, chB.capabilityReady]);

    // Side A: initiator stream (writes data)
    const { writable } = createStream(chA, { sessionOptions: SESSION_OPTS });

    // Side B: responder — receive inbound stream and build a manual readable.
    // We use a simple Promise queue to hand chunks to the slow reader loop.
    const chunkQueue: unknown[] = [];
    let chunkNotify: (() => void) | null = null;
    let streamDone = false;

    chB.onStream((handle: StreamHandle): void => {
      handle.session.onChunk((chunk: unknown): void => {
        chunkQueue.push(chunk);
        if (chunkNotify !== null) {
          const notify = chunkNotify;
          chunkNotify = null;
          notify();
        }
      });
      // Wire close — mark done so readLoop can exit
      handle.session.onError((): void => {
        streamDone = true;
        if (chunkNotify !== null) {
          const notify = chunkNotify;
          chunkNotify = null;
          notify();
        }
      });
    });

    // Wait for OPEN / OPEN_ACK handshake
    await new Promise<void>((r) => setTimeout(r, 50));

    // Helper: wait for next chunk from the queue (or stream done)
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
    // Warm-up phase: prime JIT and heaps before measurement.
    // -----------------------------------------------------------------------
    const writer = writable.getWriter();

    for (let i = 0; i < 4; i++) {
      await writer.write(new ArrayBuffer(64 * 1024));
      await nextChunk();
    }

    // Trigger GC if available (Node --expose-gc flag) and let heap settle
    (globalThis as { gc?: () => void }).gc?.();
    await new Promise<void>((r) => setTimeout(r, 500));

    // -----------------------------------------------------------------------
    // Measurement phase: fast sender vs slow consumer (1 chunk/s).
    // -----------------------------------------------------------------------
    const DURATION_MS = 3000; // 3 seconds
    const CHUNK_SIZE = 64 * 1024; // 64 KB

    // Force GC before baseline snapshot (--expose-gc enables global.gc)
    (globalThis as { gc?: () => void }).gc?.();
    await new Promise<void>((r) => setTimeout(r, 100));

    const heapBefore = process.memoryUsage().heapUsed;

    // Sender: write as fast as the credit window allows for DURATION_MS
    const sendLoop = (async (): Promise<void> => {
      const end = Date.now() + DURATION_MS;
      while (Date.now() < end) {
        try {
          // slice() to produce a fresh ArrayBuffer each time — avoids re-transferring
          // a detached buffer (ArrayBuffer detach happens on BINARY_TRANSFER path;
          // STRUCTURED_CLONE path keeps the buffer intact, but slice is cleaner).
          await writer.write(new ArrayBuffer(CHUNK_SIZE));
        } catch {
          // Stream may be closed/errored if reader cancelled — exit cleanly
          break;
        }
      }
      try {
        await writer.close();
      } catch {
        // May already be closing — ignore
      }
    })();

    // Consumer: read 1 chunk per second — deliberately slow to exercise backpressure
    // _readLoop runs concurrently; we don't await it (sender drives test duration)
    const _readLoop = (async (): Promise<void> => {
      const end = Date.now() + DURATION_MS + 1000; // slightly longer than sender
      while (Date.now() < end) {
        const chunk = await nextChunk();
        if (chunk === null) break; // stream done
        // Hold the chunk for 1 second before reading next (slow consumer)
        await new Promise<void>((r) => setTimeout(r, 1000));
      }
    })();

    // Run until sender finishes (or timeout)
    await Promise.race([
      sendLoop,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("heap-flat test timed out")), DURATION_MS + 3000),
      ),
    ]);

    // Let read loop drain briefly, then measure heap
    await new Promise<void>((r) => setTimeout(r, 200));

    const heapAfter = process.memoryUsage().heapUsed;
    const heapDeltaMB = (heapAfter - heapBefore) / 1024 / 1024;

    // Log for CI visibility (not buffered by --reporter default)
    console.log(
      `[heap-flat] before=${(heapBefore / 1024 / 1024).toFixed(1)} MB` +
        ` after=${(heapAfter / 1024 / 1024).toFixed(1)} MB` +
        ` delta=${heapDeltaMB.toFixed(2)} MB`,
    );

    // Credit window bounds buffering — heap delta must stay under 30 MB.
    // Rationale:
    //   - 30 MB accommodates Vitest full-suite context (other test files loading modules
    //     in the same V8 isolate during the 3-second measurement window can add ~12 MB,
    //     and occasional spikes to ~22 MB have been observed in CI under parallel test
    //     workers — this is not related to credit-window correctness).
    //   - When run in isolation (vitest run tests/integration/heap-flat.test.ts),
    //     delta is typically negative (GC reclaims warm-up allocations).
    //   - If unbounded buffering occurred (no credit window), the sender would enqueue
    //     64 KB × (3000ms / write-latency) chunks. At 1 ms/write that's ~190 MB —
    //     far above this threshold. The delta being <30 MB proves the credit window works.
    expect(heapDeltaMB).toBeLessThan(30);

    // Clean up read loop
    streamDone = true;
    if (chunkNotify !== null) {
      chunkNotify();
    }
  }, 15_000); // 15-second test timeout

  it("heap-flat test completes without hanging or OOM (smoke)", async () => {
    // Lightweight variant: verify the test harness works end-to-end without
    // a slow consumer. Sends and receives 5 chunks, then graceful close.
    pair = createMessageChannelPair();
    const CHANNEL_ID = "heap-flat-smoke";

    const chA = createChannel(pair.a, { channelId: CHANNEL_ID });
    const chB = createChannel(pair.b, { channelId: CHANNEL_ID });

    await Promise.all([chA.capabilityReady, chB.capabilityReady]);

    const receivedChunks: unknown[] = [];
    let notifyReceived: (() => void) | null = null;

    chB.onStream((handle: StreamHandle): void => {
      handle.session.onChunk((chunk: unknown): void => {
        receivedChunks.push(chunk);
        if (notifyReceived !== null) {
          const notify = notifyReceived;
          notifyReceived = null;
          notify();
        }
      });
    });

    const { writable } = createStream(chA);
    await new Promise<void>((r) => setTimeout(r, 50));

    const writer = writable.getWriter();
    const CHUNK_COUNT = 5;

    for (let i = 0; i < CHUNK_COUNT; i++) {
      await writer.write(new ArrayBuffer(1024));
    }

    // Wait for all chunks to arrive
    await new Promise<void>((resolve) => {
      if (receivedChunks.length >= CHUNK_COUNT) {
        resolve();
        return;
      }
      const start = Date.now();
      const poll = setInterval((): void => {
        if (receivedChunks.length >= CHUNK_COUNT || Date.now() - start > 3000) {
          clearInterval(poll);
          resolve();
        }
      }, 10);
    });

    expect(receivedChunks).toHaveLength(CHUNK_COUNT);

    await writer.close();
  }, 5_000);
});
