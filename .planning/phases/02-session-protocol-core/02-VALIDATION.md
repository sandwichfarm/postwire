---
phase: 2
slug: session-protocol-core
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-21
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (Node env) + fast-check 4.7.x (property tests) |
| **Config file** | `vitest.config.ts` (already in place; uses Node env by default) |
| **Quick run command** | `pnpm vitest run src/session tests/unit/session` |
| **Full suite command** | `pnpm lint && pnpm exec tsc --noEmit && pnpm test` |
| **Estimated runtime** | Quick ~3s · Full ~15s |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run <scoped test>` (scope to the module touched)
- **After every plan wave:** Run `pnpm exec tsc --noEmit && pnpm test`
- **Before `/gsd:verify-work`:** Full suite + FSM/reorder property tests must be green
- **Max feedback latency:** 10 seconds quick, 30 seconds full

---

## Per-Task Verification Map

*Populated by gsd-planner. The entries below are illustrative and will be confirmed or amended in plan authoring.*

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 2-00-01 | 00 | 0 | — (infra) | wave-0 | `pnpm add -D fast-check` | ❌ W0 | ⬜ pending |
| 2-01-01 | 01 | 1 | SESS-01, TEST-01 | unit + fuzz | `pnpm vitest run src/session/reorder-buffer` | ❌ W0 | ⬜ pending |
| 2-02-01 | 02 | 1 | SESS-02, SESS-03 | unit + fake-timer | `pnpm vitest run src/session/credit-window` | ❌ W0 | ⬜ pending |
| 2-03-01 | 03 | 1 | SESS-04 | unit + invariant | `pnpm vitest run src/session/chunker` | ❌ W0 | ⬜ pending |
| 2-04-01 | 04 | 1 | SESS-05, TEST-06 | unit + property | `pnpm vitest run src/session/fsm` | ❌ W0 | ⬜ pending |
| 2-05-01 | 05 | 2 | SESS-06 | cross-module fuzz | `pnpm vitest run tests/unit/session/session-integration` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `package.json` devDependency: `fast-check@^4.7.0`
- [ ] `src/session/` directory created (empty)
- [ ] `tests/unit/session/` directory created
- [ ] All Phase 2 modules (reorder-buffer, credit-window, chunker, fsm, session) will get `.test.ts` files co-located or in `tests/unit/session/`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| *(none)* | — | All Phase 2 behaviors are pure-TS and automatable in Node | — |

Every Phase 2 behavior has automated verification via Vitest + fast-check.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags (CI uses `vitest run`)
- [ ] Feedback latency < 10s quick / 30s full
- [ ] `nyquist_compliant: true` set in frontmatter after execution

**Approval:** pending
