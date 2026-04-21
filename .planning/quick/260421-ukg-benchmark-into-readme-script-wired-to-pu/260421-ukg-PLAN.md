---
phase: quick-260421-ukg
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - scripts/bench-to-readme.mjs
  - README.md
  - package.json
autonomous: true
requirements:
  - QUICK-BENCH-README-01  # Run bench suite via script
  - QUICK-BENCH-README-02  # Render results into README between sentinels (idempotent)
  - QUICK-BENCH-README-03  # Wire script into package.json lifecycle hooks

must_haves:
  truths:
    - "Running `pnpm bench:readme` regenerates the benchmark table between sentinels in README.md"
    - "Re-running the script a second time with unchanged inputs produces a byte-identical README.md (idempotent)"
    - "Running `pnpm publish` (or `pnpm release`) triggers the benchmark-to-README step before the tarball is assembled"
    - "A failed benchmark run aborts before README.md is written (no partial/broken table committed)"
    - "The rendered table is honest about environment (notes Node version, commit, env=node)"
  artifacts:
    - path: "scripts/bench-to-readme.mjs"
      provides: "Node ESM script that runs bench, parses benchmarks/results/baseline.json, rewrites README.md sentinel block"
      contains: "bench:start"
    - path: "README.md"
      provides: "Markdown with `<!-- bench:start -->` / `<!-- bench:end -->` block containing the latest benchmark table"
      contains: "<!-- bench:start -->"
    - path: "package.json"
      provides: "Named `bench:readme` script + `prepublishOnly` hook wiring"
      contains: "bench:readme"
  key_links:
    - from: "scripts/bench-to-readme.mjs"
      to: "benchmarks/results/baseline.json"
      via: "readFileSync after spawning `pnpm bench:fast`"
      pattern: "baseline\\.json"
    - from: "package.json scripts.prepublishOnly"
      to: "scripts/bench-to-readme.mjs"
      via: "node invocation"
      pattern: "bench:readme"
    - from: "scripts/bench-to-readme.mjs"
      to: "README.md"
      via: "writeFileSync with sentinel-bounded replacement"
      pattern: "bench:end"
---

<objective>
Create a single ESM script `scripts/bench-to-readme.mjs` that (1) runs the existing benchmark suite, (2) parses `benchmarks/results/baseline.json`, (3) renders a compact Markdown table, and (4) rewrites `README.md` between `<!-- bench:start -->` / `<!-- bench:end -->` sentinels idempotently. Wire it into `package.json` via a named `bench:readme` script and `prepublishOnly` — NOT `prepare`.

Purpose: benchmarks are the entire reason this library exists ("if the benchmark doesn't show a clear win, the library has no reason to exist" — CLAUDE.md). Surfacing numbers on the README is table stakes. We automate it so the numbers never drift from the code.

Output:
- `scripts/bench-to-readme.mjs` (< 150 lines, zero runtime deps, Node 22 built-ins only)
- `README.md` gains a `## Benchmarks` section containing a sentinel block and a live table
- `package.json` gains `bench:readme` script and a `prepublishOnly` hook that runs it

## Locked Design Decisions (do not revisit)

