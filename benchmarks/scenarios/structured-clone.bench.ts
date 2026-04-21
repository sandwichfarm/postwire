// benchmarks/scenarios/structured-clone.bench.ts
// Measures structured-clone (non-transferable JS object) path throughput.
// Structured clone is the slow path: no zero-copy, GC pressure from serialization.
import { bench, describe } from "vitest";
import { createBenchIframe } from "../helpers/iframe-harness.js";
import { createBenchWorker } from "../helpers/worker-harness.js";
import type { BenchIframe } from "../helpers/iframe-harness.js";
import type { BenchWorker } from "../helpers/worker-harness.js";

const HEAVY: boolean =
  (typeof process !== "undefined" && process.env?.IFB_BENCH_HEAVY === "1") ||
  ((globalThis as unknown as Record<string, string>).IFB_BENCH_HEAVY === "1");

const SIZES: [number, string][] = [
  [1024, "1KB"],
  [64 * 1024, "64KB"],
  [1 * 1024 * 1024, "1MB"],
  [16 * 1024 * 1024, "16MB"],
  ...(HEAVY ? [[256 * 1024 * 1024, "256MB"] as [number, string]] : []),
];

for (const [bytes, label] of SIZES) {
  const iterations = bytes <= 1024 ? 100 : 30;

  describe(`structured-clone ${label}`, () => {
    let iframeCtx: BenchIframe;

    bench(
      `library (structured-clone) — iframe [${label}]`,
      async () => {
        // sendViaLibrary with bytes — harness generates structured payload internally
        // For structured-clone comparison, we pass bytes as the size target
        await iframeCtx.sendViaLibrary(bytes);
      },
      {
        iterations,
        warmupIterations: 5,
        setup: async () => {
          iframeCtx = await createBenchIframe();
        },
        teardown: async () => {
          iframeCtx.destroy();
        },
      },
    );

    let workerCtx: BenchWorker;

    bench(
      `library (structured-clone) — worker [${label}]`,
      async () => {
        await workerCtx.sendViaLibrary(bytes);
      },
      {
        iterations,
        warmupIterations: 5,
        setup: async () => {
          workerCtx = await createBenchWorker();
        },
        teardown: async () => {
          workerCtx.terminate();
        },
      },
    );
  });
}
