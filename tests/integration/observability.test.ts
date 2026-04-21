// tests/integration/observability.test.ts
// OBS-01 — stats() snapshot; OBS-02 — typed error events routing.
// OBS-01 tests use a real Node MessageChannel for full structured-clone semantics.
// OBS-02 CREDIT_DEADLOCK test uses a fake endpoint (no counterpart) to prevent CREDIT
// frames from arriving and clearing the stall timer before it fires.
//
// Node 22: MessagePort fires 'close' when the partner port closes.
// Browser: MessagePort 'close' is a Blink proposal (not cross-browser) — teardown tested via
//          heartbeat in unit tests. These integration tests cover the Node path only.
import { MessageChannel } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChannel } from "../../src/channel/channel.js";
import { FRAME_MARKER } from "../../src/framing/types.js";
import type { PostMessageEndpoint } from "../../src/transport/endpoint.js";

// Minimal fake endpoint for OBS-02 tests (no real counterpart so no CREDIT frames arrive)
function makeFakeEndpoint(): PostMessageEndpoint & {
  sent: unknown[];
  simulateMessage(data: unknown): void;
} {
  const sent: unknown[] = [];
  const ep: PostMessageEndpoint & { sent: unknown[]; simulateMessage(d: unknown): void } = {
    sent,
    postMessage(msg: unknown) {
      sent.push(msg);
    },
    onmessage: null,
    simulateMessage(data: unknown) {
      ep.onmessage?.({ data } as MessageEvent);
    },
  };
  return ep;
}

function makePair(channelId: string) {
  const { port1, port2 } = new MessageChannel();
  const chA = createChannel(port1 as unknown as PostMessageEndpoint, { channelId });
  const chB = createChannel(port2 as unknown as PostMessageEndpoint, { channelId });
  return { chA, chB, port1, port2 };
}

describe("Channel — stats() (OBS-01)", () => {
  it("frameCountsByType includes OPEN after opening a stream", async () => {
    const { chA, port1, port2 } = makePair("stats-1");

    await chA.capabilityReady;
    chA.openStream();

    // Let frames propagate
    await new Promise<void>((r) => setTimeout(r, 30));

    const stats = chA.stats();
    expect(stats.streams).toHaveLength(1);
    // OPEN frame was sent outbound
    expect(stats.streams[0]?.frameCountsByType.OPEN).toBeGreaterThanOrEqual(1);

    port1.close();
    port2.close();
  });

  it("stats() aggregate bytesSent increases after sending binary data", async () => {
    const { chA, chB, port1, port2 } = makePair("stats-2");

    await Promise.all([chA.capabilityReady, chB.capabilityReady]);

    const handle = chA.openStream();
    // Wait for OPEN_ACK so send credit is available
    await new Promise<void>((r) => setTimeout(r, 30));

    const before = chA.stats().aggregate.bytesSent;
    const buf = new ArrayBuffer(1024);
    handle.session.sendData(buf, "BINARY_TRANSFER");

    await new Promise<void>((r) => setTimeout(r, 20));

    const after = chA.stats().aggregate.bytesSent;
    expect(after).toBeGreaterThan(before);
    expect(after - before).toBe(1024);

    port1.close();
    port2.close();
  });

  it("stats() reorderBufferDepth is 0 after all in-order frames delivered", async () => {
    const { chA, chB, port1, port2 } = makePair("stats-3");

    await Promise.all([chA.capabilityReady, chB.capabilityReady]);

    chA.openStream();
    await new Promise<void>((r) => setTimeout(r, 40));

    // All frames delivered in order — buffer should be empty
    const stats = chA.stats();
    if (stats.streams.length > 0) {
      expect(stats.streams[0]?.reorderBufferDepth).toBe(0);
    }

    port1.close();
    port2.close();
  });

  it("stats() creditWindowAvailable is a non-negative number", async () => {
    const { chA, chB, port1, port2 } = makePair("stats-4");
    await Promise.all([chA.capabilityReady, chB.capabilityReady]);

    chA.openStream();
    await new Promise<void>((r) => setTimeout(r, 30));

    const stats = chA.stats();
    if (stats.streams.length > 0) {
      expect(stats.streams[0]?.creditWindowAvailable).toBeGreaterThanOrEqual(0);
    }

    port1.close();
    port2.close();
  });
});

describe("Channel — error event routing (OBS-02)", () => {
  afterEach(() => vi.useRealTimers());

  it("CREDIT_DEADLOCK surfaces as typed error event on channel", () => {
    vi.useFakeTimers();
    // Use a fake endpoint so no CREDIT frames arrive from a real counterpart —
    // this lets the stall timer fire deterministically with fake timers.
    const ep = makeFakeEndpoint();
    const ch = createChannel(ep, {
      channelId: "obs-stall",
      sessionOptions: { initialCredit: 0, stallTimeoutMs: 1000 },
    });

    const errors: string[] = [];
    ch.on("error", (e) => errors.push(e.code));

    // Simulate an inbound OPEN with 0 initCredit to create a responder session
    // with 0 send credit — stall timer arms immediately in the responder's CreditWindow
    ep.simulateMessage({
      [FRAME_MARKER]: 1,
      channelId: "obs-stall",
      streamId: 1,
      seqNum: 0,
      type: "OPEN",
      initCredit: 0,
    });

    // Advance fake clock past stallTimeoutMs
    vi.advanceTimersByTime(1001);

    expect(errors).toContain("CREDIT_DEADLOCK");
  });
});
