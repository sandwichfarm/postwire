import type { PostMessageEndpoint } from "../endpoint.js";

/**
 * Wrap a DedicatedWorker as a PostMessageEndpoint.
 *
 * Worker naturally satisfies the PostMessageEndpoint interface:
 * - Worker.postMessage(msg, transfer?) matches the contract
 * - Worker.onmessage is a writable property
 *
 * The cast is safe because Worker's actual runtime shape satisfies the interface.
 * ENDP-02: Worker adapter implementation.
 */
export function createWorkerEndpoint(worker: Worker): PostMessageEndpoint {
  return worker as unknown as PostMessageEndpoint;
}
