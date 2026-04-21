---
phase: 10
slug: examples-docs-publish
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-21
---

# Phase 10 — Validation Strategy

## Infrastructure
Manual smoke + scripted checks. Quick: `grep` for required files. Full: `pnpm install && pnpm build && pnpm lint`.

## Manual-Only Verifications
- Actual publish to npm / jsr (human-gated; dry-run is automated)
- Visual inspection of docs (optional VitePress preview)
- Running each example in a real browser and confirming the demo works

## Automated Sign-off
- [ ] Required doc files exist
- [ ] 5 example directories exist with package.json + index.html + main.ts + README.md
- [ ] `scripts/check-name-availability.mjs` runs
- [ ] CI version-sync check works (grep-verifiable)
- [ ] Publish dry-run job in publish.yml (grep-verifiable)
- [ ] `pnpm exec tsc --noEmit` exits 0
- [ ] `pnpm lint` exits 0
- [ ] `pnpm test` exits 0 (no regressions)
