#!/usr/bin/env node
// benchmarks/compare.mjs — Regression comparator
// Usage: node benchmarks/compare.mjs <before.json> <after.json> [--threshold N]
// Exit 0 = no regression. Exit 1 = regression detected (or missing file).

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const beforePath = args[0];
const afterPath = args[1];
const thresholdIdx = args.indexOf("--threshold");
const threshold = thresholdIdx > -1 ? Number(args[thresholdIdx + 1]) : 10;

if (!beforePath || !afterPath) {
  console.error(
    "Usage: node benchmarks/compare.mjs <before.json> <after.json> [--threshold N]"
  );
  process.exit(1);
}

let bData, aData;
try {
  bData = JSON.parse(readFileSync(beforePath, "utf8"));
} catch (err) {
  console.error(`Error reading before file '${beforePath}': ${err.message}`);
  process.exit(1);
}
try {
  aData = JSON.parse(readFileSync(afterPath, "utf8"));
} catch (err) {
  console.error(`Error reading after file '${afterPath}': ${err.message}`);
  process.exit(1);
}

let hasRegression = false;
const rows = [];

for (const aScen of aData.scenarios) {
  const bScen = bData.scenarios.find((s) => s.name === aScen.name);
  if (!bScen) continue;

  for (const metric of ["mb_s", "p50_ms", "p75_ms", "p99_ms"]) {
    const bVal = bScen[metric];
    const aVal = aScen[metric];
    if (typeof bVal !== "number" || typeof aVal !== "number" || bVal === 0)
      continue;

    const delta = ((aVal - bVal) / bVal) * 100;
    // Throughput (mb_s): negative delta = regression (lower throughput is worse)
    // Latency (p*_ms): positive delta = regression (higher latency is worse)
    const isRegression =
      metric === "mb_s" ? delta < -threshold : delta > threshold;
    if (isRegression) hasRegression = true;

    rows.push({
      scenario: aScen.name,
      metric,
      before: bVal.toFixed(2),
      after: aVal.toFixed(2),
      delta: (delta >= 0 ? "+" : "") + delta.toFixed(1) + "%",
      status: isRegression ? "FAIL" : "ok",
    });
  }
}

// Print Markdown table
console.log("| Scenario | Metric | Before | After | Delta | Status |");
console.log("|----------|--------|--------|-------|-------|--------|");
for (const r of rows) {
  console.log(
    `| ${r.scenario} | ${r.metric} | ${r.before} | ${r.after} | ${r.delta} | ${r.status} |`
  );
}

if (hasRegression) {
  console.error(`\nFAIL: one or more metrics regressed >${threshold}%`);
  process.exit(1);
} else {
  console.log(`\nPASS: all metrics within ${threshold}% threshold`);
}
