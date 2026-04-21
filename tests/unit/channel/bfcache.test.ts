// tests/unit/channel/bfcache.test.ts
// LIFE-01 — BFCache detection via pagehide/pageshow mocks.
// Node 22's globalThis does NOT extend EventTarget (unlike browsers where globalThis === window).
// We polyfill globalThis with a single shared EventTarget to simulate the browser environment.
// PageTransitionEvent is not available in Node — construct via Object.assign(new Event(...), { persisted }).
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createChannel } from "../../../src/channel/channel.js";

// ---------------------------------------------------------------------------
// Setup: polyfill globalThis with EventTarget so BFCache listeners can bind.
// In a real browser, globalThis === window which IS an EventTarget.
// This polyfill mirrors that for Node unit tests.
// ---------------------------------------------------------------------------
beforeAll(() => {
  if (typeof (globalThis as Record<string, unknown>).addEventListener !== "function") {
    const et = new EventTarget();
    (globalThis as Record<string, unknown>).addEventListener = et.addEventListener.bind(et);
    (globalThis as Record<string, unknown>).removeEventListener = et.removeEventListener.bind(et);
    (globalThis as Record<string, unknown>).dispatchEvent = et.dispatchEvent.bind(et);
  }
});

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

// Helper: dispatch a fake PageTransitionEvent (PageTransitionEvent not available in Node)
function dispatchPagehide(persisted: boolean): void {
  globalThis.dispatchEvent(Object.assign(new Event("pagehide"), { persisted }) as Event);
}

function dispatchPageshow(persisted: boolean): void {
  globalThis.dispatchEvent(Object.assign(new Event("pageshow"), { persisted }) as Event);
}

describe("Channel — BFCache (LIFE-01)", () => {
  const channels: ReturnType<typeof createChannel>[] = [];

  afterEach(() => {
    // Close all channels to flush disposers and remove globalThis listeners
    channels.splice(0).forEach((ch) => {
      ch.close();
    });
  });

  it("emits CHANNEL_FROZEN on pagehide(persisted=true)", () => {
    const ep = makeFakeEndpoint();
    const ch = createChannel(ep, { channelId: "bfc-1", endpointKind: "window" });
    channels.push(ch);
    const errors: unknown[] = [];
    ch.on("error", (e) => errors.push(e));

    dispatchPagehide(true);

    expect(errors).toHaveLength(1);
    expect((errors[0] as { code: string }).code).toBe("CHANNEL_FROZEN");
  });

  it("emits CHANNEL_CLOSED on pagehide(persisted=false)", () => {
    const ep = makeFakeEndpoint();
    const ch = createChannel(ep, { channelId: "bfc-2", endpointKind: "window" });
    channels.push(ch);
    const errors: unknown[] = [];
    ch.on("error", (e) => errors.push(e));

    dispatchPagehide(false);

    expect(errors).toHaveLength(1);
    expect((errors[0] as { code: string }).code).toBe("CHANNEL_CLOSED");
  });

  it("channel stays dead after pageshow(persisted=true) — no resume", () => {
    const ep = makeFakeEndpoint();
    const ch = createChannel(ep, { channelId: "bfc-3", endpointKind: "window" });
    channels.push(ch);
    const errors: unknown[] = [];
    ch.on("error", (e) => errors.push(e));

    dispatchPagehide(true); // → CHANNEL_FROZEN, channel closed
    dispatchPageshow(true); // → should be a no-op; channel already dead

    // Only one error (from pagehide), not two
    expect(errors).toHaveLength(1);
    expect((errors[0] as { code: string }).code).toBe("CHANNEL_FROZEN");
  });

  it("does not attach pagehide listener when endpointKind is not window", () => {
    const ep = makeFakeEndpoint();
    const ch = createChannel(ep, { channelId: "bfc-4" }); // no endpointKind
    channels.push(ch);
    const errors: unknown[] = [];
    ch.on("error", (e) => errors.push(e));

    dispatchPagehide(true); // should be ignored

    expect(errors).toHaveLength(0);
  });
});
