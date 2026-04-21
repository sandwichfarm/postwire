// benchmarks/helpers/iframe-harness.ts
// Factory for spinning up a bench iframe context with the library wired.

import { createChannel, createLowLevelStream } from "../../src/index.js";
import type { Channel } from "../../src/index.js";
import { createBinaryPayload } from "./payloads.js";

export interface BenchIframe {
  channel: Channel;
  /**
   * Send `bytes` bytes of random binary data via the library's LowLevelStream
   * (transferable path). Payload is created inside — buffer is consumed per call.
   */
  sendViaLibrary: (bytes: number) => Promise<void>;
  /**
   * Send `bytes` bytes via raw postMessage — naive baseline without framing.
   */
  sendNaive: (bytes: number) => Promise<void>;
  destroy: () => void;
}

export async function createBenchIframe(): Promise<BenchIframe> {
  const { port1, port2 } = new MessageChannel();

  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");

  // Inline the receiver side as a srcdoc module script.
  // The iframe drains incoming LowLevelStream chunks and acks naive messages.
  iframe.srcdoc = `<!DOCTYPE html><html><body><script type="module">
    import { createChannel, createLowLevelStream } from '/src/index.js';
    window.addEventListener('message', (e) => {
      if (e.data?.type === 'init') {
        const port = e.data.port;
        const ch = createChannel(port);
        ch.onStream((handle) => {
          const stream = createLowLevelStream(ch);
          stream.onChunk(() => {});
          stream.onClose(() => {});
        });
        port.postMessage({ type: 'ready' });
      }
      if (e.data?.type === 'naive') {
        const naivePort = e.data.port;
        naivePort.onmessage = () => { naivePort.postMessage({ type: 'ack' }); };
      }
    });
  <\/script></body></html>`;

  document.body.appendChild(iframe);

  // Wait for iframe to load
  await new Promise<void>((resolve) => {
    iframe.onload = () => resolve();
  });

  // Send control port to iframe
  iframe.contentWindow!.postMessage({ type: "init", port: port2 }, "*", [port2]);

  // Wait for iframe ready signal
  await new Promise<void>((resolve) => {
    port1.onmessage = (e) => {
      if (e.data?.type === "ready") resolve();
    };
    port1.start();
  });

  const channel = createChannel(port1);

  return {
    channel,

    async sendViaLibrary(bytes: number): Promise<void> {
      const buf = createBinaryPayload(bytes);
      const stream = createLowLevelStream(channel);
      await new Promise<void>((resolve, reject) => {
        stream.onClose(resolve);
        stream.onError(reject);
        // Transfer the buffer; ownership passes to the transport layer
        void stream.send(buf, [buf]).then(() => { stream.close(); }).catch(reject);
      });
    },

    async sendNaive(bytes: number): Promise<void> {
      const buf = createBinaryPayload(bytes);
      const { port1: p1, port2: p2 } = new MessageChannel();
      iframe.contentWindow!.postMessage({ type: "naive", port: p2 }, "*", [p2]);
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

    destroy(): void {
      channel.close();
      port1.close();
      iframe.remove();
    },
  };
}
