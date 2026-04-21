import type { PostMessageEndpoint } from "../endpoint.js";

/**
 * Options for createWindowEndpoint.
 */
export interface WindowEndpointOptions {
  /**
   * Called when an inbound message is dropped due to origin mismatch (OBS-02 ORIGIN_REJECTED).
   * The caller (typically the Channel) passes a callback that emits StreamError('ORIGIN_REJECTED')
   * on the channel error emitter, routing the rejection through the typed error surface.
   *
   * The adapter itself remains unaware of Channel — it only calls the callback.
   */
  onOriginRejected?: (origin: string) => void;
}

/**
 * Wrap a cross-origin Window as a PostMessageEndpoint.
 *
 * Security invariants (ENDP-03):
 * 1. Wildcard expectedOrigin ("*") is rejected at construction time — supply-chain attack vector
 *    (MSRC August 2025 incident; see REQUIREMENTS.md COMP section, Out of Scope).
 * 2. Empty string expectedOrigin is also rejected — not a valid origin.
 * 3. Outbound postMessage uses expectedOrigin as the targetOrigin (exact match required).
 * 4. Inbound messages are filtered by event.origin === expectedOrigin; non-matching origins
 *    are silently dropped (and reported via opts.onOriginRejected if provided — OBS-02).
 * 5. Inbound uses win.addEventListener('message', ...) — NOT win.onmessage = assignment,
 *    which would clobber the caller's existing window message handler (Pitfall 7).
 *
 * Phase 1 does NOT implement removeEventListener teardown — that is LIFE-05 (Phase 4).
 * TODO Phase 4: add teardown via close() that calls win.removeEventListener('message', listener).
 */
export function createWindowEndpoint(
  win: Window,
  expectedOrigin: string,
  opts?: WindowEndpointOptions,
): PostMessageEndpoint {
  if (expectedOrigin === "*") {
    throw new Error(
      '[iframebuffer] createWindowEndpoint: wildcard expectedOrigin "*" is not allowed. ' +
        'Provide the exact expected origin (e.g., "https://example.com").',
    );
  }

  if (expectedOrigin === "") {
    throw new Error(
      "[iframebuffer] createWindowEndpoint: empty string expectedOrigin is not allowed. " +
        'Provide the exact expected origin (e.g., "https://example.com").',
    );
  }

  const endpoint: PostMessageEndpoint = {
    postMessage(message: unknown, transfer?: Transferable[]): void {
      win.postMessage(message, expectedOrigin, transfer ?? []);
    },
    onmessage: null,
  };

  // Use addEventListener (NOT win.onmessage =) to avoid clobbering the caller's handler.
  // The listener checks event.origin before routing to the endpoint's onmessage.
  const listener = (event: MessageEvent): void => {
    if (event.origin !== expectedOrigin) {
      // Phase 4 (OBS-02): surface dropped message via onOriginRejected hook.
      // The Channel registers this callback and re-emits as StreamError('ORIGIN_REJECTED').
      opts?.onOriginRejected?.(event.origin);
      return;
    }
    endpoint.onmessage?.(event);
  };

  win.addEventListener("message", listener);

  return endpoint;
}