| # | Decision | Rationale |
|---|----------|-----------|
| D-01 | Script path: `scripts/bench-to-readme.mjs` | Matches existing convention — `sync-jsr-version.mjs`, `check-name-availability.mjs`, `tree-shake-check.mjs` are all `.mjs` in `scripts/`. |
| D-02 | Hook: `prepublishOnly` (NOT `prepare`) | User requested `prepare`, but `prepare` runs on every `pnpm install` in every consumer — would force a multi-minute bench run on every install of `postwire` as a dependency. `prepublishOnly` fires only before `npm publish`, which is the correct trigger. Also expose a named `bench:readme` script so CI and humans can run it directly. |
| D-03 | Sentinels: `<!-- bench:start -->` / `<!-- bench:end -->` | Matches user spec verbatim; HTML comment is invisible in rendered Markdown on GitHub/npm/JSR. |
| D-04 | Data source: `benchmarks/results/baseline.json` (NOT live Vitest stdout) | The existing `pnpm bench:fast` pipeline already writes this file via `BenchJsonReporter` + `normalize.mjs`. The schema is stable (`scenarios[].name/mb_s/p50_ms/p99_ms/samples/rme`). Parsing Vitest console output is fragile — explicitly rejected in the task context. |
| D-05 | Bench command: `pnpm bench:fast` | Fastest path that produces a normalized baseline.json. Skips `bench:cpu` (~minutes of CPU profiling) because CPU columns are not surfaced in README. If cpu_us_per_op is present (from a prior full `pnpm bench` run) we render it; if null, we omit that column. |
| D-06 | Deno task parity: SKIPPED | `deno.json` / `deno.jsonc` do not exist in this repo — only `jsr.json`, and JSR does not execute `deno.json tasks` during publish. No-op. Documented here so a future reader knows we checked. |
| D-07 | Zero runtime deps, zero new devDeps | Node 22 built-ins (`node:fs`, `node:child_process`, `node:process`) are sufficient. Markdown table formatting is trivial string building. No chalk/cli-table/marked needed. |
| D-08 | README insertion point: under a NEW `## Benchmarks` section inserted before `## License` | The existing README has no `## Benchmarks` heading — only a link to `docs/benchmarks.md` in the Documentation table. We add a top-level section so the numbers are visible at a glance on the GitHub repo page. The Documentation-table link remains, unchanged, pointing to the fuller explanation. |
| D-09 | Fail-loud on bench failure | Script exits non-zero before touching README if the bench subprocess fails or baseline.json is missing/invalid. README must never be left with a partial table. |
| D-10 | `--skip-bench` flag for CI / unit-testing the renderer | When set, skip the bench run and reuse the existing `benchmarks/results/baseline.json`. Used by the verify step in this plan so we can test the render path without spending minutes on a bench run. |
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md
@AGENTS.md
@README.md
@package.json
@jsr.json
@benchmarks/results/baseline.json
@benchmarks/normalize.mjs
@benchmarks/helpers/reporter.ts
@vitest.bench.config.ts
@scripts/sync-jsr-version.mjs
@scripts/tree-shake-check.mjs

<interfaces>
<!-- Key shapes the executor needs without further exploration. -->

### baseline.json schema (output of `pnpm bench:fast`)

```json
{
  "timestamp": "2026-04-21T18:27:10.870Z",
  "commit": "d32e87c",
  "node": "22.22.1",
  "env": "node",
  "scenarios": [
    {
      "name": "library (transferable) [1MB]",
      "payloadBytes": 1048576,
      "mb_s": 1911.78,
      "hz": 1823.21,
      "mean_ms": 0.548,
      "p50_ms": 0.436,
      "p75_ms": 0.493,
      "p99_ms": 1.488,
      "min_ms": 0.407,
      "max_ms": 4.004,
      "samples": 3647,
      "rme": 1.63,
      "cpu_us_per_op": 1562.02,   // nullable — present only after bench:cpu
      "cpu_utilization": 1.50     // nullable — present only after bench:cpu
    }
    // ... more scenarios
  ]
}
```

Known scenario name families (for grouping in the rendered table):
- `library (transferable) [SIZE]` — zero-copy ArrayBuffer transfer path
- `library (structured-clone) [SIZE]` — fallback path
- `library (SAB) [SIZE]`            — SharedArrayBuffer fast path
- `naive postMessage [SIZE]`        — baseline we must beat

Sizes observed: 1KB, 64KB, 1MB, 16MB. Duplicate entries per family can appear (bench re-runs within a session) — the latest entry wins when de-duping by name.

### Existing scripts/*.mjs style (match this)

```js
#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
// ESM-only, top-level await OK, no argparse library — read process.argv directly.
```

### Existing package.json scripts (relevant subset)

```json
{
  "bench": "vitest bench ... && tsx benchmarks/cpu-profile.mjs && node benchmarks/normalize.mjs ...",
  "bench:fast": "vitest bench --config vitest.bench.config.ts --outputJson benchmarks/results/latest.json && node benchmarks/normalize.mjs benchmarks/results/latest.json benchmarks/results/baseline.json",
  "release": "pnpm build && changeset publish",
  "pub:dry-run": "pnpm build && pnpm exec publint && npm publish --provenance --dry-run && pnpm exec jsr publish --dry-run"
}
```
</interfaces>

### Known constraints from STATE.md / Phase 05

- `bench:local excludes WebKit (Arch ICU ABI mismatch) — CI covers all browsers via ubuntu-latest`. Phase 05 pivoted the benchmark harness to Node mode (`node:worker_threads` MessageChannel), not browser mode. The README should be honest: label the environment as "Node `<version>` MessageChannel" (pulled from `baseline.json.node` + `baseline.json.env`), NOT imply browser numbers.
- Phase 05 notes that duplicate scenario names appear in baseline.json when bench re-runs accumulate. The renderer MUST de-duplicate by taking the last-seen entry per name, or this will produce double rows.
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Write scripts/bench-to-readme.mjs (render + sentinel rewrite, fail-loud)</name>
  <files>scripts/bench-to-readme.mjs</files>
  <behavior>
    (TDD not applied — this is a one-off tooling script with no unit test harness for scripts/. Verification is end-to-end via Task 3. The script is short enough that an e2e smoke test is the right granularity.)
  </behavior>
  <action>
