// benchmarks/scenarios/structured-clone.bench.ts
// Measures structured-clone (non-transferable JS object) path throughput via the library.
//
// Uses node:worker_threads MessageChannel — real structured-clone semantics.
// This is the "slow path": no zero-copy, serialisation + deserialisation overhead.
// Compare against binary-transfer.bench.ts to quantify BINARY_TRANSFER vs STRUCTURED_CLONE cost.

import { bench, describe } from "vitest";
import { sendStructuredViaLibrary } from "../helpers/node-harness.js";

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
  const iterations = bytes <= 1024 ? 50 : bytes <= 65536 ? 30 : 10;

  describe(`structured-clone ${label}`, () => {
    bench(
      `library (structured-clone) [${label}]`,
      async () => {
        await sendStructuredViaLibrary(bytes);
      },
      {
        iterations,
        warmupIterations: 3,
        time: 2000,
      },
    );
  });
}
