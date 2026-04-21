---
phase: 9
slug: cross-browser-e2e
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-21
---

# Phase 9 — Validation Strategy

## Infrastructure
Playwright 1.59 + Node fixture server. Quick: `pnpm test:e2e:local` (chromium + firefox). Full: `pnpm test:e2e` (all 3). CI: ubuntu-latest with --with-deps.

## Wave 0
- `e2e/fixtures/server.ts` ready
- `dist/` pre-built before specs run
- `package.json` adds `test:e2e:local` script

## Manual-Only Verifications
- WebKit locally (ICU limitation) — CI covers

## Sign-off
- [ ] All three specs pass in chromium + firefox locally
- [ ] CI job passes all three browsers
- [ ] `nyquist_compliant: true` after execution
