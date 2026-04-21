import type { PostMessageEndpoint } from "../endpoint.js";

/**
 * Wrap a MessagePort as a PostMessageEndpoint.
 *
 * IMPORTANT: MessagePort.onmessage= assignment implicitly calls port.start(),
 * which begins dispatching queued messages. The caller MUST NOT call port.start()
 * separately after passing the port to the library — doing so is a no-op but
 * indicates a misunderstanding of the ownership contract.
 *
 * CONTRACT: The caller must not also add addEventListener('message', ...) to the
 * same port after passing it to the library — the library owns the onmessage slot.
 *
 * ENDP-02: MessagePort adapter implementation.
 * FAST-05: Feature detection runs once at channel open (CAPABILITY frame), not per-chunk.
 */
export function createMessagePortEndpoint(port: MessagePort): PostMessageEndpoint {
  return port as unknown as PostMessageEndpoint;
}
