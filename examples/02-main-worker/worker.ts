import {
  createChannel,
  createEmitterStream,
  createWorkerEndpoint,
} from "iframebuffer";

const endpoint = createWorkerEndpoint(self as unknown as DedicatedWorkerGlobalScope);
const ch = createChannel(endpoint);

const stream = createEmitterStream(ch, { role: "responder" });

let count = 0;
const start = performance.now();

stream.on("data", (_chunk) => {
  count++;
});

stream.on("close", () => {
  const elapsed = (performance.now() - start) / 1000;
  self.postMessage({ type: "RATE", count, hz: count / elapsed });
});

stream.on("error", (err) => {
  console.error("Worker stream error:", err.code);
});
