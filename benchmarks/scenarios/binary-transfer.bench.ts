// benchmarks/scenarios/binary-transfer.bench.ts
// Measures ArrayBuffer transferable path throughput via the library (Node env).
//
// Uses node:worker_threads MessageChannel — real Transferable semantics, same V8 as Chrome.
// See benchmarks/helpers/node-harness.ts for design rationale.

import { bench, describe } from "vitest";
import { sendBinaryViaLibrary } from "../helpers/node-harness.js";

// PW_BENCH_HEAVY=1 enables 256 MB scenario (excluded by default for dev ergonomics)
const HEAVY: boolean =
  typeof process !== "undefined" && process.env?.PW_BENCH_HEAVY === "1";

const SIZES: [number, string][] = [
  [1024, "1KB"],
  [64 * 1024, "64KB"],
  [1 * 1024 * 1024, "1MB"],
  [16 * 1024 * 1024, "16MB"],
  ...(HEAVY ? ([[256 * 1024 * 1024, "256MB"]] as [number, string][]) : []),
];

for (const [bytes, label] of SIZES) {
  // More iterations for small payloads to reduce RME noise
  const iterations = bytes <= 1024 ? 50 : bytes <= 65536 ? 30 : 10;

  describe(`binary-transfer ${label}`, () => {
    bench(
      `library (transferable) [${label}]`,
      async () => {
        await sendBinaryViaLibrary(bytes);
      },
      {
        iterations,
        warmupIterations: 3,
        time: 2000,
      },
    );
  });
}
