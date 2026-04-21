/**
 * Tests for Worker, MessagePort, and ServiceWorker adapters.
 *
 * Worker and MessagePort tests use Node's real MessageChannel pair to verify
 * that the adapters correctly satisfy the PostMessageEndpoint interface at runtime.
 *
 * ServiceWorker adapter tests verify the sabCapable: false metadata flag.
 */
import { MessageChannel } from "node:worker_threads";
import { describe, expect, it, vi } from "vitest";
import { createMessagePortEndpoint } from "../../../src/transport/adapters/message-port.js";
import { createServiceWorkerEndpoint } from "../../../src/transport/adapters/service-worker.js";
import { createWorkerEndpoint } from "../../../src/transport/adapters/worker.js";
import type { PostMessageEndpoint } from "../../../src/transport/endpoint.js";

describe("createWorkerEndpoint", () => {
  it("returns an object satisfying PostMessageEndpoint interface shape", () => {
    // Use a minimal fake worker that has the required interface shape
    const fakeWorker = {
      postMessage: vi.fn(),
      onmessage: null as ((e: MessageEvent) => void) | null,
    };
    const endpoint: PostMessageEndpoint = createWorkerEndpoint(fakeWorker as unknown as Worker);
    expect(typeof endpoint.postMessage).toBe("function");
    expect(endpoint.onmessage).toBeNull();
  });

  it("delegates postMessage calls to the underlying Worker", () => {
    const fakeWorker = {
      postMessage: vi.fn(),
      onmessage: null as ((e: MessageEvent) => void) | null,
    };
    const endpoint = createWorkerEndpoint(fakeWorker as unknown as Worker);
    const data = { type: "test" };
    endpoint.postMessage(data, []);
    expect(fakeWorker.postMessage).toHaveBeenCalledWith(data, []);
  });

  it("allows setting onmessage handler", () => {
    const fakeWorker = {
      postMessage: vi.fn(),
      onmessage: null as ((e: MessageEvent) => void) | null,
    };
    const endpoint = createWorkerEndpoint(fakeWorker as unknown as Worker);
    const handler = vi.fn();
    endpoint.onmessage = handler;
    expect(endpoint.onmessage).toBe(handler);
  });
});

describe("createMessagePortEndpoint", () => {
  it("returns an object satisfying PostMessageEndpoint interface shape", () => {
    // Use Node's real MessageChannel for MessagePort
    const { port1 } = new MessageChannel();
    const endpoint: PostMessageEndpoint = createMessagePortEndpoint(
      port1 as unknown as MessagePort,
    );
    expect(typeof endpoint.postMessage).toBe("function");
    // port1.onmessage starts null
    expect(endpoint.onmessage).toBeNull();
    port1.close();
  });

  it("sends and receives messages over a real MessageChannel pair", () =>
    new Promise<void>((resolve) => {
      const { port1, port2 } = new MessageChannel();
      const sender = createMessagePortEndpoint(port1 as unknown as MessagePort);
      const receiver = createMessagePortEndpoint(port2 as unknown as MessagePort);

      const received: unknown[] = [];
      // Assigning onmessage implicitly calls port.start() — no manual start() needed
      receiver.onmessage = (e) => {
        received.push((e as MessageEvent).data);
        if (received.length === 1) {
          expect(received[0]).toEqual({ hello: "port" });
          port1.close();
          port2.close();
          resolve();
        }
      };

      sender.postMessage({ hello: "port" });
    }));
});

describe("createServiceWorkerEndpoint", () => {
  it("returns an object with sabCapable: false", () => {
    const fakeSW = {
      postMessage: vi.fn(),
      onmessage: null as ((e: MessageEvent) => void) | null,
    };
    const result = createServiceWorkerEndpoint(fakeSW as unknown as ServiceWorker);
    // sabCapable must be the literal false, not just falsy
    expect(result.sabCapable).toBe(false);
  });

  it("returns a result whose sabCapable is typed as literal false (never true)", () => {
    const fakeSW = {
      postMessage: vi.fn(),
      onmessage: null as ((e: MessageEvent) => void) | null,
    };
    const result = createServiceWorkerEndpoint(fakeSW as unknown as ServiceWorker);
    // TypeScript-level test: this assignment would be a compile error if sabCapable were boolean
    const check: false = result.sabCapable;
    expect(check).toBe(false);
  });

  it("exposes the endpoint with postMessage and onmessage", () => {
    const fakeSW = {
      postMessage: vi.fn(),
      onmessage: null as ((e: MessageEvent) => void) | null,
    };
    const result = createServiceWorkerEndpoint(fakeSW as unknown as ServiceWorker);
    expect(typeof result.endpoint.postMessage).toBe("function");
    expect(result.endpoint.onmessage).toBeNull();
  });

  it("delegates postMessage calls to the ServiceWorker", () => {
    const fakeSW = {
      postMessage: vi.fn(),
      onmessage: null as ((e: MessageEvent) => void) | null,
    };
    const result = createServiceWorkerEndpoint(fakeSW as unknown as ServiceWorker);
    const data = { type: "CAPABILITY" };
    result.endpoint.postMessage(data, []);
    expect(fakeSW.postMessage).toHaveBeenCalledWith(data, []);
  });
});
