// benchmarks/scenarios/sab-transfer.bench.ts
// Measures SAB (SharedArrayBuffer) ring-buffer path throughput vs transferable path.
//
// Uses node:worker_threads MessageChannel — real Atomics + SAB semantics in Node 22.
// See benchmarks/helpers/node-harness.ts for design rationale.
//
// NOTE: SAB initialization requires a 50 ms warmup per iteration (SAB_INIT handshake).
// This overhead is included in measurements to reflect real-world cost.
// For fair comparison, see binary-transfer.bench.ts which measures the transferable path.

import { bench, describe } from "vitest";
import { sendBinaryViaLibrary } from "../helpers/node-harness.js";
import { sendBinaryViaLibrarySab } from "../helpers/node-harness.js";

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
  // Fewer iterations for large payloads to keep total bench time reasonable.
  // SAB bench uses fewer iterations than transferable because SAB_INIT adds ~50ms overhead.
  const iterations = bytes >= 1024 * 1024 ? 10 : bytes >= 64 * 1024 ? 20 : 30;

  describe(`sab-transfer ${label}`, () => {
    bench(
      `library (SAB) [${label}]`,
      async () => {
        await sendBinaryViaLibrarySab(bytes);
      },
      {
        iterations,
        warmupIterations: 2,
        time: 2000,
      },
    );

    bench(
      `library (transferable) [${label}]`,
      async () => {
        await sendBinaryViaLibrary(bytes);
      },
      {
        iterations,
        warmupIterations: 2,
        time: 2000,
      },
    );
  });
}
