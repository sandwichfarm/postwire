// tests/helpers/mock-endpoint.ts
// Real MessageChannel-backed PostMessageEndpoint pair for integration tests.
//
// GUARANTEES (verified against Node 22.22.1 — see RESEARCH.md Pattern 5):
// 1. Structured-clone semantics: Non-cloneable values (functions, Symbols, Proxies)
//    throw DataCloneError synchronously from port.postMessage().
// 2. Transferable semantics: ArrayBuffer in transfer list is detached after postMessage —
//    source.byteLength === 0 post-send (FAST-01 contract).
// 3. Async delivery: Messages arrive asynchronously (next event loop task), NOT
//    synchronously — integration tests must await or use event-driven patterns.
// 4. onmessage auto-start: Setting port.onmessage= automatically enables reception;
//    no explicit port.start() call needed in Node 22 (unlike browser addEventListener).
//
// LIMITATIONS (Phase 9 cross-browser tests will verify browser-specific behavior):
// 1. No cross-origin isolation or COOP/COEP headers — SharedArrayBuffer tests
//    require Phase 6+ real browser with the correct response headers.
// 2. Not a real Worker or iframe — lifecycle differences (BFCache, SW recycle,
//    port transfer across document navigations) are handled in Phase 4.
// 3. No browser-specific quirks — e.g., browser MessagePort requires .start() when
//    using addEventListener (not onmessage=); this difference is invisible in Node.
// 4. Transferable ReadableStream probe returns false in Node 22 — Chrome/Firefox 120+
//    support it but Node does not; Phase 5/9 enables the capability flag.
//
// USE FOR: All Phase 3 unit + integration tests of frame-level and adapter logic.
// DO NOT USE FOR: BFCache/ServiceWorker lifecycle scenarios (Phase 4+),
//                 real cross-origin isolation (Phase 6+), browser E2E (Phase 9).

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
