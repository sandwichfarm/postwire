import { createChannel, createMessagePortEndpoint } from "/dist/index.js";

const TOTAL = 1024 * 1024; // 1 MB expected

// Receive a MessagePort from parent via postMessage
window.addEventListener("message", async (ev) => {
  if (ev.data?.type !== "PORT") return;
  const port = ev.ports[0];
  if (!port) return;

  const endpoint = createMessagePortEndpoint(port);
  const ch = createChannel(endpoint, { channelId: "sandbox-inner" });

  await ch.capabilityReady;

  let received = 0;

  ch.onStream((handle) => {
    handle.session.onChunk((chunk) => {
      if (chunk instanceof ArrayBuffer) {
        received += chunk.byteLength;
      }
      // Signal parent when all expected data arrives
      if (received >= TOTAL) {
        window.parent.postMessage({ type: "ACK", received }, "*");
      }
    });
  });
});
