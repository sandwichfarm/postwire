// Worker: produces a stream of 20 structured-clone chunks
import {
  createChannel,
  createEmitterStream,
  createWorkerEndpoint,
} from "iframebuffer";

const ch = createChannel(createWorkerEndpoint(self as unknown as DedicatedWorkerGlobalScope));
await ch.capabilityReady;

const stream = createEmitterStream(ch);

// Small delay so relay has time to wire up
await new Promise((r) => setTimeout(r, 100));

for (let i = 0; i < 20; i++) {
  stream.write({ seq: i, data: `chunk-${i}` });
  // Yield to allow credit frames to process
  await new Promise((r) => setTimeout(r, 10));
}
stream.end();
