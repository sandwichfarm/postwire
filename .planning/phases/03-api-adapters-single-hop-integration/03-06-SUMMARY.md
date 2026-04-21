---
phase: 03-api-adapters-single-hop-integration
plan: "06"
subsystem: index-exports
tags: [tree-shaking, named-exports, api-04, esbuild, bundle-analysis]

# Dependency graph
requires:
  - phase: 03-api-adapters-single-hop-integration
    plan: "02"
    provides: createLowLevelStream adapter
  - phase: 03-api-adapters-single-hop-integration
    plan: "03"
    provides: createEmitterStream adapter
  - phase: 03-api-adapters-single-hop-integration
    plan: "04"
    provides: createStream WHATWG Streams adapter

provides:
  - src/index.ts — complete public API surface: all three adapters + Channel + StreamError
  - scripts/tree-shake-check.mjs — esbuild-based bundle analysis proving tree-shaking correctness

affects:
  - Phase 4 (lifecycle): imports createChannel and StreamError from index
  - Phase 5 (benchmarks): imports createStream from index
  - Phase 6 (SAB): imports createStream from index
  - All future phases that import from the library

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "esbuild bundle analysis: bundle minimal caller, grep output for adapter-unique class names"
    - "Named exports from adapters/*.ts — each adapter independently tree-shakeable"

key-files:
  created:
    - scripts/tree-shake-check.mjs
  modified:
    - src/index.ts
    - package.json

key-decisions:
  - "esbuild (already a devDep via tsdown) used for bundle analysis — no new dependencies needed"
  - "Grep for TypedEmitter (class name unique to emitter.ts) rather than createEmitterStream (which could appear in a re-export stub)"
  - "Script bundles against dist/index.js (not src) to validate the actual published output"

requirements-completed: [API-04]

# Metrics
duration: 2min
completed: 2026-04-21
---

# Phase 03 Plan 06: Named Exports + Tree-Shake Verification Summary

**Named exports wired for all three adapters + Channel + StreamError; esbuild bundle analysis confirms tree-shaking eliminates unused adapters**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-21T12:38:35Z
- **Completed:** 2026-04-21T12:40:18Z
- **Tasks:** 3
- **Files modified:** 3 (2 modified, 1 created)

## Accomplishments

- Updated `src/index.ts` with full Phase 3 public API surface:
  - `StreamError` class and `ErrorCode` type from `types.ts`
  - `Channel`, `createChannel`, `ChannelOptions` from `channel/channel.ts`
  - `createLowLevelStream`, `LowLevelStream`, `LowLevelOptions` from `adapters/lowlevel.ts`
  - `createEmitterStream`, `EmitterStream`, `EmitterOptions` from `adapters/emitter.ts`
  - `createStream`, `StreamsPair`, `StreamsOptions` from `adapters/streams.ts`
  - All Phase 1 exports retained
- Verified zero cross-adapter imports (each adapter depends only on Channel and types)
- Created `scripts/tree-shake-check.mjs`:
  - Builds the library via `pnpm build`
  - Writes a minimal caller importing only `createLowLevelStream` from `dist/index.js`
  - Bundles it with esbuild (`--bundle --tree-shaking=true`) against the dist output
  - Asserts `ReadableStream`, `WritableStream` (streams.ts), and `TypedEmitter` (emitter.ts) are absent from the bundle
  - Asserts `createLowLevelStream` is present (export correctly included)
  - Exits 0 (PASS) confirming unused adapters are eliminated
- Added `tree-shake:check` npm script to `package.json`
- Confirmed `sideEffects: false` already present in `package.json` from Phase 1
- Full test suite: 262/262 passing; `pnpm exec tsc --noEmit` exits 0

## Task Commits

1. **Task 1: Phase 3 named exports** — `d8962e3` (export)
2. **Task 2: Tree-shake verification script** — `0d4c7a8` (script)
3. **Task 3: sideEffects flag** — already set from Phase 1 (no commit needed)

## Files Created/Modified

- `src/index.ts` — Phase 3 named exports added alongside Phase 1 exports
- `scripts/tree-shake-check.mjs` — esbuild-based tree-shake verification script
- `package.json` — `tree-shake:check` script added

## Decisions Made

- **esbuild for bundle analysis**: esbuild is already present as a transitive devDep (tsdown depends on it). Using it directly avoids adding any new dependency. The `node_modules/.bin/esbuild` path is resolved relative to PROJECT_ROOT.
- **Grep target `TypedEmitter`**: The class name `TypedEmitter` is a more reliable signal than `createEmitterStream` — if tree-shaking were partial, the class body (with `ReadableStream`-like runtime strings) would appear. Grep on the class name directly.
- **Bundle against `dist/index.js`**: The script validates the actual published artifact, not the source. This catches any bundler configuration issues that would affect consumers.
- **Temp dir cleanup**: Uses `os.tmpdir()` + `mkdtemp` so temp files land in `/tmp/ibuf-tree-shake-*` and are cleaned up on success or failure (never left in the project tree).

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written. The tree-shake script uses esbuild for proper bundle analysis (environment notes confirmed this was the intent), matching the plan's guidance.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/index.ts (Phase 3 exports present)
- FOUND: scripts/tree-shake-check.mjs
- FOUND: package.json (tree-shake:check script and sideEffects: false)
- FOUND: commit d8962e3 (named exports)
- FOUND: commit 0d4c7a8 (tree-shake script)
- VERIFIED: `node scripts/tree-shake-check.mjs` exits 0
- VERIFIED: `pnpm exec tsc --noEmit` exits 0
- VERIFIED: `pnpm test` 262/262 passing
- VERIFIED: `pnpm build` exits 0

---
*Phase: 03-api-adapters-single-hop-integration*
*Completed: 2026-04-21*
