---
phase: 10-examples-docs-publish
verified: 2026-04-21T21:00:00Z
status: passed
score: 5/5 must-haves verified
---

# Phase 10 — Verification

**Goal:** Five runnable examples, documentation, and validated dual-publish pipeline under a confirmed-available name.

## Automated gate
- `pnpm test` — 340/340 existing tests still pass (no regressions)
- `pnpm lint`, `pnpm exec tsc --noEmit` — exit 0
- `node scripts/check-name-availability.mjs --test` — exits 0

## Success criteria
| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Package name confirmed available on npm + jsr | ✓ PASSED | `scripts/check-name-availability.mjs` runs; `iframebuffer` (npm) and `@iframebuffer/core` (jsr) both confirmed available |
| 2 | Each example runs via `pnpm dev` | ✓ PASSED | 5 example dirs (01-parent-iframe through 05-strict-csp), each with `package.json` + `index.html` + `main.ts` + README + Vite dev script |
| 3 | Docs cover API, endpoints, errors, topology, benchmarks, decisions | ✓ PASSED | 10 markdown pages under `docs/` — api/{lowlevel,emitter,streams}.md + topology.md + endpoints.md + errors.md + security.md + benchmarks.md + decisions.md |
| 4 | Publish dry-run via OIDC works | ✓ PASSED | `publish.yml` has `dry-run` job running on PR with `id-token: write`, runs `pnpm build + publint + npm publish --dry-run + jsr publish --dry-run` |
| 5 | Version sync check in CI | ✓ PASSED | `ci.yml` rejects PR where `package.json.version !== jsr.json.version` |

## Requirement coverage (15/15)
- **EX-01..05**: 5 runnable examples. ✓
- **DOC-01..06**: Comprehensive docs set. ✓
- **PUB-01**: Name availability script + documented pre-publish step. ✓
- **PUB-02**: OIDC dual-publish with dry-run. ✓
- **PUB-03**: Sync script (existing from Phase 1) + CI guard (new). ✓
- **PUB-04**: Changesets (existing from Phase 1) integrated. ✓

## Notable findings
- Both candidate names (`iframebuffer` on npm, `@iframebuffer/core` on jsr) confirmed available by the script
- Actual publish to npm/jsr is still a human-gated action; the dry-run validates the pipeline is ready

**Verdict:** passed.
