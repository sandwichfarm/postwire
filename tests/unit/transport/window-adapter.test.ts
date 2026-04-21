import { describe, expect, it } from "vitest";
import { createWindowEndpoint } from "../../../src/transport/adapters/window.js";

function makeFakeWindow() {
  const listeners: Array<(e: MessageEvent) => void> = [];
  const sentMessages: Array<{ msg: unknown; origin: string; transfer: Transferable[] }> = [];
  const win = {
    postMessage(msg: unknown, origin: string, transfer?: Transferable[]) {
      sentMessages.push({ msg, origin, transfer: transfer ?? [] });
    },
    addEventListener(_type: string, handler: (e: MessageEvent) => void) {
      listeners.push(handler);
    },
    removeEventListener(_type: string, _h: (e: MessageEvent) => void) {},
    dispatchMessage(origin: string, data: unknown) {
      const e = { origin, data, source: win } as unknown as MessageEvent;
      for (const l of listeners) l(e);
    },
    sentMessages,
    listeners,
  };
  return win;
}

describe("createWindowEndpoint", () => {
  it("throws for wildcard expectedOrigin", () => {
    const fakeWin = makeFakeWindow();
    expect(() => createWindowEndpoint(fakeWin as unknown as Window, "*")).toThrow("wildcard");
  });

  it("throws for empty string expectedOrigin", () => {
    const fakeWin = makeFakeWindow();
    expect(() => createWindowEndpoint(fakeWin as unknown as Window, "")).toThrow();
  });

  it("does not throw for a valid origin", () => {
    const fakeWin = makeFakeWindow();
    expect(() =>
      createWindowEndpoint(fakeWin as unknown as Window, "https://example.com"),
    ).not.toThrow();
  });

  it("delegates postMessage with the expectedOrigin as targetOrigin", () => {
    const fakeWin = makeFakeWindow();
    const endpoint = createWindowEndpoint(
      fakeWin as unknown as Window,
      "https://example.com",
    );
    const data = { hello: "world" };
    endpoint.postMessage(data, []);
    expect(fakeWin.sentMessages).toHaveLength(1);
    expect(fakeWin.sentMessages[0].origin).toBe("https://example.com");
    expect(fakeWin.sentMessages[0].msg).toBe(data);
  });

  it("forwards messages from the correct origin to onmessage", () => {
    const fakeWin = makeFakeWindow();
    const endpoint = createWindowEndpoint(
      fakeWin as unknown as Window,
      "https://example.com",
    );
    const received: MessageEvent[] = [];
    endpoint.onmessage = (e) => received.push(e);
    fakeWin.dispatchMessage("https://example.com", { ping: true });
    expect(received).toHaveLength(1);
    expect((received[0].data as { ping: boolean }).ping).toBe(true);
  });

  it("silently drops messages from a different origin", () => {
    const fakeWin = makeFakeWindow();
    const endpoint = createWindowEndpoint(
      fakeWin as unknown as Window,
      "https://example.com",
    );
    const received: MessageEvent[] = [];
    endpoint.onmessage = (e) => received.push(e);
    fakeWin.dispatchMessage("https://attacker.example", { evil: true });
    expect(received).toHaveLength(0);
  });

  it("does not call onmessage when it is null", () => {
    const fakeWin = makeFakeWindow();
    const endpoint = createWindowEndpoint(
      fakeWin as unknown as Window,
      "https://example.com",
    );
    // endpoint.onmessage is null by default — should not throw
    expect(() =>
      fakeWin.dispatchMessage("https://example.com", { data: true }),
    ).not.toThrow();
  });
});
