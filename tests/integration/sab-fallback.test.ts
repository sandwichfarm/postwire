// tests/integration/sab-fallback.test.ts
// Tests that SAB falls back to postMessage transparently when one side opts out.
//
// Fallback scenarios:
//   1. One side { sab: true }, other side { sab: false } → both sabActive=false, postMessage works
//   2. Force sab=false on one side via test-only endpoint property → same result

import type { MessagePort } from "node:worker_threads";
import { MessageChannel } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { createChannel } from "../../src/channel/channel.js";
import type { PostMessageEndpoint } from "../../src/transport/endpoint.js";

function asEndpoint(port: MessagePort): PostMessageEndpoint {
  return port as unknown as PostMessageEndpoint;
}

function tick(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("sab-fallback: transparent fallback", () => {
  const ports: MessagePort[] = [];

  afterEach(() => {
    for (const p of ports) {
      try {
        p.close();
      } catch {}
    }
    ports.length = 0;
  });

  it("one side sab=false → both end up with sabActive=false", async () => {
    const { port1, port2 } = new MessageChannel();
    ports.push(port1, port2);

    const chA = createChannel(asEndpoint(port1), { sab: true });
    const chB = createChannel(asEndpoint(port2), { sab: false }); // opt-out

    await Promise.all([chA.capabilityReady, chB.capabilityReady]);
    await tick(100);

    expect(chA.stats().sabActive).toBe(false);
    expect(chB.stats().sabActive).toBe(false);
  });

  it("both sides sab=false → sabActive=false", async () => {
    const { port1, port2 } = new MessageChannel();
    ports.push(port1, port2);

    const chA = createChannel(asEndpoint(port1), { sab: false });
    const chB = createChannel(asEndpoint(port2), { sab: false });

    await Promise.all([chA.capabilityReady, chB.capabilityReady]);
    await tick(50);

    expect(chA.stats().sabActive).toBe(false);
    expect(chB.stats().sabActive).toBe(false);
  });

  it("one side sab=true, other sab=false: 64 KB stream succeeds via postMessage path", async () => {
    const { port1, port2 } = new MessageChannel();
    ports.push(port1, port2);

    const chA = createChannel(asEndpoint(port1), { sab: true });
    const chB = createChannel(asEndpoint(port2), { sab: false });

    await Promise.all([chA.capabilityReady, chB.capabilityReady]);
    await tick(50);

    const BYTES = 64 * 1024;
    let resolve!: () => void;
    const done = new Promise<void>((res) => {
      resolve = res;
    });

    let received = 0;
    chB.onStream((handle) => {
      handle.session.onChunk((chunk) => {
        if (chunk instanceof ArrayBuffer) {
          received += chunk.byteLength;
          if (received >= BYTES) resolve();
        }
      });
    });

    const buf = new ArrayBuffer(BYTES);
    const handle = chA.openStream();
    handle.session.sendData(buf, "BINARY_TRANSFER");

    await Promise.race([
      done,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("fallback transfer timed out")), 5000),
      ),
    ]);

    expect(received).toBe(BYTES);

    // Verify DATA frames went via postMessage (sabActive=false)
    const statsA = chA.stats();
    const statsB = chB.stats();
    expect(statsA.sabActive).toBe(false);
    expect(statsB.sabActive).toBe(false);

    // Verify DATA frames were counted (postMessage path active)
    // frameCountsByType.DATA should be > 0 on the receiving side
    const dataFrameCount = statsB.streams[0]?.frameCountsByType?.DATA ?? 0;
    expect(dataFrameCount).toBeGreaterThan(0);
  });

  it("endpoint with sabCapable=false forces fallback even if caller opts in sab=true", async () => {
    const { port1, port2 } = new MessageChannel();
    ports.push(port1, port2);

    // Simulate a ServiceWorker-like endpoint with sabCapable=false
    const ep1 = asEndpoint(port1);
    // Attach the sabCapable=false flag — isSabCapable() checks this
    (ep1 as unknown as { sabCapable: boolean }).sabCapable = false;

    const chA = createChannel(ep1, { sab: true }); // caller opts in but probe returns false
    const chB = createChannel(asEndpoint(port2), { sab: true });

    await Promise.all([chA.capabilityReady, chB.capabilityReady]);
    await tick(100);

    // chA's local probe returns false because sabCapable=false on endpoint
    // so merged capability is false → both sides fall back
    expect(chA.stats().sabActive).toBe(false);
    expect(chB.stats().sabActive).toBe(false);
  });
});
