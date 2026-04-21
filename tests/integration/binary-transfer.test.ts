// tests/integration/binary-transfer.test.ts
// FAST-01: Proves ArrayBuffer is transferred (zero-copy) — source detaches after send.
// Uses real Node MessageChannel for genuine structured-clone + Transferable semantics.
// TEST-02: Integration test via MockEndpoint backed by real MessageChannel pair.

import { afterEach, describe, expect, it } from "vitest";
import { createLowLevelStream } from "../../src/adapters/lowlevel.js";
import { createChannel } from "../../src/channel/channel.js";
import type { MockEndpointPair } from "../helpers/mock-endpoint.js";
import { createMessageChannelPair } from "../helpers/mock-endpoint.js";

describe("FAST-01: ArrayBuffer zero-copy transfer", () => {
  let pair: MockEndpointPair | undefined;

  afterEach(() => {
    pair?.close();
    pair = undefined;
  });

  it("source ArrayBuffer.byteLength === 0 after transfer send", async () => {
    pair = createMessageChannelPair();
    const CHANNEL_ID = "test-fast01";

    // Create channels on both sides with the same channelId so CAPABILITY frames match
    const chA = createChannel(pair.a, { channelId: CHANNEL_ID });
    const chB = createChannel(pair.b, { channelId: CHANNEL_ID });

    // Wait for both sides to complete CAPABILITY handshake
    await Promise.all([chA.capabilityReady, chB.capabilityReady]);

    // Capture chunks on receiver side (B) — wire before opening stream on A
    const receivedChunks: unknown[] = [];
    chB.onStream((handle) => {
      handle.session.onChunk((chunk) => {
        receivedChunks.push(chunk);
      });
    });

    // Create low-level stream on sender side (A) — this sends OPEN frame to B
    const sender = createLowLevelStream(chA);

    // Wait for OPEN/OPEN_ACK handshake to complete (async message delivery)
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    // Create a 4 KB ArrayBuffer filled with 0xAB data
    const buf = new ArrayBuffer(4096);
    new Uint8Array(buf).fill(0xab);
    expect(buf.byteLength).toBe(4096); // sanity check before send

    // Send with transfer list — this is the BINARY_TRANSFER path (FAST-01)
    // After transfer, source buf is detached — byteLength becomes 0
    await sender.send(buf, [buf]);

    // FAST-01: After transfer, source ArrayBuffer must be detached (byteLength === 0)
    // Node MessageChannel from node:worker_threads DOES detach on transfer (verified live)
    expect(buf.byteLength).toBe(0);

    // Wait for receiver to get the chunk (async delivery)
    await new Promise<void>((resolve) => {
      const start = Date.now();
      const check = setInterval(() => {
        if (receivedChunks.length > 0 || Date.now() - start > 2000) {
          clearInterval(check);
          resolve();
        }
      }, 10);
    });

    // Receiver should have received the transferred ArrayBuffer
    expect(receivedChunks.length).toBeGreaterThan(0);
    // The received chunk is reconstructed on the receiver's side via structured clone
    expect(receivedChunks[0]).toBeInstanceOf(ArrayBuffer);
    // Receiver's copy must have the full original size (4096 bytes)
    expect((receivedChunks[0] as ArrayBuffer).byteLength).toBe(4096);
  }, 5000);

  it("send without transfer list uses STRUCTURED_CLONE path — buffer not detached", async () => {
    pair = createMessageChannelPair();
    const CHANNEL_ID = "test-fast01-clone";

    const chA = createChannel(pair.a, { channelId: CHANNEL_ID });
    const chB = createChannel(pair.b, { channelId: CHANNEL_ID });
    await Promise.all([chA.capabilityReady, chB.capabilityReady]);

    // Wire receiver before opening stream
    const receivedChunks: unknown[] = [];
    chB.onStream((handle) => {
      handle.session.onChunk((chunk) => {
        receivedChunks.push(chunk);
      });
    });

    const sender = createLowLevelStream(chA);

    // Wait for OPEN/OPEN_ACK handshake
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    const buf = new ArrayBuffer(1024);
    new Uint8Array(buf).fill(0xcd);
    const originalLength = buf.byteLength;

    // Send WITHOUT transfer list — structured clone path, no ownership transfer
    await sender.send(buf);

    // Source buffer must NOT be detached (no transfer occurred)
    expect(buf.byteLength).toBe(originalLength);

    // Receiver also gets a copy
    await new Promise<void>((resolve) => {
      const start = Date.now();
      const check = setInterval(() => {
        if (receivedChunks.length > 0 || Date.now() - start > 2000) {
          clearInterval(check);
          resolve();
        }
      }, 10);
    });

    expect(receivedChunks.length).toBeGreaterThan(0);
    expect(receivedChunks[0]).toBeInstanceOf(ArrayBuffer);
    expect((receivedChunks[0] as ArrayBuffer).byteLength).toBe(1024);
  }, 5000);

  it("multiple chunks can be sent and received in order", async () => {
    pair = createMessageChannelPair();
    const CHANNEL_ID = "test-fast01-multi";

    const chA = createChannel(pair.a, { channelId: CHANNEL_ID });
    const chB = createChannel(pair.b, { channelId: CHANNEL_ID });
    await Promise.all([chA.capabilityReady, chB.capabilityReady]);

    const receivedChunks: unknown[] = [];
    chB.onStream((handle) => {
      handle.session.onChunk((chunk) => {
        receivedChunks.push(chunk);
      });
    });

    const sender = createLowLevelStream(chA);

    // Wait for OPEN/OPEN_ACK
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    // Send 3 string chunks (STRUCTURED_CLONE path)
    await sender.send("chunk-1");
    await sender.send("chunk-2");
    await sender.send("chunk-3");

    // Wait for all 3 chunks to arrive
    await new Promise<void>((resolve) => {
      const start = Date.now();
      const check = setInterval(() => {
        if (receivedChunks.length >= 3 || Date.now() - start > 2000) {
          clearInterval(check);
          resolve();
        }
      }, 10);
    });

    expect(receivedChunks.length).toBe(3);
    expect(receivedChunks[0]).toBe("chunk-1");
    expect(receivedChunks[1]).toBe("chunk-2");
    expect(receivedChunks[2]).toBe("chunk-3");
  }, 5000);
});
