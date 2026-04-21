---
phase: 10-examples-docs-publish
plan: "01"
subsystem: docs
tags: [documentation, examples, vite, publish, ci]

requires:
  - phase: 09-e2e-testing
    provides: e2e fixtures (pages/*.html) used as reference patterns for examples

provides:
  - README.md with quickstart and full link tree
  - docs/ markdown set (10 files covering API, topology, endpoints, errors, security, benchmarks, decisions)
  - 5 runnable examples under examples/01-05/ (vite dev server per example)
  - scripts/check-name-availability.mjs with --test flag
  - CI version-sync check (package.json vs jsr.json)
  - publish.yml dry-run job
  - pub:check and pub:dry-run npm scripts

affects:
  - publish-v1 (future)
  - contributors reading docs

tech-stack:
  added:
    - vite ^8.0.0 (root devDependency for example dev servers)
  patterns:
    - Example-per-directory: each has package.json + index.html + main.ts + README.md
    - Docs-as-markdown: plain markdown under docs/ (no VitePress; GitHub-renderable natively)
    - CI version-sync: compare package.json.version === jsr.json.version in CI step

key-files:
  created:
    - README.md
    - docs/api/lowlevel.md
    - docs/api/emitter.md
    - docs/api/streams.md
    - docs/topology.md
    - docs/endpoints.md
    - docs/errors.md
    - docs/security.md
    - docs/benchmarks.md
    - docs/decisions.md
    - examples/01-parent-iframe/{package.json,index.html,iframe.html,main.ts,README.md}
    - examples/02-main-worker/{package.json,index.html,worker.ts,main.ts,README.md}
    - examples/03-three-hop/{package.json,index.html,consumer.html,producer.ts,main.ts,README.md}
    - examples/04-multiplex/{package.json,index.html,main.ts,README.md}
    - examples/05-strict-csp/{package.json,index.html,receiver.html,receiver.js,main.ts,README.md}
    - scripts/check-name-availability.mjs
  modified:
    - tsconfig.json (exclude examples from root typecheck)
    - package.json (pub:check, pub:dry-run scripts; vite devDep)
    - .github/workflows/ci.yml (version-sync step)
    - .github/workflows/publish.yml (dry-run job)

key-decisions:
  - "Plain markdown under docs/ instead of VitePress — zero install, GitHub-renderable, zero config"
  - "examples/N/package.json uses file:../.. dep — no publish needed to run examples locally"
  - "tsconfig.json excludes examples/ so root tsc --noEmit stays clean without per-example tsconfig"
  - "vite added to root devDependencies — examples can hoist from workspace"
  - "receiver.js in example 05 is plain JS to avoid TypeScript friction in CSP iframe"

patterns-established:
  - "Example structure: package.json + index.html + main.ts + README.md per example directory"
  - "Docs link tree in README.md as a table with paths and one-line descriptions"

requirements-completed:
  - EX-01
  - EX-02
  - EX-03
  - EX-04
  - EX-05
  - DOC-01
  - DOC-02
  - DOC-03
  - DOC-04
  - DOC-05
  - DOC-06
  - PUB-01
  - PUB-02
  - PUB-03
  - PUB-04

duration: 9min
completed: 2026-04-21
---

# Phase 10 Plan 01: Examples, Docs, and Publish Pipeline Summary

**README + 10 markdown doc pages + 5 vite-runnable examples + npm/jsr publish dry-run pipeline with CI version-sync**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-04-21T18:37:49Z
- **Completed:** 2026-04-21T18:46:45Z
- **Tasks:** 3
- **Files modified:** 37

## Accomplishments

- Comprehensive README covering install, 10-line quickstart (worker example), feature list, doc link tree, examples table
- 10 markdown doc pages under `docs/` (3 API pages + 7 topic pages) — all GitHub-renderable, no VitePress install required
- 5 runnable examples (01 through 05), each with `package.json` + `index.html` + `main.ts/js` + `README.md` and `pnpm dev` entry
- `scripts/check-name-availability.mjs` with `--test` flag confirming both npm `iframebuffer` and jsr `@iframebuffer/core` are available
- CI version-sync step added to `ci.yml` — fails if `package.json.version !== jsr.json.version`
- `publish.yml` dry-run job runs on PRs: build + publint + `npm publish --dry-run` + `jsr publish --dry-run`
- All 340 existing unit/integration tests continue to pass; lint clean; `tsc --noEmit` clean

## Task Commits

1. **Task 1: README + docs markdown set** — `79b38e4` (docs)
2. **Task 2: Five runnable examples** — `be2a5e4` (feat)
3. **Task 3: Name availability + CI version sync + publish dry-run** — `b3bc22b` (chore)

## Files Created/Modified

- `README.md` — one-liner, install, quickstart, feature list, doc/examples link trees, license
- `docs/api/lowlevel.md` — `createLowLevelStream` signature, send/onChunk/onClose/onError, two-party example
- `docs/api/emitter.md` — `createEmitterStream`, events, write/drain/end, backpressure pattern
- `docs/api/streams.md` — `createStream`, backpressure wiring, pipeTo example, error handling
- `docs/topology.md` — two-party, relay bridge, multiplex; code examples for each
- `docs/endpoints.md` — four adapter factories, SAB capability, origin validation
- `docs/errors.md` — all 10 `ErrorCode` values with description, cause, recovery
- `docs/security.md` — origin validation, strict CSP, COOP/COEP, trust boundaries
- `docs/benchmarks.md` — throughput/latency table from `baseline.json`, key observations, caveats
- `docs/decisions.md` — WASM gate, SAB path, relay raw-frame, mux ID, wildcard refusal
- `examples/01-parent-iframe/` — parent → iframe 1 MB transfer with progress bar
- `examples/02-main-worker/` — main thread → worker stream with delivery rate reporting
- `examples/03-three-hop/` — worker producer → relay → sandboxed iframe consumer
- `examples/04-multiplex/` — two concurrent streams (file + control) over one channel
- `examples/05-strict-csp/` — sandboxed iframe with CSP meta tag receives 512 KB
- `scripts/check-name-availability.mjs` — npm + jsr name check, `--test` bypass mode
- `tsconfig.json` — `examples` added to exclude list
- `package.json` — `pub:check`, `pub:dry-run` scripts; vite devDep
- `.github/workflows/ci.yml` — version-sync step
- `.github/workflows/publish.yml` — dry-run job

## Decisions Made

- Plain markdown under `docs/` instead of VitePress — GitHub renders it natively with zero config; VitePress can be added later as an enhancement without touching content
- `examples/N/package.json` uses `"iframebuffer": "file:../.."` — examples are self-contained and run directly from the local build without publishing
- `tsconfig.json` excludes `examples/` from root typecheck — avoids needing a separate tsconfig per example while keeping the root tsc clean
- `receiver.js` in example 05 is plain JS — avoids TypeScript compilation friction inside a strict-CSP iframe context

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Import order fix in check-name-availability.mjs**
- **Found during:** Task 3 — lint step
- **Issue:** Biome requires alphabetical import sort; `node:fs` before `node:child_process` failed lint
- **Fix:** Reordered imports and reformatted long `execSync` call to satisfy Biome formatter
- **Files modified:** `scripts/check-name-availability.mjs`
- **Verification:** `pnpm lint` exits 0 after fix
- **Committed in:** `b3bc22b` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — import ordering for Biome)
**Impact on plan:** Trivial formatting fix; no scope change.

## Issues Encountered

None — plan executed exactly as written beyond the Biome import-sort fix.

## Known Stubs

None — documentation is complete; examples are minimal but functional; no placeholder text or "coming soon" entries.

## User Setup Required

None — no external service configuration required. Publishing to npm/jsr requires the human operator to run `pnpm pub:dry-run` first (verified by the CI dry-run job), then tag a release to trigger the actual publish.

## Next Phase Readiness

Phase 10 is the final milestone deliverable. All v1 requirements are complete:
- EX-01..05, DOC-01..06, PUB-01..04 now complete
- 69/69 v1 requirements shipped
- Before publishing: verify name availability (`pnpm pub:check`), then tag a `v*` release

---

*Phase: 10-examples-docs-publish*
*Completed: 2026-04-21*