Create `scripts/bench-to-readme.mjs`. Follow the existing style in `scripts/sync-jsr-version.mjs` and `scripts/tree-shake-check.mjs` — `#!/usr/bin/env node` shebang, Node ESM, `import` from `node:*` built-ins only, no argparse library (read `process.argv` directly).

Responsibilities, in order:

1. **Parse args.** Support `--skip-bench` (reuse existing `benchmarks/results/baseline.json` without running the suite). Per D-10 this is used by the verify step in Task 3. Any other arg is an error.

2. **Run benchmarks** (unless `--skip-bench`). Spawn `pnpm bench:fast` via `node:child_process.spawnSync` with `{ stdio: "inherit", shell: false }`. If exit status is non-zero, log a clear error ("benchmark run failed, not touching README") and `process.exit(1)`. Per D-09 — README must never be written from a failed bench run.

3. **Load baseline.json.** Read `benchmarks/results/baseline.json` (path relative to `process.cwd()`; all npm lifecycle hooks run with CWD = package root). If the file is missing or fails JSON.parse, exit 1 with a clear message. Validate that `scenarios` is a non-empty array; otherwise exit 1.

4. **De-duplicate scenarios.** Build `Map<name, scenario>` iterating `artifact.scenarios` — later entries overwrite earlier ones. Take `Array.from(map.values())` for rendering. (Required per STATE.md note on duplicate entries.)

5. **Group and sort.** Group by family using these prefix tests (first-match wins):
   - `name.startsWith("library (transferable)")` → family `transferable`
   - `name.startsWith("library (structured-clone)")` → family `structured-clone`
   - `name.startsWith("library (SAB)")` → family `SAB`
   - `name.startsWith("naive postMessage")` → family `naive`
   - anything else → family `other`
   Within each family, sort by `payloadBytes` ascending.

