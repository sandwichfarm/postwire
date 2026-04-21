/**
 * Minimal contract for any postMessage-capable endpoint.
 * All four browser endpoint shapes (Worker, MessagePort, Window, ServiceWorker/Client)
 * satisfy this interface.
 *
 * CONTRACT: The PostMessageEndpoint passed to the library is EXCLUSIVELY owned by the
 * library. Do not also set addEventListener('message', ...) on the same object after
 * passing it here — the library sets onmessage= which may conflict. For shared endpoints,
 * create a MessageChannel and pass one port to the library.
 */
export interface PostMessageEndpoint {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
}
