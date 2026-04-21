// src/transport/sab-capability.ts
// Feature-detection probe for SharedArrayBuffer + Atomics.waitAsync support.
//
// Returns true iff ALL of the following hold:
//   1. typeof SharedArrayBuffer !== 'undefined'
//   2. typeof Atomics !== 'undefined' && typeof Atomics.waitAsync === 'function'
//   3. In browser: crossOriginIsolated !== false
//      (In Node, crossOriginIsolated is undefined — that is treated as "ok")
//   4. endpoint.capabilities.sabCapable !== false
//      (ServiceWorker adapters explicitly set this false; everything else is undefined = capable)
//
// The result is a pure, synchronous, cheap check — no side effects.

import type { PostMessageEndpoint } from "./endpoint.js";

/**
 * Probe whether the SAB fast path can be used with the given endpoint.
 *
 * endpoint is optional — when undefined, only the global environment is checked
 * (no endpoint-level sabCapable restriction applied).
 */
export function isSabCapable(endpoint?: PostMessageEndpoint): boolean {
  // 1. SharedArrayBuffer must exist
  if (typeof SharedArrayBuffer === "undefined") return false;

  // 2. Atomics.waitAsync must exist (Node 22+, Chrome 97+, Firefox 91+, Safari 16.4+)
  if (typeof Atomics === "undefined" || typeof Atomics.waitAsync !== "function") return false;

  // 3. Cross-origin isolation check (browser only).
  //    In Node, globalThis.crossOriginIsolated is undefined — skip the check.
  //    In browser: if it is explicitly false, SAB is unavailable.
  const coi = (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated;
  if (coi === false) return false;

  // 4. Endpoint-level capability flag.
  //    ServiceWorkerEndpointMeta sets sabCapable: false; all other endpoints leave it undefined.
  //    We read it via the capabilities bag on the endpoint object (set by channel negotiation)
  //    OR via a direct sabCapable property on the endpoint metadata.
  if (endpoint !== undefined) {
    // Check direct sabCapable property (set on ServiceWorkerEndpointMeta.endpoint wrapping)
    const ep = endpoint as unknown as {
      sabCapable?: boolean;
      capabilities?: { sabCapable?: boolean };
    };
    if (ep.sabCapable === false) return false;
    if (ep.capabilities?.sabCapable === false) return false;
  }

  return true;
}