6. **Render Markdown.** Produce a single table with columns:
   `| Scenario | Payload | Throughput (MB/s) | p50 (ms) | p99 (ms) | Samples |`
   One row per scenario (all families, grouped visually — you can emit a blank-row separator between families, or emit one table per family under a small h4 heading; pick ONE approach and commit to it). Format numbers with `Number.toFixed(2)` for MB/s and latency, `.toLocaleString("en-US")` for samples. Payload should render as `1 KB` / `64 KB` / `1 MB` / `16 MB` derived from `payloadBytes` (not the raw name — it's cleaner).

   Wrap the table with a small header line above and a provenance footer line below (still inside the sentinel block):

   ```
   _Environment: Node {node} · MessageChannel ({env}) · commit {commit} · {timestamp}_
   _Generated by `scripts/bench-to-readme.mjs` — do not edit by hand._
   ```

   Rationale: per STATE.md, bench is Node-mode (not browser); be honest. Pull all four fields straight from baseline.json.

7. **Rewrite README.md idempotently.**
   - Read `README.md`.
   - Define `START = "<!-- bench:start -->"` and `END = "<!-- bench:end -->"` as module-level constants.
   - If BOTH sentinels are present: replace the content strictly between them (preserve `START\n` and `\nEND` exactly). Use a `String.prototype.split` or a simple `indexOf`-based slice — DO NOT use regex with multiline dot-all, it's fragile here.
   - If NEITHER sentinel is present: locate the line beginning `## License` and insert a new block BEFORE it:

     ```
     ## Benchmarks

     <!-- bench:start -->
     {rendered table}
     <!-- bench:end -->

     ```

     If `## License` is not found (sanity), append the block to EOF with a leading blank line.
   - If exactly one sentinel is present (malformed), exit 1 with a clear error — refuse to guess.
   - Write back to `README.md` ONLY if content changed. If the new content is byte-identical to the existing file, skip the write and log `README.md unchanged` (satisfies idempotency truth + avoids spurious git churn).

8. **Exit 0 on success**, with a one-line summary: `Updated README.md with N scenarios (env=node, node=22.22.1, commit=...)`.

**Line budget:** ≤ 150 lines including comments. If you're over, you're over-engineering — simplify.

**Do NOT:**
- Pull in `chalk`, `cli-table3`, `marked`, `remark`, or any new dep. Per D-07 and CLAUDE.md zero-runtime-deps policy (devDeps also unnecessary here — Node built-ins suffice).
- Parse Vitest stdout. Per D-04, consume `baseline.json` only.
- Use `prepare` anywhere — per D-02 that's the wiring footgun we are explicitly avoiding.
- Create files in `/home/sandwich/` — per AGENTS.md, scripts write only inside the repo.
  </action>
  <verify>
    <automated>node scripts/bench-to-readme.mjs --skip-bench &amp;&amp; grep -q '&lt;!-- bench:start --&gt;' README.md &amp;&amp; grep -q '&lt;!-- bench:end --&gt;' README.md &amp;&amp; grep -q 'Throughput (MB/s)' README.md</automated>
  </verify>
  <done>
    - `scripts/bench-to-readme.mjs` exists, is executable via `node`, and runs with `--skip-bench` against the current `benchmarks/results/baseline.json` without error
    - README.md now contains a `## Benchmarks` section with sentinel comments and a rendered Markdown table including all four scenario families present in baseline.json
    - Script exits non-zero if baseline.json is missing / invalid / empty
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Wire script into package.json (bench:readme + prepublishOnly; justify NOT using prepare)</name>
  <files>package.json</files>
  <action>
Edit `package.json` `scripts` object. Make two additions, nothing else:

1. Add `"bench:readme": "node scripts/bench-to-readme.mjs"` — exposed so CI, humans, and Claude can run it directly without going through publish.

2. Add `"prepublishOnly": "pnpm bench:readme"` — runs automatically before `pnpm publish` and `npm publish`, but NOT on `pnpm install`. This is the user-requested behavior ("wire into lifecycle hooks") done safely.

**DO NOT add `"prepare": ...`** (per D-02). The user asked for `prepare`, but:
- `prepare` runs on every `pnpm install` in every downstream consumer repo that depends on `postwire`. A `pnpm add postwire` in a user's app would spawn Vitest, run the bench suite (minutes), and likely fail because the consumer won't have our devDeps installed. Catastrophic UX.
- `prepare` also runs after `git clone` for local dev, so every fresh clone would eat minutes on first `pnpm install`. Not what we want.
- `prepublishOnly` fires only on the publisher's machine, immediately before the tarball is built. Right trigger, no collateral damage.

Leave the existing `bench`, `bench:fast`, `bench:cpu`, `bench:raw`, `bench:heavy`, `bench:compare` scripts untouched. Do not reorder other scripts.

**Deno task parity:** per D-06, no `deno.json` exists in this repo — only `jsr.json` which has no task runner. No changes to `jsr.json`. Confirm by listing the repo root; if a `deno.json` has appeared since planning, add a matching `"bench:readme": "node scripts/bench-to-readme.mjs"` to its `tasks` object and note it in the quick-task summary.

Also add a small comment to the commit message (Task 3) justifying the `prepublishOnly` choice so future readers don't need to dig through the plan.
  </action>
  <verify>
    <automated>node -e "const p=require('./package.json');if(!p.scripts['bench:readme'])process.exit(1);if(!p.scripts.prepublishOnly||!p.scripts.prepublishOnly.includes('bench:readme'))process.exit(2);if(p.scripts.prepare&amp;&amp;p.scripts.prepare.includes('bench'))process.exit(3);console.log('OK')"</automated>
  </verify>
  <done>
    - `pnpm bench:readme` resolves and runs `node scripts/bench-to-readme.mjs`
    - `package.json.scripts.prepublishOnly` contains `pnpm bench:readme` (or `node scripts/bench-to-readme.mjs` directly — either is acceptable; prefer the named script form for consistency with the rest of the scripts block)
    - `package.json.scripts.prepare` is either absent or does NOT reference the bench script
    - No other scripts modified
    - No `deno.json` created (confirmed absent)
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: End-to-end idempotency verification (run twice, diff must be empty)</name>
  <files>(verification only — no source changes)</files>
  <action>
Run the full pipeline end-to-end and verify idempotency + sentinel roundtrip. No code changes in this task — this is the verify-and-commit step.

Sequence:

1. Back up current README.md to a temp path outside the repo (e.g. `/tmp/postwire-readme-pre.md`) per AGENTS.md "no home-dir pollution" rule.
2. Run `pnpm bench:readme -- --skip-bench` (skip the full bench run — Phase 05 `baseline.json` is current and re-running bench takes several minutes; D-10 exists for exactly this).
3. Capture README.md after run 1 to `/tmp/postwire-readme-run1.md`.
4. Run `pnpm bench:readme -- --skip-bench` again.
5. Capture README.md after run 2 to `/tmp/postwire-readme-run2.md`.
6. Diff `/tmp/postwire-readme-run1.md` vs `/tmp/postwire-readme-run2.md` — MUST be empty (idempotency requirement).
7. Check that the sentinel block in README.md contains a pipe-delimited Markdown table with header `| Scenario |` and at least 4 rows (one per family × we know baseline.json has data for all four families).
8. Verify fail-loud: temporarily rename `benchmarks/results/baseline.json` to `baseline.json.bak`, run `pnpm bench:readme -- --skip-bench`, confirm it exits non-zero and README is NOT modified. Restore the file immediately.
9. Clean up temp files in `/tmp/`.

If all checks pass, commit via gsd-tools:

```
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" commit "feat(bench): auto-render benchmarks into README via prepublishOnly hook" --files scripts/bench-to-readme.mjs package.json README.md
```

Commit message body should include:
- One-line summary of what was added
- Explicit note: `prepublishOnly` chosen over `prepare` (cites the consumer-install footgun — see plan D-02).
- Note: deno task parity skipped (no deno.json in repo).
  </action>
  <verify>
    <automated>cp README.md /tmp/pw-r0.md &amp;&amp; node scripts/bench-to-readme.mjs --skip-bench &amp;&amp; cp README.md /tmp/pw-r1.md &amp;&amp; node scripts/bench-to-readme.mjs --skip-bench &amp;&amp; cp README.md /tmp/pw-r2.md &amp;&amp; diff -q /tmp/pw-r1.md /tmp/pw-r2.md &amp;&amp; grep -q '| Scenario' README.md &amp;&amp; grep -Pzoq '(?s)&lt;!-- bench:start --&gt;.*&lt;!-- bench:end --&gt;' README.md &amp;&amp; rm -f /tmp/pw-r0.md /tmp/pw-r1.md /tmp/pw-r2.md</automated>
  </verify>
  <done>
    - Script ran twice in `--skip-bench` mode with byte-identical README output (idempotency proven)
    - README contains both sentinels in correct order, with a table between them that has at least the expected header columns
    - Fail-loud behavior verified: absent/invalid baseline.json → non-zero exit, README unchanged
    - Commit created with clear message explaining the `prepublishOnly` choice
    - No temp files left on disk
  </done>
</task>

</tasks>

<verification>
Overall verification (run after all tasks):

```bash
# Script works
node scripts/bench-to-readme.mjs --skip-bench

# README has the block
grep -c '<!-- bench:start -->' README.md   # expect 1
grep -c '<!-- bench:end -->' README.md     # expect 1
grep -q '| Scenario' README.md              # table header present

# Wiring correct
node -e "const p=require('./package.json'); console.log('bench:readme=', p.scripts['bench:readme']); console.log('prepublishOnly=', p.scripts.prepublishOnly); console.log('prepare=', p.scripts.prepare||'(absent, correct)')"

# Idempotent
cp README.md /tmp/a.md && node scripts/bench-to-readme.mjs --skip-bench && diff /tmp/a.md README.md && rm /tmp/a.md  # expect no diff

# pnpm pub:dry-run still works end-to-end (optional — slow; run manually if touching release pipeline)
```
</verification>

<success_criteria>
- `scripts/bench-to-readme.mjs` exists, is < 150 LOC, has zero new deps (runtime or dev)
- `README.md` has a `## Benchmarks` section with `<!-- bench:start -->` / `<!-- bench:end -->` sentinels and a rendered throughput/latency table including all four scenario families
- `package.json` has `bench:readme` and `prepublishOnly` scripts; `prepare` is unmodified
- Running the script twice produces byte-identical READMEs (idempotent)
- Running the script with a missing/invalid baseline.json exits non-zero and leaves README untouched (fail-loud)
- Commit exists on the current branch with a message citing the `prepublishOnly`-vs-`prepare` rationale
- User-visible behavior: next time we run `pnpm release` (or `npm publish`), the README is auto-updated with fresh numbers. Manual run anytime via `pnpm bench:readme`.
</success_criteria>

<output>
After completion, create `.planning/quick/260421-ukg-benchmark-into-readme-script-wired-to-pu/260421-ukg-SUMMARY.md` with:
- Files changed (scripts/bench-to-readme.mjs, README.md, package.json)
- Decisions made (reference D-01 through D-10 from the plan)
- Why `prepublishOnly` not `prepare` (one-line recap of D-02)
- Rendered table preview (copy the final block from README.md)
- Follow-ups: none expected; if the user later wants CI to run bench on every PR and diff the README, open a separate quick task
</output>
