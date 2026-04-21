// benchmarks/scenarios/binary-transfer.bench.ts
// Measures ArrayBuffer transferable path throughput — library vs baseline sizes.
// Uses iframe + worker contexts via shared harness helpers.
import { bench, describe } from "vitest";
import { createBenchIframe } from "../helpers/iframe-harness.js";
import { createBenchWorker } from "../helpers/worker-harness.js";
import type { BenchIframe } from "../helpers/iframe-harness.js";
import type { BenchWorker } from "../helpers/worker-harness.js";

// IFB_BENCH_HEAVY=1 enables 256 MB scenario (excluded by default for dev ergonomics)
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
  // Use more iterations for small payloads to reduce RME noise
  const iterations = bytes <= 1024 ? 100 : 30;

  describe(`binary-transfer ${label}`, () => {
    // --- iframe topology ---
    let iframeCtx: BenchIframe;

    bench(
      `library (transferable) — iframe [${label}]`,
      async () => {
        // payload created inside sendViaLibrary — never reuse a detached buffer
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

    // --- worker topology ---
    let workerCtx: BenchWorker;

    bench(
      `library (transferable) — worker [${label}]`,
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
