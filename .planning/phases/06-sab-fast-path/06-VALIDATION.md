---
phase: 6
slug: sab-fast-path
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-21
---

# Phase 6 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| Framework | vitest 4.x Node env + fast-check |
| Quick run | `pnpm vitest run src/transport/sab-ring tests/integration/sab-` |
| Full suite | `pnpm lint && pnpm exec tsc --noEmit && pnpm test` |
| Estimated runtime | Quick ~4s · Full ~20s |

## Sampling Rate

- After every task commit: scoped vitest run for the touched module
- Before verify: full suite + benchmark comparison run (`pnpm bench:fast`)

## Wave 0 Requirements

- [ ] `src/transport/sab-ring.ts` stub file
- [ ] `src/transport/sab-capability.ts` stub file
- [ ] Channel options extended with `sab?: boolean` and `sabBufferSize?: number`

## Manual-Only Verifications

| Behavior | Why Manual |
|----------|-----------|
| Real-browser COOP/COEP headers enabling SAB | Requires a fixture HTTP server + Playwright; deferred to Phase 9 |

Every other Phase 6 behavior is automatable in Node.

## Validation Sign-Off

- [ ] All tasks have automated verify
- [ ] Ring buffer unit tests cover wrap, terminator, capacity limits
- [ ] Integration test verifies end-to-end SAB path + fallback
- [ ] Benchmark scenario added to baseline.json
- [ ] `nyquist_compliant: true` after execution
