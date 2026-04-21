// tests/unit/channel/bfcache.test.ts
// LIFE-01 — BFCache detection via pagehide/pageshow mocks.
// Uses Node 22 globalThis as EventTarget (confirmed in RESEARCH.md).
// PageTransitionEvent is not available in Node — construct via Object.assign(new Event(...), { persisted }).
// Wave 1 executor: implement the it.todo stubs using the BFCache pattern in RESEARCH.md Pattern 3.
import { afterEach, describe, it } from "vitest";
import { createChannel } from "../../../src/channel/channel.js";

// Minimal fake endpoint — no actual postMessage delivery needed for BFCache tests.
function makeFakeEndpoint() {
  const sent: unknown[] = [];
  const ep = {
    sent,
    postMessage(msg: unknown) {
      sent.push(msg);
    },
    onmessage: null as ((e: MessageEvent) => void) | null,
    simulateMessage(data: unknown) {
      ep.onmessage?.({ data } as MessageEvent);
    },
  };
  return ep;
}

describe("Channel — BFCache (LIFE-01)", () => {
  afterEach(() => {
    // Clean up: channels created in tests should be closed to remove globalThis listeners.
    // Wave 1 executor: track created channels and close them here, or close inline.
  });

  it.todo("emits CHANNEL_FROZEN on pagehide(persisted=true)");
  it.todo("emits CHANNEL_CLOSED on pagehide(persisted=false)");
  it.todo("channel stays dead after pageshow(persisted=true) — no resume");
  it.todo("does not attach pagehide listener when endpointKind is not window");
});

export { makeFakeEndpoint };
