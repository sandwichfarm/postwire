#!/usr/bin/env node
// benchmarks/cpu-profile.mjs
// Gap closure for BENCH-02's CPU-time estimate clause. Vitest bench + tinybench
// don't expose per-iteration CPU usage, so this runs each scenario directly
// against node:worker_threads MessageChannel (same path as node-harness.ts) and
// wraps each iteration in `process.cpuUsage()` deltas.
//
// Output: benchmarks/results/cpu-profile.json with { scenarios: [{ name, cpu_us_per_op, iterations, wall_ms }] }
//
// Usage: node benchmarks/cpu-profile.mjs [--heavy]

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  sendBinaryViaLibrary,
  sendStructuredViaLibrary,
  sendNaive,
} from "./helpers/node-harness.ts";

const HEAVY = process.argv.includes("--heavy") || process.env.IFB_BENCH_HEAVY === "1";

const SIZES = [
  [1024, "1KB"],
  [64 * 1024, "64KB"],
  [1 * 1024 * 1024, "1MB"],
  [16 * 1024 * 1024, "16MB"],
  ...(HEAVY ? [[256 * 1024 * 1024, "256MB"]] : []),
];

// Iteration counts calibrated so each scenario runs for ~200ms total wall time
function iterationsFor(bytes) {
  if (bytes >= 256 * 1024 * 1024) return 3;
  if (bytes >= 16 * 1024 * 1024) return 10;
  if (bytes >= 1024 * 1024) return 50;
  if (bytes >= 64 * 1024) return 300;
  return 1000;
}

const scenarios = [];

async function profile(name, fn, bytes, iterations) {
  // Warm up (exclude from measurement — JIT stabilisation)
  for (let i = 0; i < Math.max(2, Math.floor(iterations / 10)); i++) {
    await fn(bytes);
  }

  const cpuBefore = process.cpuUsage();
  const wallBefore = performance.now();
  for (let i = 0; i < iterations; i++) {
    await fn(bytes);
  }
  const wallAfter = performance.now();
  const cpuAfter = process.cpuUsage(cpuBefore);

  const cpuTotalUs = cpuAfter.user + cpuAfter.system;
  const wallMs = wallAfter - wallBefore;
  const cpuPerOpUs = cpuTotalUs / iterations;
  const cpuUtilization = (cpuTotalUs / 1000) / wallMs; // 0..1 (>1 means multiple cores)

  console.log(
    `  ${name.padEnd(45)} cpu=${cpuPerOpUs.toFixed(1).padStart(8)} us/op  util=${(cpuUtilization * 100).toFixed(0)}%  wall=${wallMs.toFixed(0)}ms  iters=${iterations}`,
  );

  scenarios.push({
    name,
    payloadBytes: bytes,
    iterations,
    wall_ms: wallMs,
    cpu_total_us: cpuTotalUs,
    cpu_user_us: cpuAfter.user,
    cpu_system_us: cpuAfter.system,
    cpu_us_per_op: cpuPerOpUs,
    cpu_utilization: cpuUtilization,
  });
}

console.log("CPU profile — Node 22, process.cpuUsage() deltas\n");

for (const [bytes, label] of SIZES) {
  const iters = iterationsFor(bytes);
  console.log(`${label}:`);
  await profile(`library (transferable) [${label}]`, sendBinaryViaLibrary, bytes, iters);
  await profile(`library (structured-clone) [${label}]`, sendStructuredViaLibrary, bytes, iters);
  await profile(`naive postMessage [${label}]`, sendNaive, bytes, iters);
  console.log("");
}

const artifact = {
  timestamp: new Date().toISOString(),
  node: process.versions.node,
  env: "node",
  method: "process.cpuUsage() delta across iterations (user + system µs)",
  scenarios,
};

const outDir = "benchmarks/results";
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "cpu-profile.json");
writeFileSync(outPath, JSON.stringify(artifact, null, 2));

console.log(`CPU profile written to ${outPath}`);
