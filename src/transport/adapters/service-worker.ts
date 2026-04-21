import type { PostMessageEndpoint } from "../endpoint.js";

/**
 * Metadata for ServiceWorker endpoints.
 *
 * sabCapable is always false for ServiceWorker endpoints because:
 * - ServiceWorker runs in a different agent cluster from the main thread
 * - SharedArrayBuffer cannot be transferred across agent cluster boundaries —
 *   attempting to do so results in a DataCloneError
 * - The capability negotiation layer (Phase 2) uses this metadata to select the
 *   transferable path instead of the SAB fast path
 *
 * See PITFALLS.md P14 — "SAB across agent cluster boundary throws DataCloneError".
 * Implements ENDP-04 and the ServiceWorker branch of FAST-05.
 *
 * FAST-05 note: Feature detection is one-time-at-channel-open. The sabCapable flag
 * is set permanently at construction time and never re-evaluated per-chunk.
 */
export interface ServiceWorkerEndpointMeta {
  endpoint: PostMessageEndpoint;
  /** Always false — SAB requires same agent cluster. See PITFALLS.md P14. */
  sabCapable: false;
}

/**
 * Wrap a ServiceWorker as a PostMessageEndpoint with sabCapable: false metadata.
 *
 * Returns a ServiceWorkerEndpointMeta rather than a bare PostMessageEndpoint so that
 * the capability negotiation layer can inspect sabCapable without needing a type guard.
 *
 * ENDP-02, ENDP-04: ServiceWorker adapter implementation.
 */
export function createServiceWorkerEndpoint(sw: ServiceWorker): ServiceWorkerEndpointMeta {
  return {
    endpoint: sw as unknown as PostMessageEndpoint,
    sabCapable: false,
  };
}
