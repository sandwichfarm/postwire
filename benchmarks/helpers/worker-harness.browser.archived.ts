// benchmarks/helpers/worker-harness.ts
// Factory for spinning up a bench Worker context with the library wired.
// Uses a Blob URL for the worker source to avoid Vite worker bundling configuration
// (see Phase 5 RESEARCH.md Pitfall 5).

import { createChannel, createLowLevelStream } from "../../src/index.js";
import { createBinaryPayload } from "./payloads.js";

export interface BenchWorker {
  /**
   * Send `bytes` bytes of random binary data via the library's LowLevelStream
   * (transferable path). Payload is created inside — buffer is consumed per call.
   */
  sendViaLibrary: (bytes: number) => Promise<void>;
  /**
   * Send `bytes` bytes via raw postMessage — naive baseline without framing.
   */
  sendNaive: (bytes: number) => Promise<void>;
  terminate: () => void;
}

export async function createBenchWorker(): Promise<BenchWorker> {
  // Inline worker source as a Blob URL.
  // Absolute /src/index.js path is served by Vite dev server in bench mode.
  const workerSrc = `
    import { createChannel, createLowLevelStream } from '/src/index.js';

    let mainChannel;
    self.onmessage = (e) => {
      if (e.data?.type === 'init') {
        const port = e.data.port;
        mainChannel = createChannel(port);
        mainChannel.onStream(() => {
          const stream = createLowLevelStream(mainChannel);
          stream.onChunk(() => {});
          stream.onClose(() => {});
        });
        port.postMessage({ type: 'ready' });
      }
      if (e.data?.type === 'naive') {
        const naivePort = e.data.port;
        naivePort.onmessage = () => { naivePort.postMessage({ type: 'ack' }); };
      }
    };
  `;

  const blob = new Blob([workerSrc], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url, { type: "module" });

  const { port1, port2 } = new MessageChannel();
  worker.postMessage({ type: "init", port: port2 }, [port2]);

  // Wait for ready signal from worker
  await new Promise<void>((resolve) => {
    port1.onmessage = (e) => {
      if (e.data?.type === "ready") resolve();
    };
    port1.start();
  });

  const channel = createChannel(port1);

  return {
    async sendViaLibrary(bytes: number): Promise<void> {
      const buf = createBinaryPayload(bytes);
      const stream = createLowLevelStream(channel);
      await new Promise<void>((resolve, reject) => {
        stream.onClose(resolve);
        stream.onError(reject);
        void stream.send(buf, [buf]).then(() => { stream.close(); }).catch(reject);
      });
    },

    async sendNaive(bytes: number): Promise<void> {
      const buf = createBinaryPayload(bytes);
      const { port1: p1, port2: p2 } = new MessageChannel();
      worker.postMessage({ type: "naive", port: p2 }, [p2]);
      await new Promise<void>((resolve) => {
        p1.onmessage = (e) => {
          if (e.data?.type === "ack") {
            p1.close();
            resolve();
          }
        };
        p1.start();
        p1.postMessage(buf, [buf]);
      });
    },

    terminate(): void {
      channel.close();
      port1.close();
      worker.terminate();
      URL.revokeObjectURL(url);
    },
  };
}
