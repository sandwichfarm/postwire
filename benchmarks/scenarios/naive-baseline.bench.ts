// benchmarks/scenarios/naive-baseline.bench.ts
// Measures raw postMessage throughput WITHOUT library framing — naive baseline.
//
// BENCH-03: "library throughput measurably beats naive single postMessage for binary payloads >= 1 MB"
//
// Uses sendNaive() — direct port.postMessage(buf, [buf]) + ack, no framing overhead.
// Compare against binary-transfer.bench.ts results to confirm library win.

import { bench, describe } from "vitest";
import { sendNaive } from "../helpers/node-harness.js";

const HEAVY: boolean =
  typeof process !== "undefined" && process.env?.IFB_BENCH_HEAVY === "1";

const SIZES: [number, string][] = [
  [1024, "1KB"],
  [64 * 1024, "64KB"],
  [1 * 1024 * 1024, "1MB"],
  [16 * 1024 * 1024, "16MB"],
  ...(HEAVY ? ([[256 * 1024 * 1024, "256MB"]] as [number, string][]) : []),
];

for (const [bytes, label] of SIZES) {
  const iterations = bytes <= 1024 ? 50 : bytes <= 65536 ? 30 : 10;

  describe(`naive-baseline ${label}`, () => {
    bench(
      `naive postMessage [${label}]`,
      async () => {
        await sendNaive(bytes);
      },
      {
        iterations,
        warmupIterations: 3,
        time: 2000,
      },
    );
  });
}
