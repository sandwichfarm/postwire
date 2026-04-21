---
phase: 01-scaffold-wire-protocol-foundation
plan: "01"
subsystem: infra
tags: [typescript, tsdown, vitest, playwright, biome, changesets, pnpm, publint, jsr]

# Dependency graph
requires: []
provides:
  - package.json with two-entry exports map (. and ./wasm), ESM-only, zero runtime deps
  - pnpm-lock.yaml with exact pinned versions (no ^ or ~) for all 13 devDependencies
  - tsconfig.json with TypeScript 6, isolatedDeclarations, moduleResolution bundler
  - tsdown.config.ts building src/index.ts and src/wasm.ts to dist/
  - biome.json lint+format config for Biome 2.4.12
  - vitest.config.ts with unit project (Node env), browser mode commented-out placeholder
  - playwright.config.ts with three projects: chromium, firefox, webkit
  - .changeset/config.json for semver management + npm/JSR dual publish
  - scripts/sync-jsr-version.mjs to keep jsr.json in sync with package.json versions
  - jsr.json with @iframebuffer/core scoped placeholder name
  - src/index.ts and src/wasm.ts stubs producing four dist artifacts
  - tests/e2e/smoke.spec.ts Playwright harness smoke test
  - pnpm build, pnpm lint, pnpm test all exit 0
affects: [01-02, 01-03, 01-04, all subsequent plans in phase 01]

# Tech tracking
tech-stack:
  added:
    - typescript@6.0.3
    - tsdown@0.21.9
    - vitest@4.1.4
    - "@vitest/browser@4.1.4"
    - "@vitest/coverage-v8@4.1.4"
    - "@playwright/test@1.59.1"
    - "@biomejs/biome@2.4.12"
    - "@changesets/cli@2.31.0"
    - publint@0.3.18
    - "@arethetypeswrong/cli@0.18.2"
    - tinybench@6.0.0
    - tsx@4.21.0
    - "@types/node@25.6.0"
  patterns:
    - ESM-only library with types-first exports condition order (types before import)
    - Vitest projects API (not workspace file) for multi-environment config
    - Biome 2.x files.includes with !! prefix negation for ignore patterns
    - pnpm strict hoisting (shamefully-hoist=false) for zero-runtime-dep guarantee

key-files:
  created:
    - package.json
    - pnpm-lock.yaml
    - tsconfig.json
    - tsdown.config.ts
    - biome.json
    - vitest.config.ts
    - playwright.config.ts
    - .changeset/config.json
    - scripts/sync-jsr-version.mjs
    - jsr.json
    - .gitignore
    - .npmrc
    - src/index.ts
    - src/wasm.ts
    - tests/e2e/smoke.spec.ts
  modified:
    - package.json (types-first exports condition order fix)

key-decisions:
  - "Biome 2.4.12 uses files.includes with !! prefix for ignore patterns, not files.ignore — RESEARCH.md pattern was based on stale docs"
  - "organizeImports in Biome 2.x lives under assist.actions.source, not as a top-level key"
  - "Vitest 4 exits code 1 with no test files; passWithNoTests: true added to vitest.config.ts"
  - "publint requires types condition before import in exports map (order-sensitive resolution)"
  - "WebKit on Arch Linux incompatible with Playwright 1.59.1 (needs ICU 74, system has ICU 78 ABI-incompatible); CI will pass via ubuntu-latest + --with-deps"
  - ".gitignore tracks .changeset/config.json but ignores individual *.md changeset files"

patterns-established:
  - "types before import in exports conditions (required by publint)"
  - "pnpm install with exact versions (no ^ or ~) in devDependencies"
  - "biome check . && publint as unified lint command"

requirements-completed: [COMP-02, COMP-04]

# Metrics
duration: 9min
completed: 2026-04-21
---

# Phase 01 Plan 01: Scaffold + Wire Protocol Foundation Summary

**Complete TypeScript library toolchain bootstrapped: tsdown 0.21.9 + Vitest 4 + Playwright 1.59.1 + Biome 2.4.12 + Changesets, producing publint-clean two-entry ESM package with zero runtime deps**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-04-21T09:53:36Z
- **Completed:** 2026-04-21T10:03:00Z
- **Tasks:** 3 (+ 1 implicit fix task)
- **Files modified:** 15

