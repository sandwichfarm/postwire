// tests/helpers/mock-endpoint.ts
// Real MessageChannel-backed PostMessageEndpoint pair for integration tests.
// Uses Node's node:worker_threads MessageChannel which provides:
//   - Real structured-clone semantics (non-cloneable values throw DataCloneError)
//   - Real ArrayBuffer transfer (byteLength === 0 after transfer)
//   - Async message delivery (next task, NOT synchronous)
//   - No explicit .start() needed — onmessage= auto-starts the port in Node 22
//
// IMPORTANT: In browser contexts, MessagePort requires .start() when using
// addEventListener. onmessage= assignment auto-starts in both Node and browser.
// Phase 9 browser helpers must document this difference.

import { MessageChannel } from "node:worker_threads";
import type { PostMessageEndpoint } from "../../src/transport/endpoint.js";

export interface MockEndpointPair {
  a: PostMessageEndpoint;
  b: PostMessageEndpoint;
  /** Close both ports — call in afterEach to prevent test leaks. */
  close(): void;
}

/**
 * Returns a pair of PostMessageEndpoint instances backed by a real Node MessageChannel.
 * Messages from a → b and b → a flow with real structured-clone + Transferable semantics.
 *
 * Usage:
 *   const { a, b, close } = createMessageChannelPair();
 *   // pass a to one Channel, b to the other Channel
 *   afterEach(() => close());
 */
export function createMessageChannelPair(): MockEndpointPair {
  const { port1, port2 } = new MessageChannel();
  return {
    a: port1 as unknown as PostMessageEndpoint,
    b: port2 as unknown as PostMessageEndpoint,
    close() {
      port1.close();
      port2.close();
    },
  };
}
