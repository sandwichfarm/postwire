#!/usr/bin/env node

/**
 * Tree-shake verification script (API-04).
 *
 * Verifies that importing only `createLowLevelStream` from the built dist
 * does not pull in createStream (ReadableStream/WritableStream) or
 * createEmitterStream (TypedEmitter) code into a consumer bundle.
 *
 * Strategy:
 *   1. Build the library (pnpm build).
 *   2. Write a minimal caller that imports only createLowLevelStream.
 *   3. Bundle the caller against dist/index.js using esbuild (tree-shaking on).
 *   4. Grep the bundle output for adapter-unique identifiers:
 *        - "ReadableStream"  — only in adapters/streams.ts
 *        - "WritableStream"  — only in adapters/streams.ts
 *        - "TypedEmitter"    — only in adapters/emitter.ts
 *   5. If any of those strings appear, exit 1 (tree-shaking failed).
 *   6. If none appear, exit 0 (tree-shaking verified).
 *
 * Note: The check looks for the *constructor call* string in the bundle, not
 * just a comment or type annotation. esbuild strips all TypeScript types and
 * comments in bundle mode, so any remaining "ReadableStream" / "WritableStream"
 * / "TypedEmitter" text is live runtime code.
 */

import { exec } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const PROJECT_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const DIST_INDEX = path.join(PROJECT_ROOT, "dist", "index.js");
const ESBUILD_BIN = path.join(PROJECT_ROOT, "node_modules", ".bin", "esbuild");

(async () => {
  // ---------------------------------------------------------------------------
  // Step 1: Build the library
  // ---------------------------------------------------------------------------
  console.log("Step 1: Building library...");
  try {
    await execAsync("pnpm build", { cwd: PROJECT_ROOT });
    console.log("  Build complete.");
  } catch (err) {
    console.error("  Build failed:", err.stderr || err.message);
    process.exit(1);
  }

  if (!fs.existsSync(DIST_INDEX)) {
    console.error(`  dist/index.js not found at ${DIST_INDEX}`);
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // Step 2: Write minimal caller
  // ---------------------------------------------------------------------------
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ibuf-tree-shake-"));
  const callerFile = path.join(tmpDir, "caller.mjs");
  const bundleFile = path.join(tmpDir, "bundle.mjs");

  // The caller imports ONLY createLowLevelStream — all other exports must be
  // eliminated by the bundler.
  fs.writeFileSync(
    callerFile,
    `import { createLowLevelStream } from ${JSON.stringify(DIST_INDEX)};
// Prevent the import from being dead-code-eliminated itself
export { createLowLevelStream };
`,
  );

  // ---------------------------------------------------------------------------
  // Step 3: Bundle with esbuild (tree-shaking enabled by default in bundle mode)
  // ---------------------------------------------------------------------------
  console.log("Step 2: Bundling minimal caller with esbuild...");
  const esbuildCmd = [
    JSON.stringify(ESBUILD_BIN),
    JSON.stringify(callerFile),
    `--outfile=${JSON.stringify(bundleFile)}`,
    "--bundle",
    "--format=esm",
    "--platform=node",
    "--tree-shaking=true",
    "--log-level=error",
  ].join(" ");

  try {
    await execAsync(esbuildCmd, { cwd: PROJECT_ROOT });
    console.log("  Bundle complete.");
  } catch (err) {
    console.error("  esbuild failed:", err.stderr || err.message);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // Step 4: Inspect bundle for unused adapter identifiers
  // ---------------------------------------------------------------------------
  console.log("Step 3: Inspecting bundle for unused adapter code...");
  const bundleContent = fs.readFileSync(bundleFile, "utf8");

  // These strings only appear as runtime code in the respective adapter files.
  // esbuild strips type annotations and comments, so any remaining occurrence
  // is live JavaScript.
  const forbidden = [
    { pattern: "ReadableStream", adapter: "adapters/streams.ts" },
    { pattern: "WritableStream", adapter: "adapters/streams.ts" },
    { pattern: "TypedEmitter", adapter: "adapters/emitter.ts" },
  ];

  let failed = false;
  for (const { pattern, adapter } of forbidden) {
    if (bundleContent.includes(pattern)) {
      console.error(`  FAIL: "${pattern}" found in bundle — ${adapter} was NOT tree-shaken out.`);
      failed = true;
    } else {
      console.log(`  OK: "${pattern}" absent (${adapter} eliminated).`);
    }
  }

  // Verify the expected export is actually present
  if (!bundleContent.includes("createLowLevelStream")) {
    console.error('  FAIL: "createLowLevelStream" not found in bundle — export missing.');
    failed = true;
  } else {
    console.log('  OK: "createLowLevelStream" present in bundle.');
  }

  // ---------------------------------------------------------------------------
  // Clean up temp files
  // ---------------------------------------------------------------------------
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // ---------------------------------------------------------------------------
  // Result
  // ---------------------------------------------------------------------------
  if (failed) {
    console.error("\nTree-shake check FAILED — unused adapter code present in bundle.");
    process.exit(1);
  }

  console.log(
    "\nTree-shake check PASSED — createLowLevelStream import leaves out streams and emitter code.",
  );
  process.exit(0);
})();
