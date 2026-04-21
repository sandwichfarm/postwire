// benchmarks/helpers/reporter.ts
// Custom Vitest reporter that serializes bench results to benchmarks/results/*.json.
//
// Uses tinybench 6 result shape: task.result is a TaskResult (discriminated union).
// Completed tasks have state === 'completed' and expose:
//   latency: Statistics  — p50, p75, p99, rme, mean, samplesCount
//   throughput: Statistics — mean (ops/sec)

import { writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Reporter, File } from "vitest";
import type {
  TaskResultCompleted,
  TaskResultWithStatistics,
} from "tinybench";

interface ScenarioResult {
  name: string;
  mb_s: number;
  p50_ms: number;
  p75_ms: number;
  p99_ms: number;
  samples: number;
  rme: number;
}

interface BenchArtifact {
  timestamp: string;
  commit: string;
  node: string;
  browser: string;
  browserVersion: string;
  scenarios: ScenarioResult[];
}

/** Extract payload size in bytes from scenario name like "binary-1mb-..." or "binary-64kb-..." */
function extractPayloadBytes(name: string): number {
  const mb = name.match(/(\d+)mb/i);
  if (mb) return Number(mb[1]) * 1024 * 1024;
  const kb = name.match(/(\d+)kb/i);
  if (kb) return Number(kb[1]) * 1024;
  return 0;
}

function isCompletedResult(
  r: unknown
): r is TaskResultCompleted & TaskResultWithStatistics {
  return (
    r !== null &&
    typeof r === "object" &&
    (r as TaskResultCompleted).state === "completed" &&
    "latency" in (r as object) &&
    "throughput" in (r as object)
  );
}

export class BenchJsonReporter implements Reporter {
  onFinished(files: File[] = []): void {
    const scenarios: ScenarioResult[] = [];

    for (const file of files) {
      // Walk task tree: file > suites > bench tasks
      const walkTasks = (tasks: (typeof file.tasks)[number][]): void => {
        for (const task of tasks) {
          if ("tasks" in task && Array.isArray(task.tasks)) {
            walkTasks(task.tasks);
          }
          // Bench tasks have a result with the tinybench TaskResult shape
          const result = (task as unknown as { result?: unknown }).result;
          if (!isCompletedResult(result)) continue;

          const payloadBytes = extractPayloadBytes(task.name);
          const hz = result.throughput.mean; // ops/sec in tinybench 6
          scenarios.push({
            name: task.name,
            mb_s: payloadBytes > 0 ? (payloadBytes * hz) / 1_000_000 : 0,
            p50_ms: result.latency.p50,
            p75_ms: result.latency.p75,
            p99_ms: result.latency.p99,
            samples: result.latency.samplesCount,
            rme: result.latency.rme,
          });
        }
      };

      walkTasks(file.tasks ?? []);
    }

    if (scenarios.length === 0) return;

    const artifact: BenchArtifact = {
      timestamp: new Date().toISOString(),
      commit: (process.env["GITHUB_SHA"] ?? "").slice(0, 7) || "local",
      node: process.versions?.node ?? "unknown",
      browser: process.env["VITEST_BROWSER_NAME"] ?? "unknown",
      browserVersion: process.env["VITEST_BROWSER_VERSION"] ?? "unknown",
      scenarios,
    };

    const outDir = "benchmarks/results";
    mkdirSync(outDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const sha = artifact.commit;
    const outPath = join(outDir, `${ts}-${sha}.json`);
    writeFileSync(outPath, JSON.stringify(artifact, null, 2));
    copyFileSync(outPath, join(outDir, "baseline.json"));
  }
}
