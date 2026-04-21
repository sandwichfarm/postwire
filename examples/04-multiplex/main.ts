import {
  createChannel,
  createLowLevelStream,
  createEmitterStream,
  createMessagePortEndpoint,
} from "postwire";

const log = document.getElementById("log") as HTMLPreElement;
const btn = document.getElementById("start") as HTMLButtonElement;

function appendLog(msg: string) {
  log.textContent += msg + "\n";
  log.scrollTop = log.scrollHeight;
}

btn.addEventListener("click", async () => {
  btn.disabled = true;

  const { port1, port2 } = new MessageChannel();

  // Initiator: multiplex mode — two streams over one channel
  const chA = createChannel(createMessagePortEndpoint(port1), { multiplex: true });

  // Responder: must also enable multiplex
  const chB = createChannel(createMessagePortEndpoint(port2), {
    multiplex: true,
    role: "responder",
  });

  await Promise.all([chA.capabilityReady, chB.capabilityReady]);
  appendLog(`Multiplex active: ${chA.capabilities.multiplex}`);

  // Stream 1: "file download" (binary chunks via low-level)
  const fileStream = createLowLevelStream(chA);
  // Stream 2: "control messages" (structured clone via emitter)
  const controlStream = createEmitterStream(chA);

  // Responder side: handle inbound streams in order (initiator opens stream 1 first, then stream 2)
  let streamCount = 0;
  chB.onStream(({ session }) => {
    streamCount++;
    const id = streamCount;
    session.onChunk((chunk) => {
      if (id === 1) {
        appendLog(`[file]    received ${(chunk as ArrayBuffer).byteLength} bytes`);
      } else {
        appendLog(`[control] received: ${JSON.stringify(chunk)}`);
      }
    });
  });

  // Give responder time to register
  await new Promise((r) => setTimeout(r, 50));

  // Send file chunks (stream 1)
  for (let i = 0; i < 4; i++) {
    const buf = new ArrayBuffer(16 * 1024);
    new Uint8Array(buf).fill(i);
    await fileStream.send(buf, [buf]);
    appendLog(`[file]    sent chunk ${i + 1}/4`);
  }

  // Send control messages (stream 2) — interleaved
  for (let i = 0; i < 3; i++) {
    controlStream.write({ cmd: "progress", pct: (i + 1) * 33 });
    appendLog(`[control] sent progress ${(i + 1) * 33}%`);
    await new Promise((r) => setTimeout(r, 10));
  }

  fileStream.close();
  controlStream.end();
  appendLog("Both streams closed.");
});
