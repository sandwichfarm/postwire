---
phase: 5
slug: benchmark-harness
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-21
---

# Phase 5 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x bench mode + tinybench 6.x in browser mode + Playwright 1.59 |
| **Config file** | `vitest.bench.config.ts` (new — scoped to `benchmarks/scenarios/**`) |
| **Quick run** | `pnpm bench --project=chromium --exclude=heavy` |
| **Full suite** | `pnpm bench` (all browsers, all sizes except 256 MB); `pnpm bench --heavy` adds 256 MB |
| **Runtime (local)** | ~2 min Chromium+Firefox (excl. heavy) |
| **Runtime (CI)** | ~10 min all browsers + all sizes (nightly) |

## Sampling Rate

- **After every task commit:** scoped scenario run if the touched module affects the benchmark output; otherwise skip
- **Wave completion:** run one full scenario to confirm harness stability
- **Before verify-work:** full `pnpm bench` locally (excl. 256 MB) must exit 0; `benchmarks/results/baseline.json` produced

## Wave 0 Requirements

- [ ] `tinybench@^6.0.0` installed as devDep
- [ ] `benchmarks/` dir with `scenarios/`, `results/`, `compare.mjs`, `run.mjs` layout
- [ ] `vitest.bench.config.ts` created with browser mode + bench glob
- [ ] `package.json` adds `"bench": "vitest bench --config vitest.bench.config.ts"` and `"bench:heavy": "IFB_BENCH_HEAVY=1 pnpm bench"`
- [ ] `benchmarks/helpers/payloads.ts` exposes `createBinaryPayload(size)` (chunked `crypto.getRandomValues`) and `createStructuredPayload(size)`
- [ ] `benchmarks/helpers/iframe-harness.ts` / `worker-harness.ts` for browser-side scenario setup
- [ ] `.github/workflows/bench.yml` workflow file (nightly + on-label)
- [ ] `.planning/decisions/` directory created

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 256 MB benchmark on WebKit CI | BENCH-02 (partial) | CI resource limits may force this to be skipped; manually confirm first CI run | Check artifact on first nightly bench run |
| WASM decision content | BENCH-05 | Interpretation of data is a human call | Read `.planning/decisions/05-wasm-decision.md` after first baseline |

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or are bench runs with known output targets
- [ ] Baseline commit policy documented in plan
- [ ] First baseline produced locally (Chromium + Firefox) before phase verification
- [ ] WASM decision written with concrete numbers
- [ ] CI gate 10% regression comparator implemented

**Approval:** pending
