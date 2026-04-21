// benchmarks/scenarios/naive-baseline.bench.ts
// Measures raw postMessage throughput WITHOUT library framing.
// This is the comparison baseline for BENCH-03:
//   "library throughput measurably beats naive postMessage for binary payloads >= 1 MB"
//
// Uses sendNaive() — direct port.postMessage(buf, [buf]) with no framing overhead.
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

  describe(`naive-baseline ${label}`, () => {
    let iframeCtx: BenchIframe;

    bench(
      `naive postMessage — iframe [${label}]`,
      async () => {
        await iframeCtx.sendNaive(bytes);
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
      `naive postMessage — worker [${label}]`,
      async () => {
        await workerCtx.sendNaive(bytes);
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
