// tests/integration/sab-channel.test.ts
// End-to-end test for the SAB fast path.
//
// Architecture:
//   Two Channel instances connected via a Node MessageChannel pair (same process).
//   Both opt in with { sab: true }.
//   After CAPABILITY handshake completes and SAB_INIT handshake is done, DATA frames
//   should route via the SharedArrayBuffer ring instead of postMessage.
//
//   "Same process" in Node = same agent cluster = SAB is shareable.
//   This matches the browser case of same-origin pages with COOP/COEP headers.

import type { MessagePort } from "node:worker_threads";
import { MessageChannel } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { createChannel } from "../../src/channel/channel.js";
import type { PostMessageEndpoint } from "../../src/transport/endpoint.js";

function asEndpoint(port: MessagePort): PostMessageEndpoint {
  return port as unknown as PostMessageEndpoint;
}

// Short pause to let the event loop process messages
function tick(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("sab-channel: integration", () => {
  const ports: MessagePort[] = [];

  afterEach(() => {
    for (const p of ports) {
      try {
        p.close();
      } catch {}
    }
    ports.length = 0;
  });

  it("both sides report sabActive=true after handshake", async () => {
    const { port1, port2 } = new MessageChannel();
    ports.push(port1, port2);

    const chA = createChannel(asEndpoint(port1), { sab: true });
    const chB = createChannel(asEndpoint(port2), { sab: true });

    // Wait for CAPABILITY handshake
    await Promise.all([chA.capabilityReady, chB.capabilityReady]);

    // Allow SAB_INIT round-trip to complete (a few event loop ticks)
    await tick(100);

    // Both sides should have sabActive = true
    expect(chA.stats().sabActive).toBe(true);
    expect(chB.stats().sabActive).toBe(true);
  });

  it("transfers 10 MB binary payload intact via SAB path", async () => {
    const { port1, port2 } = new MessageChannel();
    ports.push(port1, port2);

    const chA = createChannel(asEndpoint(port1), { sab: true, sabBufferSize: 4 * 1024 * 1024 });
    const chB = createChannel(asEndpoint(port2), { sab: true, sabBufferSize: 4 * 1024 * 1024 });

    await Promise.all([chA.capabilityReady, chB.capabilityReady]);
    await tick(100); // wait for SAB_INIT handshake

    // Verify SAB is active before sending
    expect(chA.stats().sabActive || chB.stats().sabActive).toBe(true);

    // Set up receiver
    const TEN_MB = 10 * 1024 * 1024;
    let resolve!: (buf: ArrayBuffer) => void;
    const receivedData = new Promise<ArrayBuffer>((res) => {
      resolve = res;
    });

    let bytesReceived = 0;
    const chunks: Uint8Array[] = [];

    chB.onStream((handle) => {
      handle.session.onChunk((chunk) => {
        if (chunk instanceof ArrayBuffer) {
          chunks.push(new Uint8Array(chunk));
          bytesReceived += chunk.byteLength;
          if (bytesReceived >= TEN_MB) {
            // Reassemble and resolve
            const full = new Uint8Array(bytesReceived);
            let offset = 0;
            for (const c of chunks) {
              full.set(c, offset);
              offset += c.byteLength;
            }
            resolve(full.buffer as ArrayBuffer);
          }
        }
      });
    });

    // Create 10 MB payload with known pattern
    const payload = new ArrayBuffer(TEN_MB);
    const view = new Uint8Array(payload);
    for (let i = 0; i < TEN_MB; i++) {
      view[i] = i & 0xff;
    }

    // Send — channel that has the SAB producer sends via SAB
    const handle = chA.openStream();
    handle.session.sendData(payload, "BINARY_TRANSFER");

    const received = await Promise.race([
      receivedData,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("10 MB transfer timed out")), 15000),
      ),
    ]);

    expect(received.byteLength).toBe(TEN_MB);

    // Verify first and last bytes match the pattern
    const receivedView = new Uint8Array(received);
    expect(receivedView[0]).toBe(0);
    expect(receivedView[255]).toBe(255);
    expect(receivedView[TEN_MB - 1]).toBe((TEN_MB - 1) & 0xff);
  });
});
