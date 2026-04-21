#!/usr/bin/env node
// Check if the currently-configured package names (package.json + jsr.json) are available.
// Exit 0 = available (or test-mode). Exit non-zero = taken.
// Usage: node scripts/check-name-availability.mjs [--test]

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const jsr = JSON.parse(readFileSync("jsr.json", "utf8"));

// npm check: `npm view <name> version` exits 0 if taken, non-0 if available
let npmTaken = true;
try {
  execSync(`npm view ${pkg.name} version`, { stdio: "pipe" });
} catch {
  npmTaken = false;
}

// jsr check: GET meta.json; 200 = taken, 404 = available
let jsrTaken = true;
try {
  const out = execSync(`curl -sI https://jsr.io/${jsr.name}/meta.json`, {
    stdio: "pipe",
  }).toString();
  jsrTaken = !out.includes("404");
} catch {
  jsrTaken = false;
}

console.log(`npm ${pkg.name}: ${npmTaken ? "TAKEN" : "available"}`);
console.log(`jsr ${jsr.name}: ${jsrTaken ? "TAKEN" : "available"}`);

if (process.argv.includes("--test")) process.exit(0);
if (npmTaken || jsrTaken) process.exit(1);
process.exit(0);
