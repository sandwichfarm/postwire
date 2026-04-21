// benchmarks/helpers/node-harness.ts
// Node-mode benchmark harness using node:worker_threads MessageChannel.
//
// RATIONALE (Phase 5 Node pivot):
// The browser-mode harness (iframe-harness.browser.archived.ts + worker-harness.browser.archived.ts)
// used srcdoc iframes with `import ... from '/src/index.js'` which never resolved inside a sandboxed
// srcdoc — the ping/pong CAPABILITY handshake never completed and `pnpm bench` hung indefinitely
// (440+ s with 0 bench results). See 05-01-SUMMARY.md for full rationale.
//
// Node MessageChannel from node:worker_threads provides:
//   - Real structured-clone semantics (DataCloneError on non-cloneable values)
//   - Real Transferable semantics (ArrayBuffer detach verified in Phase 3 FAST-01 tests)
//   - Fast, deterministic, no iframe bootstrapping overhead
//   - Same V8 engine that powers Chrome — measurements are directly applicable
//
// Trade-off: we measure library overhead in Node/V8, not browser-specific OS scheduling
// or compositor-layer differences. Browser-runtime benchmarks can be added in Phase 9
// alongside E2E tests.

import { MessageChannel } from "node:worker_threads";
import { createChannel } from "../../src/index.js";
import type { PostMessageEndpoint } from "../../src/transport/endpoint.js";
import { createBinaryPayload, createStructuredPayload } from "./payloads.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Cast a Node MessagePort to PostMessageEndpoint (compatible shape, verified Phase 3). */
function asEndpoint(port: import("node:worker_threads").MessagePort): PostMessageEndpoint {
  return port as unknown as PostMessageEndpoint;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send `bytes` bytes of random binary data via the library's LowLevelStream
 * using the BINARY_TRANSFER (Transferable) path.
 *
 * Measures: full send round-trip including CAPABILITY handshake, OPEN/OPEN_ACK,
 * DATA frame(s) with credit flow, and receiver chunk delivery.
 *
 * Iteration ends when the receiver has accumulated `bytes` bytes — no explicit
 * stream close needed for throughput measurement.
 *
 * Fresh channel pair per call — no state leak between bench iterations.
 */
export async function sendBinaryViaLibrary(bytes: number): Promise<void> {
  const { port1, port2 } = new MessageChannel();

  const chA = createChannel(asEndpoint(port1));
  const chB = createChannel(asEndpoint(port2));

  // Wait for both sides to complete CAPABILITY handshake
  await Promise.all([chA.capabilityReady, chB.capabilityReady]);

  // Set up receiver: resolve when all bytes have been received
  let resolve!: () => void;
  const receiverDone = new Promise<void>((res) => {
    resolve = res;
  });

  let bytesReceived = 0;
  chB.onStream((handle) => {
    handle.session.onChunk((chunk) => {
      if (chunk instanceof ArrayBuffer) {
        bytesReceived += chunk.byteLength;
      }
      if (bytesReceived >= bytes) {
        resolve();
      }
    });
  });

  // Open stream and queue the send immediately (held by session until OPEN_ACK delivers credit)
  const handle = chA.openStream();
  const buf = createBinaryPayload(bytes);
  handle.session.sendData(buf, "BINARY_TRANSFER");

  // Wait for receiver to get all bytes (credit flow drives delivery of all chunks)
  await receiverDone;

  port1.close();
  port2.close();
}

/**
 * Send a structured JS object of approximately `bytes` bytes via the library's
 * LowLevelStream using the STRUCTURED_CLONE path (no transfer list).
 *
 * Measures: structured-clone serialisation cost through the library framing layer.
 * Compares against sendBinaryViaLibrary to quantify BINARY_TRANSFER vs STRUCTURED_CLONE cost.
 */
export async function sendStructuredViaLibrary(bytes: number): Promise<void> {
  const { port1, port2 } = new MessageChannel();

  const chA = createChannel(asEndpoint(port1));
  const chB = createChannel(asEndpoint(port2));

  await Promise.all([chA.capabilityReady, chB.capabilityReady]);

  // Receiver: resolve after the single chunk arrives
  let resolve!: () => void;
  const receiverDone = new Promise<void>((res) => {
    resolve = res;
  });

  chB.onStream((handle) => {
    handle.session.onChunk(() => {
      resolve();
    });
  });

  // Build structured payload and send without transfer list (STRUCTURED_CLONE path)
  const payload = createStructuredPayload(bytes);
  const handle = chA.openStream();
  handle.session.sendData(payload, "STRUCTURED_CLONE");

  await receiverDone;

  port1.close();
  port2.close();
}

/**
 * Send `bytes` bytes of random binary data via the library's SAB fast path.
 *
 * Constructs Channels with { sab: true } and a ring buffer sized to 2× the payload.
 * Waits for CAPABILITY + SAB_INIT handshake before sending, then measures the
 * full transfer time including SAB ring write + async consumer dispatch.
 *
 * Fresh channel pair per call — no state leak between bench iterations.
 */
export async function sendBinaryViaLibrarySab(bytes: number): Promise<void> {
  const { port1, port2 } = new MessageChannel();

  // Size the ring buffer to 4× the payload so large payloads don't block.
  // Each 64 KB chunk (default maxChunkSize) fits in the ring before the consumer reads it.
  const sabBufferSize = Math.max(4 * 1024 * 1024, bytes * 2);

  const chA = createChannel(asEndpoint(port1), { sab: true, sabBufferSize });
  const chB = createChannel(asEndpoint(port2), { sab: true, sabBufferSize });

  // Wait for CAPABILITY + SAB_INIT handshake.
  // CAPABILITY resolves quickly, but SAB_INIT requires an additional postMessage round-trip.
  // Poll stats() until both sides are sabActive=true (or timeout after 5 s).
  await Promise.all([chA.capabilityReady, chB.capabilityReady]);
  const sabDeadline = Date.now() + 5000;
  while ((!chA.stats().sabActive || !chB.stats().sabActive) && Date.now() < sabDeadline) {
    await new Promise<void>((res) => setImmediate(res));
  }

  // Receiver: resolve when all bytes arrive
  let resolve!: () => void;
  const receiverDone = new Promise<void>((res) => {
    resolve = res;
  });

  let bytesReceived = 0;
  chB.onStream((handle) => {
    handle.session.onChunk((chunk) => {
      if (chunk instanceof ArrayBuffer) {
        bytesReceived += chunk.byteLength;
      }
      if (bytesReceived >= bytes) {
        resolve();
      }
    });
  });

  // Open stream and queue the send (held by session until OPEN_ACK delivers credit)
  const handle = chA.openStream();
  const buf = createBinaryPayload(bytes);
  handle.session.sendData(buf, "BINARY_TRANSFER");

  await receiverDone;

  port1.close();
  port2.close();
}

/**
 * Send `bytes` bytes via raw postMessage — naive baseline without library framing.
 * Uses direct port.postMessage(buf, [buf]) + ack pattern.
 *
 * Measures: raw MessageChannel ArrayBuffer transfer overhead with no library overhead.
 * Compare against sendBinaryViaLibrary to quantify library framing cost.
 */
export async function sendNaive(bytes: number): Promise<void> {
  const { port1, port2 } = new MessageChannel();

  const buf = createBinaryPayload(bytes);

  await new Promise<void>((resolve) => {
    // Receiver side: ack on first message
    port2.on("message", () => {
      port2.postMessage({ type: "ack" });
    });

    // Sender side: resolve when ack arrives
    port1.on("message", (msg: { type: string }) => {
      if (msg.type === "ack") {
        port1.close();
        port2.close();
        resolve();
      }
    });

    // Send — ArrayBuffer ownership transfers to port2 receiver
    port1.postMessage(buf, [buf]);
  });
}
