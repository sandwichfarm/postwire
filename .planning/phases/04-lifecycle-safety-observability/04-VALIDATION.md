---
phase: 4
slug: lifecycle-safety-observability
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-21
---

# Phase 4 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x Node env + fast-check + fake timers |
| **Config file** | `vitest.config.ts` (already extended for integration) |
| **Quick run command** | `pnpm vitest run tests/unit/channel tests/integration/lifecycle tests/integration/stats` |
| **Full suite command** | `pnpm lint && pnpm exec tsc --noEmit && pnpm test` |
| **Estimated runtime** | Quick ~4s · Full ~30s (BFCache + heartbeat fake-timer tests fast) |

## Sampling Rate

- **After every task commit:** scoped vitest run for touched module
- **After every plan wave:** `pnpm exec tsc --noEmit && pnpm test`
- **Before `/gsd:verify-work`:** full suite + all 8 LIFE/OBS requirements verified

## Wave 0 Requirements

- [ ] `tests/integration/lifecycle/` directory created
- [ ] `tests/integration/stats/` directory created
- [ ] `ErrorCode` union in `src/types.ts` extended with `CHANNEL_FROZEN`, `CHANNEL_DEAD`, `CREDIT_DEADLOCK`, `REORDER_OVERFLOW`, `ORIGIN_REJECTED`
- [ ] `Channel` in `src/channel/channel.ts` extended with `TypedEmitter` base class for `'error' | 'close' | 'trace' | 'stats'` events
- [ ] `ReorderBuffer.insert()` overflow path wrapped in try/catch inside `Session.receiveFrame()` so it reaches `onError`
- [ ] `disposers: (() => void)[]` array on Channel, using `AbortController` for listener cleanup
- [ ] `channel.options.lifecycle = { bfcache?: boolean, heartbeat?: { intervalMs, timeoutMs } }` type slot

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real BFCache round-trip in a browser | LIFE-01 (partial) | BFCache is browser-only; Node mock covers the detection logic | Deferred to Phase 9 Playwright suite |
| Real SW recycle (browser-induced idle termination) | LIFE-02 (partial) | Node can simulate port silence, not actual SW shutdown | Deferred to Phase 9 |

All other Phase 4 behaviors are automatable via Node event mocks, fake timers, and MockEndpoint.

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify
- [ ] BFCache mock pattern used for LIFE-01 (Node unit test)
- [ ] Fake timers used for LIFE-02 heartbeat timeout
- [ ] MessageChannel port.close() for LIFE-03 teardown (Node)
- [ ] Deferred items noted with Phase 9 link
- [ ] `nyquist_compliant: true` after execution

**Approval:** pending
