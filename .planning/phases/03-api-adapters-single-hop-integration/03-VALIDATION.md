---
phase: 3
slug: api-adapters-single-hop-integration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-21
---

# Phase 3 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (Node env) + fast-check 4.x |
| **Config file** | `vitest.config.ts` — extend `unit` project `include` to cover `tests/integration/**/*.{test,spec}.ts` |
| **Quick run command** | `pnpm vitest run tests/unit/adapters tests/unit/channel` |
| **Full suite command** | `pnpm lint && pnpm exec tsc --noEmit && pnpm test` |
| **Estimated runtime** | Quick ~3s · Full ~20s (slow-consumer heap test adds ~5s) |

## Sampling Rate

- **After every task commit:** scoped vitest run for the touched module
- **After every plan wave:** `pnpm exec tsc --noEmit && pnpm test`
- **Before `/gsd:verify-work`:** full suite green including slow-consumer heap test

## Per-Task Verification Map

*Populated by gsd-planner. Illustrative.*

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command |
|---------|------|------|-------------|-----------|-------------------|
| 3-00-01 | 00 | 0 | — infra | scaffold | `pnpm exec tsc --noEmit && pnpm test` |
| 3-01-01 | 01 | 1 | TOPO-01, CAPABILITY | unit | `pnpm vitest run tests/unit/channel` |
| 3-02-01 | 02 | 2 | API-01, FAST-01 | unit + integration | `pnpm vitest run tests/unit/adapters/lowlevel tests/integration/lowlevel` |
| 3-03-01 | 03 | 2 | API-02 | unit | `pnpm vitest run tests/unit/adapters/emitter` |
| 3-04-01 | 04 | 2 | API-03, FAST-03 | unit + integration | `pnpm vitest run tests/unit/adapters/streams tests/integration/streams` |
| 3-05-01 | 05 | 3 | TEST-02, FAST-02 | integration | `pnpm vitest run tests/integration/mock-endpoint` |
| 3-06-01 | 06 | 3 | API-04 | tree-shake + exports | `pnpm build && node scripts/tree-shake-check.mjs` |

## Wave 0 Requirements

- [ ] `tests/integration/` directory created
- [ ] `tests/helpers/mock-endpoint.ts` scaffolded
- [ ] `vitest.config.ts` updated to include `tests/integration/**`
- [ ] `src/channel/`, `src/adapters/` directories created
- [ ] Phase 2 `Session.close()` patched to accept `finalSeq?: number` parameter (small known stub)

## Manual-Only Verifications

None — all Phase 3 behaviors are automatable in Node env via MockEndpoint. Real-browser cross-context is deferred to Phase 9.

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify
- [ ] No watch-mode flags
- [ ] Wave 0 covers all MISSING refs (integration dir, mock-endpoint helper, Session.close patch)
- [ ] Sampling continuity OK
- [ ] `nyquist_compliant: true` after execution

**Approval:** pending
