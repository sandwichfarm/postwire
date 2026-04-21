#!/usr/bin/env node
// benchmarks/normalize.mjs — Convert Vitest bench output to simplified schema.
// Usage: node benchmarks/normalize.mjs <vitest.json> <out.json>
// Output schema: { timestamp, node, scenarios: [{ name, payloadBytes, mb_s, p50_ms, p75_ms, p99_ms, samples, rme }] }

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) {
  console.error("Usage: node benchmarks/normalize.mjs <vitest.json> <out.json>");
  process.exit(1);
}

function extractPayloadBytes(name) {
  const mb = name.match(/(\d+)\s*MB/i);
  if (mb) return Number(mb[1]) * 1024 * 1024;
  const kb = name.match(/(\d+)\s*KB/i);
  if (kb) return Number(kb[1]) * 1024;
  return 0;
}

const vitest = JSON.parse(readFileSync(inPath, "utf8"));
const scenarios = [];

// Merge CPU-profile data if available. cpu-profile.json uses the same scenario names
// as bench output, so we can look up by name.
const cpuProfilePath = "benchmarks/results/cpu-profile.json";
let cpuByName = new Map();
if (existsSync(cpuProfilePath)) {
  const cpu = JSON.parse(readFileSync(cpuProfilePath, "utf8"));
  for (const s of cpu.scenarios ?? []) {
    cpuByName.set(s.name, s);
  }
}

for (const file of vitest.files ?? []) {
  for (const group of file.groups ?? []) {
    for (const b of group.benchmarks ?? []) {
      const payloadBytes = extractPayloadBytes(b.name);
      const hz = b.hz;
      const cpu = cpuByName.get(b.name);
      scenarios.push({
        name: b.name,
        payloadBytes,
        mb_s: payloadBytes > 0 ? (payloadBytes * hz) / 1_000_000 : 0,
        hz,
        mean_ms: b.mean,
        p50_ms: b.median,
        p75_ms: b.p75,
        p99_ms: b.p99,
        min_ms: b.min,
        max_ms: b.max,
        samples: b.sampleCount,
        rme: b.rme,
        // BENCH-02 CPU-time estimate (from benchmarks/cpu-profile.mjs — measured separately)
        cpu_us_per_op: cpu?.cpu_us_per_op ?? null,
        cpu_utilization: cpu?.cpu_utilization ?? null,
      });
    }
  }
}

let commit = "local";
try {
  commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
} catch {}

const artifact = {
  timestamp: new Date().toISOString(),
  commit,
  node: process.versions.node,
  env: "node",
  scenarios,
};

writeFileSync(outPath, JSON.stringify(artifact, null, 2));
console.log(`Normalized ${scenarios.length} scenarios → ${outPath}`);
