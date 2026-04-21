// iframebuffer public API — Phase 1 exports

export { decode, encode } from "./framing/encode-decode.js";
// Framing types and encode/decode (Phase 1 — Plan 02)
export type {
  BaseFrame,
  CancelFrame,
  CapabilityFrame,
  ChunkType,
  CloseFrame,
  CreditFrame,
  DataFrame,
  Frame,
  OpenAckFrame,
  OpenFrame,
  ResetFrame,
} from "./framing/types.js";
export { FRAME_MARKER, PROTOCOL_VERSION } from "./framing/types.js";
export { createMessagePortEndpoint } from "./transport/adapters/message-port.js";
export type { ServiceWorkerEndpointMeta } from "./transport/adapters/service-worker.js";
export { createServiceWorkerEndpoint } from "./transport/adapters/service-worker.js";
export { createWindowEndpoint } from "./transport/adapters/window.js";
export { createWorkerEndpoint } from "./transport/adapters/worker.js";
// PostMessageEndpoint interface and adapters (Phase 1 — Plan 03)
export type { PostMessageEndpoint } from "./transport/endpoint.js";

// Sequence number arithmetic (Phase 1 — Plan 02)
export { seqGT, seqLT, seqLTE, seqMask, seqNext } from "./transport/seq.js";
