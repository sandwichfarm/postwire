---
phase: quick-260421-ukg
plan: 01
subsystem: docs/build-tooling
tags: [bench, docs, release, scripts]
dependency_graph:
  requires:
    - benchmarks/results/baseline.json (produced by pnpm bench:fast — Phase 05)
    - pnpm bench:fast script (vitest bench + normalize.mjs)
  provides:
    - scripts/bench-to-readme.mjs (renders baseline.json → README markdown table)
    - pnpm bench:readme (manual + CI entry point)
    - prepublishOnly hook (auto-refresh numbers at release time)
  affects:
    - README.md (adds a new ## Benchmarks section before ## License)
    - package.json (adds two scripts)
tech_stack:
  added: []
  patterns:
    - "Sentinel-bounded README region (<!-- bench:start --> / <!-- bench:end -->) for idempotent regeneration"
    - "Fail-loud bench-to-artifact wiring: subprocess must succeed before any file write"
    - "Zero-dep Node ESM script (node:fs + node:child_process spawnSync only)"
key_files:
  created:
    - scripts/bench-to-readme.mjs
  modified:
    - README.md
    - package.json
decisions:
  - "D-01: script at scripts/bench-to-readme.mjs (matches existing .mjs convention)"
  - "D-02: prepublishOnly, NOT prepare — prepare would run on every consumer pnpm install"
  - "D-03: sentinels <!-- bench:start --> / <!-- bench:end --> (invisible on GitHub/npm/JSR)"
  - "D-04: parse baseline.json, not Vitest stdout (stable schema, explicit rejection)"
  - "D-05: use pnpm bench:fast (no bench:cpu — multi-minute CPU profile not surfaced)"
  - "D-06: deno task parity SKIPPED — no deno.json in repo (confirmed)"
  - "D-07: zero new deps; Node 22 built-ins (node:fs, node:child_process) only"
  - "D-08: new ## Benchmarks section inserted before ## License"
  - "D-09: fail-loud — bench failure or missing baseline aborts before touching README"
  - "D-10: --skip-bench flag for CI / render testing (verified idempotency without re-running bench)"
  - "Added: accept bare -- as end-of-options marker (pnpm forwards it for `pnpm bench:readme -- --skip-bench`)"
metrics:
  duration: ~12min
  completed: 2026-04-21
---

# Quick Task 260421-ukg: Benchmark-into-README Summary

Wires benchmark numbers directly into README.md via a zero-dep Node ESM
script that runs in the `prepublishOnly` lifecycle hook — numbers
auto-refresh before every release and never drift silently from reality.

## One-liner

`scripts/bench-to-readme.mjs` reads `benchmarks/results/baseline.json`,
renders a Markdown table grouped by scenario family (transferable / SAB /
structured-clone / naive postMessage), and rewrites README.md between
`<!-- bench:start -->` / `<!-- bench:end -->` sentinels — idempotently
and fail-loud — invoked manually via `pnpm bench:readme` and automatically
via `prepublishOnly`.

## Files Changed

| File | Change | Commit |
| --- | --- | --- |
| `scripts/bench-to-readme.mjs` | Created — 149 LOC, zero deps | 8b19e22 |
| `README.md` | Added `## Benchmarks` section with sentinel block + 16-row table | 8b19e22 |
| `package.json` | Added `bench:readme` + `prepublishOnly` scripts | 443dcc9 |
| `scripts/bench-to-readme.mjs` | Accept bare `--` from pnpm arg forwarding | 443dcc9 |

## Commits

- `8b19e22` — feat(scripts): add bench-to-readme renderer with sentinel block
- `443dcc9` — chore(pkg): wire bench:readme into prepublishOnly, not prepare

## Decisions Made

Locked in during planning (D-01 through D-10 in the plan):

- **D-01** Script path `scripts/bench-to-readme.mjs` — matches the existing
  `sync-jsr-version.mjs` / `tree-shake-check.mjs` / `check-name-availability.mjs`
  convention.
- **D-02** `prepublishOnly`, **not** `prepare`. The user's original task said
  "wire into publish hooks" and mentioned `prepare`, but `prepare` fires on
  every `pnpm install` in every downstream consumer — a consumer running
  `pnpm add postwire` would spawn Vitest, run the bench suite (multi-minute),
  and fail because they don't have our devDeps. `prepublishOnly` fires only
  on the publisher's machine, immediately before the tarball is assembled.
  Also exposes a named `bench:readme` script so humans and CI can run it
  directly.
- **D-03** Sentinels `<!-- bench:start -->` / `<!-- bench:end -->` — HTML
  comments are invisible on GitHub, npm, and JSR.
- **D-04** Parse `benchmarks/results/baseline.json` (stable schema from
  Phase 05's `normalize.mjs`), not Vitest stdout.
- **D-05** Use `pnpm bench:fast` — the fastest path that produces a
  normalized baseline.json. Skips `bench:cpu` (multi-minute CPU profiling)
  because CPU columns are not surfaced in the README table.
- **D-06** Deno task parity **skipped** — no `deno.json` exists in this
  repo (only `jsr.json`, which has no task runner). Confirmed at execution
  time via `ls deno.json deno.jsonc`.
- **D-07** Zero new deps (runtime or dev). Node 22 built-ins are sufficient:
  `node:fs` (readFileSync/writeFileSync) + `node:child_process` (spawnSync).
- **D-08** Insert a new `## Benchmarks` section **before `## License`**. The
  existing Documentation table's `Benchmarks` link to `docs/benchmarks.md`
  is left untouched and continues pointing to the long-form write-up.
- **D-09** Fail-loud — missing/invalid/empty baseline.json or a non-zero
  exit from `pnpm bench:fast` causes the script to `process.exit(1)`
  **before** touching README.md. Verified (see Verification below).
- **D-10** `--skip-bench` flag reuses existing baseline.json for fast
  render-only testing. Used by the idempotency and fail-loud verify steps.

### Why `prepublishOnly` not `prepare` (one-line recap of D-02)

`prepare` runs on every downstream `pnpm install`, which would spawn
Vitest on consumers that don't have our devDeps installed; `prepublishOnly`
fires only on the publisher's machine before `npm publish` — the correct
trigger.

## Verification

| Check | Result |
| --- | --- |
| Script runs with `--skip-bench` against existing baseline.json | OK — 16 scenarios, 4 families |
| `README.md` contains both sentinels | OK (1 occurrence each) |
| Rendered table has expected `\| Scenario \|` header | OK |
| **Idempotency** — `node scripts/bench-to-readme.mjs --skip-bench` run twice → byte-identical README | OK (exit 0 from `diff -q`) |
| **Fail-loud** — rename baseline.json, run script → exit 1, README untouched | OK (exit 1, README diff empty) |
| **pnpm forwarding** — `pnpm bench:readme -- --skip-bench` works | OK (bare `--` tolerated) |
| `package.json.scripts['bench:readme']` set | OK |
| `package.json.scripts.prepublishOnly` contains `bench:readme` | OK |
| `package.json.scripts.prepare` unmodified / absent | OK (absent) |
| No `deno.json` created | OK (confirmed absent) |
| Real `pnpm bench:fast` → updated baseline.json → script renders fresh numbers | OK (verified end-to-end, then reverted baseline.json to committed state) |
| Script LOC budget (≤ 150) | OK (149 LOC) |

## Rendered Table Preview (current README.md)

```markdown
<!-- bench:start -->
_Environment: Node 22.22.1 · MessageChannel (node) · commit d32e87c · 2026-04-21T18:27:10.870Z_

| Scenario | Payload | Throughput (MB/s) | p50 (ms) | p99 (ms) | Samples |
|---|---|---:|---:|---:|---:|
| library (transferable) | 1 KB | 13.35 | 0.07 | 0.11 | 26,081 |
| library (transferable) | 64 KB | 721.75 | 0.09 | 0.16 | 22,027 |
| library (transferable) | 1 MB | 2222.94 | 0.44 | 0.77 | 4,240 |
| library (transferable) | 16 MB | 1923.45 | 8.63 | 10.69 | 230 |
| | | | | | |
| library (SAB) | 1 KB | 3.29 | 0.25 | 0.96 | 6,431 |
| library (SAB) | 64 KB | 207.96 | 0.28 | 1.09 | 6,347 |
| library (SAB) | 1 MB | 1197.53 | 0.98 | 1.50 | 2,285 |
| library (SAB) | 16 MB | 1296.44 | 14.80 | 19.37 | 155 |
| | | | | | |
| library (structured-clone) | 1 KB | 13.96 | 0.07 | 0.14 | 27,263 |
| library (structured-clone) | 64 KB | 140.58 | 0.44 | 0.75 | 4,291 |
| library (structured-clone) | 1 MB | 119.11 | 8.39 | 12.27 | 228 |
| library (structured-clone) | 16 MB | 64.76 | 256.31 | 321.51 | 10 |
| | | | | | |
| naive postMessage | 1 KB | 63.88 | 0.02 | 0.03 | 124,768 |
| naive postMessage | 64 KB | 1600.62 | 0.04 | 0.10 | 48,848 |
| naive postMessage | 1 MB | 2519.02 | 0.38 | 1.91 | 4,805 |
| naive postMessage | 16 MB | 4511.95 | 3.53 | 5.29 | 538 |

_Generated by `scripts/bench-to-readme.mjs` — do not edit by hand._
<!-- bench:end -->
```

### Observations from the rendered numbers

- **Transferable beats structured-clone by 10×–30×** at ≥ 64 KB (721 vs 140
  MB/s at 64 KB; 2222 vs 119 MB/s at 1 MB; 1923 vs 65 MB/s at 16 MB) —
  confirms the core value prop.
- **Naive postMessage wins at small payloads and 1–16 MB** in this Node
  MessageChannel environment (no structured-clone envelope overhead). This
  matches the STATE.md note from Phase 06: "SAB is not faster than
  transferable in Node (0.20x–0.70x); Node MessageChannel has no
  structured-clone envelope overhead — SAB advantage materializes in
  browser COOP/COEP contexts (Phase 9)."
- **The table is honest about environment**: `_Environment: Node 22.22.1 ·
  MessageChannel (node) · ...`_ — not browser numbers.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Bare `--` from pnpm arg forwarding rejected as unknown arg**

- **Found during:** Task 2 verify (first `pnpm bench:readme -- --skip-bench`)
- **Issue:** `pnpm bench:readme -- --skip-bench` passes `["--", "--skip-bench"]` as argv. The strict
  unknown-arg handler in the original script rejected the bare `--` and exited 2, which would have
  broken the plan's Task 3 verification command.
- **Fix:** Added `a !== "--"` to the unknown-arg filter. `--` is the POSIX end-of-options marker;
  tolerating it is the right behavior.
- **Files modified:** `scripts/bench-to-readme.mjs` (1 line + comment)
- **Commit:** 443dcc9 (included in the Task 2 commit)

Everything else executed exactly as planned.

## Follow-ups

- None expected for this task.
- If CI should run bench on every PR and diff the README (to catch
  accidental staleness in PRs), open a separate quick task — out of scope
  here; the `prepublishOnly` hook already covers the release-time case.
- The `bench:fast` Node-environment numbers will shift once Phase 09 wires
  a browser-mode benchmark with COOP/COEP isolation (where SAB should
  finally beat transferable); the `_Environment:_` line in the block will
  change accordingly without any script changes — the renderer already
  pulls `artifact.env` / `artifact.node` straight from baseline.json.

## Self-Check: PASSED

- `scripts/bench-to-readme.mjs` — FOUND
- `README.md` contains `<!-- bench:start -->` — FOUND (1 occurrence)
- `README.md` contains `<!-- bench:end -->` — FOUND (1 occurrence)
- `package.json.scripts['bench:readme']` — FOUND
- `package.json.scripts.prepublishOnly` contains `bench:readme` — FOUND
- Commit 8b19e22 (`feat(scripts): add bench-to-readme`) — FOUND
- Commit 443dcc9 (`chore(pkg): wire bench:readme`) — FOUND
- Idempotency (run twice, byte-identical) — VERIFIED
- Fail-loud (missing baseline → exit 1, README untouched) — VERIFIED
- LOC budget (≤ 150) — MET (149)
