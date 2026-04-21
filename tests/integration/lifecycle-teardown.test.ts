// tests/integration/lifecycle-teardown.test.ts
// LIFE-03, LIFE-05 — port close detection and listener cleanup.
// Uses real Node MessageChannel (worker_threads) for structured-clone semantics.
//
// NOTE: The Node MessagePort 'close' event fires asynchronously when the partner closes
// (empirically tested in Node 22 — within one event loop tick, per RESEARCH.md Pattern 5).
// Browser MessagePort may NOT fire a 'close' event (it's a Blink-only proposal, proposal stage).
// Browser teardown coverage relies on the heartbeat timeout (LIFE-02).
//
// Tests:
//   LIFE-03: Remote port close → CHANNEL_CLOSED emitted on channel
//   LIFE-03: No zombie session remains after teardown (#session === null)
//   LIFE-05: endpoint.onmessage set to null after channel.close()

import type { MessagePort } from "node:worker_threads";
import { MessageChannel } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { createChannel } from "../../src/channel/channel.js";
import type { PostMessageEndpoint } from "../../src/transport/endpoint.js";

describe("Channel — endpoint teardown (LIFE-03)", () => {
  const portsToClean: MessagePort[] = [];

  afterEach(() => {
    // Close any leftover ports to prevent test pollution
    const ports = portsToClean.splice(0);
    for (const p of ports) {
      try {
        p.close();
      } catch {
        // already closed — ignore
      }
    }
  });

  it("emits CHANNEL_CLOSED on all active streams when remote port closes", async () => {
    const { port1, port2 } = new MessageChannel();
    portsToClean.push(port1, port2);

    const chA = createChannel(port1 as unknown as PostMessageEndpoint, {
      channelId: "teardown-1",
    });

    const errors: unknown[] = [];
    chA.on("error", (e) => errors.push(e));

    // Close port2 — simulates remote endpoint dying
    port2.close();

    // Node fires 'close' async (within one event loop tick)
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    expect(errors).toHaveLength(1);
    expect((errors[0] as { code: string }).code).toBe("CHANNEL_CLOSED");
  });

  it("no zombie session remains after port close — session is null", async () => {
    const { port1, port2 } = new MessageChannel();
    portsToClean.push(port1, port2);

    const chA = createChannel(port1 as unknown as PostMessageEndpoint, {
      channelId: "teardown-2",
    });

    // Open a stream to populate #session
    chA.openStream();
    expect(chA.hasActiveSession).toBe(true);

    port2.close();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    // After teardown, no active session remains
    expect(chA.hasActiveSession).toBe(false);
  });

  it("listeners are removed from endpoint after channel.close() (LIFE-05)", () => {
    const { port1, port2 } = new MessageChannel();
    portsToClean.push(port1, port2);

    const ep = port1 as unknown as PostMessageEndpoint;
    const ch = createChannel(ep, { channelId: "teardown-3" });

    // onmessage was set by Channel constructor
    expect(ep.onmessage).not.toBeNull();

    // Explicitly close the channel — disposers flush should set onmessage to null
    ch.close();

    expect(ep.onmessage).toBeNull();
  });
});
