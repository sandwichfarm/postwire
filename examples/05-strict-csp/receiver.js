// receiver.js — plain JS so no TypeScript compilation needed in the iframe.
// CSP: script-src 'self' — no eval, no inline scripts, no wasm-unsafe-eval.
// The library baseline path is fully compatible with this policy.
import {
  createChannel,
  createMessagePortEndpoint,
} from "iframebuffer";

let received = 0;

window.addEventListener("message", (ev) => {
  if (ev.data?.type !== "PORT") return;
  const ch = createChannel(createMessagePortEndpoint(ev.ports[0]));

  ch.onStream(({ session }) => {
    session.onChunk((chunk) => {
      received += chunk instanceof ArrayBuffer ? chunk.byteLength : 0;
    });
    // When stream closes, report back
    session.onChunk(() => {
      if (received >= 512 * 1024) {
        console.log("DONE");
        window.parent.postMessage("DONE", "*");
      }
    });
  });
});
