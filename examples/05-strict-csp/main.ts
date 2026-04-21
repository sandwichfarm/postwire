import {
  createChannel,
  createLowLevelStream,
  createMessagePortEndpoint,
} from "postwire";

const CHUNK_SIZE = 64 * 1024; // 64 KB
const TOTAL = 512 * 1024;     // 512 KB
const NUM_CHUNKS = TOTAL / CHUNK_SIZE;

const iframe = document.getElementById("csp-frame") as HTMLIFrameElement;
const status = document.getElementById("status") as HTMLDivElement;
const btn = document.getElementById("send") as HTMLButtonElement;

btn.addEventListener("click", () => {
  btn.disabled = true;
  status.textContent = "Waiting for iframe to load...";

  iframe.addEventListener("load", async () => {
    const { port1, port2 } = new MessageChannel();
    iframe.contentWindow!.postMessage({ type: "PORT" }, "*", [port2]);

    const ch = createChannel(createMessagePortEndpoint(port1));
    await ch.capabilityReady;

    const stream = createLowLevelStream(ch);

    // Wait for responder to register
    await new Promise((r) => setTimeout(r, 50));

    status.textContent = "Sending 512 KB...";
    for (let i = 0; i < NUM_CHUNKS; i++) {
      const buf = new ArrayBuffer(CHUNK_SIZE);
      new Uint8Array(buf).fill(i & 0xff);
      await stream.send(buf, [buf]);
    }
    stream.close();
    status.textContent = "Sent. Waiting for DONE from iframe...";
  }, { once: true });
});

window.addEventListener("message", (ev) => {
  if (ev.data === "DONE") {
    status.textContent = "Iframe logged DONE. Transfer complete!";
  }
});
