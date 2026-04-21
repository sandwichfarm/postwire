// src/transport/sab-capability.test.ts
// Unit tests for the SAB capability probe.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isSabCapable } from "../../../src/transport/sab-capability.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// We cast globalThis to access properties that may not be in the TS types
type GlobalWithCoi = typeof globalThis & {
  crossOriginIsolated?: boolean;
  SharedArrayBuffer?: unknown;
};

describe("isSabCapable", () => {
  // ---------------------------------------------------------------------------
  // Default Node environment — should return true
  // ---------------------------------------------------------------------------

  it("returns true in Node environment (SAB + Atomics.waitAsync present, no COI restriction)", () => {
    // Node 22 has SharedArrayBuffer and Atomics.waitAsync, and crossOriginIsolated is undefined
    expect(isSabCapable()).toBe(true);
  });

  it("returns true with no endpoint argument", () => {
    expect(isSabCapable(undefined)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // crossOriginIsolated = false
  // ---------------------------------------------------------------------------

  describe("when crossOriginIsolated is false", () => {
    let originalCoi: boolean | undefined;

    beforeEach(() => {
      originalCoi = (globalThis as GlobalWithCoi).crossOriginIsolated;
      Object.defineProperty(globalThis, "crossOriginIsolated", {
        value: false,
        configurable: true,
        writable: true,
      });
    });

    afterEach(() => {
      if (originalCoi === undefined) {
        delete (globalThis as GlobalWithCoi).crossOriginIsolated;
      } else {
        Object.defineProperty(globalThis, "crossOriginIsolated", {
          value: originalCoi,
          configurable: true,
          writable: true,
        });
      }
    });

    it("returns false when crossOriginIsolated is explicitly false", () => {
      expect(isSabCapable()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Endpoint with sabCapable: false
  // ---------------------------------------------------------------------------

  describe("endpoint capabilities", () => {
    it("returns false when endpoint.capabilities.sabCapable is false", () => {
      const ep = {
        postMessage: () => {},
        onmessage: null,
        capabilities: { sabCapable: false as const },
      };
      expect(isSabCapable(ep)).toBe(false);
    });

    it("returns false when endpoint.sabCapable is false (direct property)", () => {
      const ep = {
        postMessage: () => {},
        onmessage: null,
        sabCapable: false as const,
      };
      // Cast through unknown to test the internal runtime check
      expect(isSabCapable(ep as unknown as Parameters<typeof isSabCapable>[0])).toBe(false);
    });

    it("returns true when endpoint has no capability restriction", () => {
      const ep = {
        postMessage: () => {},
        onmessage: null,
      };
      expect(isSabCapable(ep)).toBe(true);
    });

    it("returns true when endpoint.capabilities.sabCapable is true", () => {
      const ep = {
        postMessage: () => {},
        onmessage: null,
        capabilities: { sabCapable: true },
      };
      expect(isSabCapable(ep)).toBe(true);
    });

    it("returns true when endpoint.capabilities is undefined", () => {
      const ep = {
        postMessage: () => {},
        onmessage: null,
        capabilities: undefined,
      };
      expect(isSabCapable(ep)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // SharedArrayBuffer unavailable
  // ---------------------------------------------------------------------------

  describe("when SharedArrayBuffer is unavailable", () => {
    let originalSAB: unknown;
    let originalDescriptor: PropertyDescriptor | undefined;

    beforeEach(() => {
      originalSAB = (globalThis as GlobalWithCoi).SharedArrayBuffer;
      originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "SharedArrayBuffer");
      Object.defineProperty(globalThis, "SharedArrayBuffer", {
        value: undefined,
        configurable: true,
        writable: true,
      });
    });

    afterEach(() => {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, "SharedArrayBuffer", originalDescriptor);
      } else {
        Object.defineProperty(globalThis, "SharedArrayBuffer", {
          value: originalSAB,
          configurable: true,
          writable: true,
        });
      }
    });

    it("returns false when SharedArrayBuffer is undefined", () => {
      expect(isSabCapable()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Atomics.waitAsync unavailable
  // ---------------------------------------------------------------------------

  describe("when Atomics.waitAsync is unavailable", () => {
    let originalWaitAsync: typeof Atomics.waitAsync | undefined;

    beforeEach(() => {
      originalWaitAsync = Atomics.waitAsync;
      (Atomics as Record<string, unknown>).waitAsync = undefined;
    });

    afterEach(() => {
      (Atomics as Record<string, unknown>).waitAsync = originalWaitAsync;
    });

    it("returns false when Atomics.waitAsync is not a function", () => {
      expect(isSabCapable()).toBe(false);
    });
  });
});
