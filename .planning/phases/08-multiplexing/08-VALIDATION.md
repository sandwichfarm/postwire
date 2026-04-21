---
phase: 8
slug: multiplexing
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-21
---

# Phase 8 — Validation Strategy

## Test Infrastructure
Vitest Node env. Quick: `pnpm vitest run tests/unit/channel/multiplex tests/integration/multiplex-`. Full: `pnpm lint && pnpm exec tsc --noEmit && pnpm test`.

## Key behaviors
- Default single-stream mode unchanged
- Multiplex opt-in via both sides
- HoL-blocking: stalled stream doesn't block others
- Per-stream stats

## Manual-Only Verifications
None — all automatable in Node.

## Sign-off
- [ ] Full test suite green
- [ ] HoL test logs per-stream counts
- [ ] `nyquist_compliant: true` after execution
