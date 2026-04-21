import {
  createChannel,
  createLowLevelStream,
  createMessagePortEndpoint,
} from "postwire";

const CHUNK_SIZE = 64 * 1024; // 64 KB chunks
const TOTAL = 1024 * 1024;    // 1 MB
const NUM_CHUNKS = TOTAL / CHUNK_SIZE;

const iframe = document.getElementById("child") as HTMLIFrameElement;
const prog = document.getElementById("prog") as HTMLProgressElement;
const status = document.getElementById("status") as HTMLDivElement;
const btn = document.getElementById("send") as HTMLButtonElement;

btn.addEventListener("click", () => {
  btn.disabled = true;
  status.textContent = "Waiting for iframe...";

  iframe.addEventListener("load", async () => {
    const { port1, port2 } = new MessageChannel();
    iframe.contentWindow!.postMessage({ type: "PORT" }, "*", [port2]);

    const ch = createChannel(createMessagePortEndpoint(port1));
    await ch.capabilityReady;

    const stream = createLowLevelStream(ch);

    // Small delay for responder side to register onStream
    await new Promise((r) => setTimeout(r, 50));

    status.textContent = "Sending...";
    for (let i = 0; i < NUM_CHUNKS; i++) {
      const buf = new ArrayBuffer(CHUNK_SIZE);
      new Uint8Array(buf).fill(i & 0xff);
      await stream.send(buf, [buf]);
      prog.value = Math.round(((i + 1) / NUM_CHUNKS) * 100);
    }
    stream.close();
    status.textContent = "Sent! Waiting for acknowledgement...";
  }, { once: true });
});

window.addEventListener("message", (ev) => {
  if (ev.data?.type === "DONE") {
    status.textContent = `Iframe received ${ev.data.received} bytes. Done!`;
    prog.value = 100;
  }
});