## Accomplishments

- Complete toolchain wired in one pass: tsdown builds, Biome lints, Vitest runs, Playwright harness works
- publint reports zero errors against two-entry exports map (. and ./wasm) with correct types-first condition order
- pnpm build, pnpm lint, pnpm test all exit 0; pnpm test:e2e passes on chromium and firefox
- Zero runtime dependencies enforced by pnpm strict hoisting + no `dependencies` field in package.json
- src/wasm.ts stub ensures dist/wasm.js + dist/wasm.d.ts exist so publint passes without activating WASM yet

## Task Commits

Each task was committed atomically:

1. **Task 1: Initialize package manifest, lockfile, and all config files** - `a2b340e` (chore)
2. **Task 2: Create placeholder source files** - `f02cd78` (feat) — includes exports map types-first fix
3. **Task 3: Write Playwright smoke test** - `2fd27e1` (test)
4. **Deviation fixes: Biome 2.4.12 API + Vitest passWithNoTests** - `c5945d9` (fix)

## Files Created/Modified

- `package.json` — ESM manifest, two-entry exports map (types before import), zero runtime deps, exact devDep versions
- `pnpm-lock.yaml` — generated lockfile with all 262 packages resolved
- `tsconfig.json` — TS 6, moduleResolution bundler, isolatedDeclarations, strict, rootDir src/
- `tsdown.config.ts` — dual entry (index + wasm), ESM-only, dts: true, platform: browser
- `biome.json` — Biome 2.4.12 with corrected files.includes negation and assist.actions.source organizeImports
- `vitest.config.ts` — unit project (Node env), browser mode commented out, passWithNoTests: true
- `playwright.config.ts` — three projects (chromium, firefox, webkit), testDir: tests/e2e
- `.changeset/config.json` — access: public, baseBranch: main
- `scripts/sync-jsr-version.mjs` — reads package.json, writes jsr.json version on release
- `jsr.json` — @iframebuffer/core placeholder, version 0.0.0, src exports for TypeScript source publishing
- `.gitignore` — ignores node_modules, dist, coverage, playwright artifacts; tracks .changeset/config.json
- `.npmrc` — strict-peer-dependencies=false, shamefully-hoist=false
- `src/index.ts` — empty export stub (populated in Plans 02/03)
- `src/wasm.ts` — reserved WASM slot stub (Phase 5)
- `tests/e2e/smoke.spec.ts` — Playwright smoke test via page.setContent + toHaveTitle

## Decisions Made

- Biome 2.4.12 does NOT have a top-level `organizeImports` key — moved to `assist.actions.source.organizeImports`
- Biome 2.x `files.ignore` is replaced by `!!` prefix negation in `files.includes` array
- `publint` requires `types` condition before `import` in exports entries (conditions are order-sensitive)
- Vitest 4 exits code 1 with no test files by default — added `passWithNoTests: true` for pre-test-file-exists phase
- `.gitignore` excludes `.changeset/*.md` (generated changeset files) but tracks `config.json`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed exports map condition order**
- **Found during:** Task 2 (publint run)
- **Issue:** `publint` rejected `import` before `types` in exports conditions — TypeScript can't resolve types when import comes first
- **Fix:** Swapped condition order: `types` before `import` in both `.` and `./wasm` entries
- **Files modified:** package.json
- **Verification:** `pnpm exec publint` reports "All good!"
- **Committed in:** f02cd78 (part of Task 2 commit)

**2. [Rule 1 - Bug] Fixed Biome 2.4.12 config keys**
- **Found during:** Task 3 verification (pnpm lint)
- **Issue:** RESEARCH.md Pattern 4 used `files.ignore` (Biome 1.x) and top-level `organizeImports` (Biome 1.x) — both removed/moved in Biome 2.x
- **Fix:** `files.ignore` → `files.includes` with `!!` prefix negation; `organizeImports` → `assist.actions.source.organizeImports`; also fixed `!!dist/**` → `!!dist` per Biome 2.2+ folder ignore semantics
- **Files modified:** biome.json
- **Verification:** `pnpm lint` reports "Checked 11 files in 2ms. No fixes applied."
- **Committed in:** c5945d9

