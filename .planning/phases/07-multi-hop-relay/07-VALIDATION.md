---
phase: 7
slug: multi-hop-relay
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-21
---

# Phase 7 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| Framework | vitest 4.x Node env |
| Quick run | `pnpm vitest run src/relay tests/integration/relay-` |
| Full suite | `pnpm lint && pnpm exec tsc --noEmit && pnpm test` |
| Estimated runtime | Quick ~5s · Full ~25s |

## Wave 0 Requirements

- [ ] `src/relay/` directory created
- [ ] `src/channel/channel.ts` has `onRawDataFrame`, `onRawControlFrame`, `sendRawFrame` hooks added (Task 1)

## Manual-Only Verifications

| Behavior | Why Manual |
|----------|-----------|
| Three-hop topology in a real browser (worker → main thread relay → sandboxed iframe) | Phase 9 Playwright scenario |

## Validation Sign-Off

- [ ] All tasks have automated verify
- [ ] Three integration tests pass: end-to-end 10 MB, heap-bounded under slow consumer, cancel < 100 ms
- [ ] Stream ID translation covered by unit tests
- [ ] `nyquist_compliant: true` after execution
