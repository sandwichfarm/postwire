import {
  createChannel,
  createRelayBridge,
  createWorkerEndpoint,
  createMessagePortEndpoint,
} from "iframebuffer";

const btn = document.getElementById("start") as HTMLButtonElement;
const countEl = document.getElementById("count") as HTMLSpanElement;
const iframe = document.getElementById("consumer") as HTMLIFrameElement;

btn.addEventListener("click", async () => {
  btn.disabled = true;

  // Upstream channel: main ↔ worker
  const worker = new Worker(new URL("./producer.ts", import.meta.url), { type: "module" });
  const chUpstream = createChannel(createWorkerEndpoint(worker));

  // Downstream channel: main ↔ iframe (via MessagePort)
  const { port1, port2 } = new MessageChannel();

  iframe.addEventListener("load", async () => {
    iframe.contentWindow!.postMessage({ type: "PORT" }, "*", [port2]);
    const chDownstream = createChannel(createMessagePortEndpoint(port1));

    await Promise.all([chUpstream.capabilityReady, chDownstream.capabilityReady]);

    // Wire relay: frames from upstream are forwarded to downstream without reassembly
    const _bridge = createRelayBridge(chUpstream, chDownstream);
  }, { once: true });

  // Listen for chunk count updates from iframe
  window.addEventListener("message", (ev) => {
    if (ev.data?.type === "COUNT") {
      countEl.textContent = String(ev.data.count);
    }
  });
});
