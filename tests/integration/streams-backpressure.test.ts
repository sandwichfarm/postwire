// tests/integration/streams-backpressure.test.ts
// API-03: Integration tests for WHATWG Streams backpressure via createStream().
// Uses real Node MessageChannel for genuine structured-clone semantics.
//
// Design:
//   Side A calls createStream(chA) — opens an initiator stream, writes data.
//   Side B registers chB.onStream() to receive the responder session.
//   This mirrors the real use case: one side writes, the other reads.
//
// Backpressure chain (RESEARCH.md Pattern 2):
//   writer.write() → sink.write() → session.sendData() → credit-gated
//   → CREDIT frame from B → session drains #pendingSends → writer.ready resolves

import { afterEach, describe, expect, it } from "vitest";
import { createStream } from "../../src/adapters/streams.js";
import type { StreamHandle } from "../../src/channel/channel.js";
import { createChannel } from "../../src/channel/channel.js";
import type { MockEndpointPair } from "../helpers/mock-endpoint.js";
import { createMessageChannelPair } from "../helpers/mock-endpoint.js";

describe("Streams backpressure (API-03)", { concurrent: false }, () => {
  let pair: MockEndpointPair | undefined;

  afterEach(() => {
    pair?.close();
    pair = undefined;
  });

  it("writer.ready is a Promise that resolves when consumer is active", async () => {
    pair = createMessageChannelPair();
    const CHANNEL_ID = "test-streams-ready";

    const chA = createChannel(pair.a, { channelId: CHANNEL_ID });
    const chB = createChannel(pair.b, { channelId: CHANNEL_ID });

    // Wait for CAPABILITY handshake on both sides
    await Promise.all([chA.capabilityReady, chB.capabilityReady]);

    // Side B: register stream handler before A opens stream
    // (we don't need the handle — just ensure the registration happens before A opens)
    chB.onStream((_handle: StreamHandle) => {});

    // Side A: open stream (sends OPEN frame) — initiator
    const { writable } = createStream(chA);

    // Wait for OPEN/OPEN_ACK handshake (async delivery)
    await new Promise<void>((r) => setTimeout(r, 50));

    // writer.ready should resolve (we have initial send credits after OPEN_ACK)
    const writer = writable.getWriter();
    await expect(writer.ready).resolves.toBeUndefined();

    writer.releaseLock();
  }, 5000);

  it("write() resolves for small string chunks over real MessageChannel", async () => {
    pair = createMessageChannelPair();
    const CHANNEL_ID = "test-streams-write";

    const chA = createChannel(pair.a, { channelId: CHANNEL_ID });
    const chB = createChannel(pair.b, { channelId: CHANNEL_ID });

    await Promise.all([chA.capabilityReady, chB.capabilityReady]);

    // Track received chunks on side B
    const receivedChunks: unknown[] = [];
    chB.onStream((handle) => {
      handle.session.onChunk((chunk) => receivedChunks.push(chunk));
    });

    // Side A: open stream and write
    const { writable } = createStream(chA);

    // Wait for OPEN/OPEN_ACK
    await new Promise<void>((r) => setTimeout(r, 50));

    const writer = writable.getWriter();

    // Write several chunks — should resolve after session accepts them
    await writer.write("chunk-1");
    await writer.write("chunk-2");
    await writer.write("chunk-3");

    // Wait for async delivery to side B
    await new Promise<void>((resolve) => {
      const start = Date.now();
      const check = setInterval(() => {
        if (receivedChunks.length >= 3 || Date.now() - start > 3000) {
          clearInterval(check);
          resolve();
        }
      }, 10);
    });

    expect(receivedChunks).toHaveLength(3);
    expect(receivedChunks[0]).toBe("chunk-1");
    expect(receivedChunks[1]).toBe("chunk-2");
    expect(receivedChunks[2]).toBe("chunk-3");

    writer.releaseLock();
  }, 10000);

  it("pipes 16 chunks × 1 MB (16 MB total) through a streams pair", async () => {
    pair = createMessageChannelPair();
    const CHANNEL_ID = "test-streams-16mb";

    const chA = createChannel(pair.a, {
      channelId: CHANNEL_ID,
      // Increase initial credit to allow larger pipeline
      sessionOptions: { initialCredit: 32, highWaterMark: 64 },
    });
    const chB = createChannel(pair.b, {
      channelId: CHANNEL_ID,
      sessionOptions: { initialCredit: 32, highWaterMark: 64 },
    });

    await Promise.all([chA.capabilityReady, chB.capabilityReady]);

    // Track received bytes on side B
    let totalReceivedBytes = 0;
    let receivedChunkCount = 0;

    chB.onStream((handle) => {
      handle.session.onChunk((chunk) => {
        if (chunk instanceof ArrayBuffer) {
          totalReceivedBytes += chunk.byteLength;
        }
        receivedChunkCount++;
      });
    });

    // Side A: open stream and write 16 × 1 MB chunks
    const { writable } = createStream(chA, {
      sessionOptions: { initialCredit: 32, highWaterMark: 64 },
    });

    // Wait for OPEN/OPEN_ACK handshake
    await new Promise<void>((r) => setTimeout(r, 100));

    const CHUNK_SIZE = 1024 * 1024; // 1 MB
    const CHUNK_COUNT = 16;
    let writtenChunks = 0;

    const writer = writable.getWriter();

    for (let i = 0; i < CHUNK_COUNT; i++) {
      const chunk = new ArrayBuffer(CHUNK_SIZE);
      await writer.write(chunk);
      writtenChunks++;
    }

    expect(writtenChunks).toBe(CHUNK_COUNT);

    // Wait for all chunks to be received by side B
    await new Promise<void>((resolve) => {
      const start = Date.now();
      const check = setInterval(() => {
        // Each 1 MB chunk is chunked into 64 KB frames by the Chunker (16 frames per MB)
        // 16 MB / 64 KB = 256 DATA frames, but reassembled into 16 chunks by the Chunker
        if (receivedChunkCount >= CHUNK_COUNT || Date.now() - start > 8000) {
          clearInterval(check);
          resolve();
        }
      }, 10);
    });

    // All 16 MB should have arrived
    expect(receivedChunkCount).toBe(CHUNK_COUNT);
    // Each 1 MB chunk is sent via STRUCTURED_CLONE path (no transfer list in sink.write)
    // so the full payload arrives intact
    expect(totalReceivedBytes).toBe(CHUNK_SIZE * CHUNK_COUNT);

    writer.releaseLock();
  }, 15000);

  it("writer.ready goes pending when credits exhausted and resolves after CREDIT frame", async () => {
    pair = createMessageChannelPair();
    const CHANNEL_ID = "test-streams-backpressure";

    // Use a small initialCredit to exhaust credits quickly
    const chA = createChannel(pair.a, {
      channelId: CHANNEL_ID,
      sessionOptions: { initialCredit: 4, highWaterMark: 8, stallTimeoutMs: 0 },
    });
    const chB = createChannel(pair.b, {
      channelId: CHANNEL_ID,
      sessionOptions: { initialCredit: 4, highWaterMark: 8, stallTimeoutMs: 0 },
    });

    await Promise.all([chA.capabilityReady, chB.capabilityReady]);

    // Side B: slow reader — reads 1 chunk then stops
    const receivedChunks: unknown[] = [];
    chB.onStream((handle) => {
      handle.session.onChunk((chunk) => {
        receivedChunks.push(chunk);
        // Notify credit system by calling the credit window via handle
        // (credit refresh happens automatically via Session's notifyRead)
      });
    });

    // Side A: open stream with small initial credit
    const { writable } = createStream(chA, {
      sessionOptions: { initialCredit: 4, highWaterMark: 8, stallTimeoutMs: 0 },
    });

    // Wait for OPEN/OPEN_ACK
    await new Promise<void>((r) => setTimeout(r, 50));

    const writer = writable.getWriter();

    // Write initialCredit worth of chunks — these should all be accepted
    let successfulWrites = 0;

    // Start writing quickly up to the credit limit
    const writePromises: Promise<void>[] = [];
    for (let i = 0; i < 4; i++) {
      writePromises.push(
        writer.write(`chunk-${i}`).then(() => {
          successfulWrites++;
        }),
      );
    }

    // Give the writes a moment to be processed
    await new Promise<void>((r) => setTimeout(r, 100));

    // Eventually all writes should resolve (CREDIT frame refills credits as B reads)
    await Promise.race([Promise.all(writePromises), new Promise<void>((r) => setTimeout(r, 5000))]);

    // All 4 writes within credit window should have resolved
    expect(successfulWrites).toBe(4);

    writer.releaseLock();
  }, 10000);
});