**3. [Rule 1 - Bug] Fixed sync-jsr-version.mjs style lint error**
- **Found during:** Task 3 verification (pnpm lint)
- **Issue:** Biome `style/useTemplate` rule requires template literals for string concatenation
- **Fix:** Changed `JSON.stringify(...) + "\n"` to `` `${JSON.stringify(...)}\n` ``
- **Files modified:** scripts/sync-jsr-version.mjs
- **Verification:** biome check passes
- **Committed in:** c5945d9

**4. [Rule 1 - Bug] Fixed smoke test import order and formatting**
- **Found during:** Task 3 verification (pnpm lint)
- **Issue:** Biome organizeImports requires alphabetical order: `expect` before `test`; also reformatted multiline arrow to single-line per lineWidth 100
- **Fix:** Reordered import, reformatted function signature
- **Files modified:** tests/e2e/smoke.spec.ts
- **Verification:** biome check passes
- **Committed in:** c5945d9

**5. [Rule 2 - Missing Critical] Added passWithNoTests to vitest.config.ts**
- **Found during:** Task 3 verification (pnpm test)
- **Issue:** Vitest 4 exits code 1 when no test files found; `pnpm test` was failing before Plan 02 creates test files
- **Fix:** Added `passWithNoTests: true` to root test config
- **Files modified:** vitest.config.ts
- **Verification:** `pnpm test` exits 0 with "No test files found, exiting with code 0"
- **Committed in:** c5945d9

---

**Total deviations:** 5 auto-fixed (4 Rule 1 bugs, 1 Rule 2 missing critical)
**Impact on plan:** All auto-fixes necessary. RESEARCH.md patterns were written against Biome 1.x behavior; Biome 2.4.12 changed several config key names. publint types-first requirement is a correctness fix.

## Issues Encountered

- **WebKit on Arch Linux:** Playwright 1.59.1 WebKit binary (Ubuntu build) requires `libicudata.so.74` but Arch Linux ships `libicudata.so.78`. ICU symbols are versioned by major (e.g., `ureldatefmt_format_74` vs `ureldatefmt_format_78`) making symlinks insufficient. WebKit cannot launch locally. **Chromium and Firefox pass locally.** WebKit will pass in CI (ubuntu-latest + `playwright install --with-deps`). This is documented in the CI workflow pattern (RESEARCH.md Pattern 10).

## Known Stubs

- `src/index.ts` — `export {}` placeholder; no API surface yet. Plan 02 will populate with framing types.
- `src/wasm.ts` — `export {}` reserved slot. Phase 5 benchmarks will decide whether WASM activates.

These stubs are intentional per plan design — they exist to satisfy publint and the two-entry exports map, not to expose any functionality.

## User Setup Required

None — no external service configuration required. WebKit for local E2E will work automatically on Ubuntu (CI) or after `sudo pnpm exec playwright install-deps` on Arch.

## Next Phase Readiness

- **Plan 01-02** (framing types + encode/decode) can start immediately — toolchain is ready
- **Plan 01-03** (transport adapters) similarly unblocked
- **Plan 01-04** (GitHub Actions CI) should reference exact commands verified here: `pnpm build && pnpm lint && pnpm test && pnpm test:e2e`
- WebKit local testing requires system ICU 74 — either install `icu74-compat` from AUR (`yay -S icu74-compat`) or rely on CI for webkit coverage

## Self-Check: PASSED

All 15 created files confirmed present on disk. All 4 task commits confirmed in git log.

| Check | Status |
|-------|--------|
| package.json | FOUND |
| pnpm-lock.yaml | FOUND |
| tsconfig.json | FOUND |
| tsdown.config.ts | FOUND |
| biome.json | FOUND |
| vitest.config.ts | FOUND |
| playwright.config.ts | FOUND |
| .changeset/config.json | FOUND |
| scripts/sync-jsr-version.mjs | FOUND |
| jsr.json | FOUND |
| .gitignore | FOUND |
| .npmrc | FOUND |
| src/index.ts | FOUND |
| src/wasm.ts | FOUND |
| tests/e2e/smoke.spec.ts | FOUND |
| commit a2b340e | FOUND |
| commit f02cd78 | FOUND |
| commit 2fd27e1 | FOUND |
| commit c5945d9 | FOUND |

---
*Phase: 01-scaffold-wire-protocol-foundation*
*Completed: 2026-04-21*
