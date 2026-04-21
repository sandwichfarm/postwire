import {
  createChannel,
  createEmitterStream,
  createWorkerEndpoint,
} from "postwire";

const log = document.getElementById("log") as HTMLPreElement;
const btn = document.getElementById("start") as HTMLButtonElement;

function appendLog(msg: string) {
  log.textContent += msg + "\n";
  log.scrollTop = log.scrollHeight;
}

btn.addEventListener("click", async () => {
  btn.disabled = true;
  appendLog("Starting worker...");

  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  const endpoint = createWorkerEndpoint(worker);
  const ch = createChannel(endpoint);
  await ch.capabilityReady;

  const stream = createEmitterStream(ch); // role: 'initiator' (default)

  stream.on("drain", () => appendLog("drain — credit window refilled"));
  stream.on("error", (err) => appendLog(`ERROR: ${err.code}`));

  const FRAMES = 50;
  let sent = 0;
  const start = performance.now();

  function sendNext() {
    while (sent < FRAMES) {
      const ok = stream.write({ frame: sent, timestamp: performance.now() });
      sent++;
      if (!ok) {
        appendLog(`[${sent}] backpressure — waiting for drain`);
        stream.once("drain", sendNext);
        return;
      }
    }
    appendLog(`All ${FRAMES} frames sent in ${(performance.now() - start).toFixed(1)} ms`);
    stream.end();
  }

  // Wait for worker to register onStream
  await new Promise((r) => setTimeout(r, 50));
  sendNext();

  worker.addEventListener("message", (ev) => {
    if (ev.data?.type === "RATE") {
      appendLog(`Worker processed ${ev.data.count} frames @ ${ev.data.hz.toFixed(0)} frames/s`);
      worker.terminate();
    }
  });
});
