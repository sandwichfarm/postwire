---
phase: quick-260421-u6w
plan: 01
subsystem: publishing / jsr-score
tags: [jsr, tsdoc, publishing, runtime-compat, provenance]
requires: [browser-harness-running]
provides: [jsr-score-100-ready-to-publish]
affects: [jsr.json, package.json, src/**]
tech-stack:
  added: [jsr@0.14.3 devDependency]
  patterns: [TSDoc on every public export, honest runtimeCompat claim]
key-files:
  created:
    - .planning/quick/260421-u6w-raise-jsr-score-to-100/260421-u6w-SUMMARY.md
    - .planning/quick/260421-u6w-raise-jsr-score-to-100/dryrun-before-docs.log
    - .planning/quick/260421-u6w-raise-jsr-score-to-100/dryrun-after-docs.log
    - .planning/quick/260421-u6w-raise-jsr-score-to-100/undocumented-symbols.txt
  modified:
    - jsr.json
    - package.json
    - pnpm-lock.yaml
    - src/framing/types.ts
    - src/transport/endpoint.ts
    - src/transport/seq.ts
    - src/transport/adapters/service-worker.ts
    - src/channel/channel.ts
    - src/adapters/emitter.ts
    - src/adapters/lowlevel.ts
    - src/adapters/streams.ts
    - src/relay/bridge.ts
    - src/types.ts
decisions:
  - Dropped workerd from runtimeCompat — no standard MessageChannel, no SharedArrayBuffer/Atomics.waitAsync, and adapters don't map to Durable Objects/fetch. Kept browser + deno + node + bun (4 runtimes, 2× the ≥2 threshold).
  - Used direct patch bump instead of `pnpm changeset version` because `.gitignore` excludes `.changeset/*.md` (project convention — versions are bumped by hand).
  - Final version is 0.1.3 (package.json 0.1.0 → 0.1.3, jsr.json 0.1.2 → 0.1.3) — aligns both manifests onto a single patch that will publish together via `publish.yml` on the next `v0.1.3` tag push.
metrics:
  duration: ~20 min
  completed: 2026-04-21
---

# Phase quick-260421-u6w Plan 01: Raise JSR Score to 100% — Summary

One-liner: Drop unverifiable workerd claim, add TSDoc on 60 undocumented public exports, and prep v0.1.3 release — everything staged for the user to push the tag and let CI do the provenanced publish.

## Outcome

**Ready to ship.** Every change that does not require a live publish is committed on `worktree-agent-a4bb23fc`. The JSR score cannot move until a new version is pushed through the OIDC-backed `publish.yml`; this plan delivers that ready-to-tag state.

## Final Version

- **package.json**: `0.1.0` → `0.1.3`
- **jsr.json**: `0.1.2` → `0.1.3`
- Both manifests now aligned on the same patch version.

## runtimeCompat — kept vs dropped

| Runtime   | Status  | Justification                                                                                                                                                                                     |
| --------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| browser   | KEPT    | The whole library is built for this — Window, Worker, MessagePort, ServiceWorker adapters all target browser APIs. Obvious.                                                                       |
| deno      | KEPT    | Deno ships `MessageChannel`, `Worker`, structured clone, `BroadcastChannel`, `ReadableStream`/`WritableStream`, `SharedArrayBuffer`, `Atomics.waitAsync`. Verified: zero `node:*` imports in src/. |
| node      | KEPT    | `node:worker_threads.MessagePort` satisfies the `PostMessageEndpoint` interface; library treats any `{postMessage, onmessage}` shape as valid. Tests already run under Node.                      |
| bun       | KEPT    | Bun ships the same web-standard surface as Deno plus node-compat. Same evidence as Node + Deno.                                                                                                   |
| workerd   | DROPPED | No SharedArrayBuffer/Atomics.waitAsync (no COOP/COEP in workers), no standard `new MessageChannel()` pattern, ServiceWorker/Worker adapters don't map to Durable Objects or fetch-event paradigm. |

Result: 4 runtimes marked compatible — double the ≥2 JSR gauge threshold.

## Symbol-Doc Coverage

| Metric                        | Before | After | Notes                                                           |
| ----------------------------- | ------ | ----- | --------------------------------------------------------------- |
| `deno doc --lint` missing JSDoc errors | 60     | 0     | All public exports now have TSDoc blocks.                       |
| Approx JSR score coverage     | 52%    | 100%  | Far exceeds the ≥80% "docs for most symbols" threshold.         |
| `private-type-ref` errors     | 9      | 9     | Slow-types noise — NOT counted against the "no slow types" tile, which passes. Can be addressed later by promoting `SessionOptions`, `StreamHandle`, `ChannelEventMap`, `EmitterEventMap`, `ChannelStats` to public exports. |

TSDoc edits were purely additive — `git diff --stat` shows 90 insertions and 2 single-character tweaks (trailing periods on existing `/** Common header ... */` style comments). No runtime behavior changed. All 340 vitest tests still pass.

## Commits

1. `b6c2713` — `docs(jsr): drop workerd from runtimeCompat (honest compat claim)` — manifest hygiene + adds `jsr@0.14.3` devDep so `pnpm exec jsr publish --dry-run` works locally.
2. `b67d194` — `docs(tsdoc): close symbol-doc gap for JSR score` — 10 files, 90 insertions, comment-only.
3. `70d8b6b` — `chore(release): bump to 0.1.3 — align npm and JSR` — aligns both manifests on `0.1.3`.

## Dry-Run Gauntlet

- `pnpm build` — clean (tsdown 0.21.9 → `dist/index.js` 70.8 kB, `dist/index.d.ts` 35.8 kB)
- `pnpm typecheck` — clean
- `pnpm lint` — clean (biome + publint both green)
- `pnpm test` — 340/340 passed
- `pnpm exec jsr publish --dry-run --allow-dirty` — `Success Dry run complete`
- `npm publish --provenance --dry-run` — `+ postwire@0.1.3`, 84.3 kB tarball

## What the user must do now

1. Push the branch and tag:

   ```
   # From the main worktree (not this agent worktree), pull the three commits
   # (b6c2713, b67d194, 70d8b6b) into master. Or cherry-pick / merge them as
   # your workflow dictates.

   git push origin master

   # Tag and push — triggers .github/workflows/publish.yml
   git tag v0.1.3
   git push origin v0.1.3
   ```

2. Watch the run at `https://github.com/sandwichfarm/postwire/actions` — both
   `npm publish --provenance --access public` and `pnpm exec jsr publish`
   steps must succeed.

3. After ~2 minutes, confirm on `https://jsr.io/@sandwich/postwire`:
   - Score tile reads **100%** (14/14).
   - **Has provenance** — green (sigstore transparency log entry).
   - **Has docs for most symbols** — green.
   - **Has a description** — green.
   - **≥1 runtime compatible** and **≥2 runtimes compatible** — both green.

   And on `https://www.npmjs.com/package/postwire`:
   - 0.1.3 shows the **Provenance** badge linking to the GitHub Actions run.

## Deferred Issues

- `attw --pack .` emits two non-fatal warnings (`NoResolution` for `node10`, `CJSResolvesToESM` for `node16 from CJS`). **Pre-existing** — same exit 1 on `HEAD` before any of this work (verified). Caused by the package being ESM-only (`"type":"module"`, no `require` path in the `exports` map). `publish.yml` runs `pnpm exec attw --pack .` and may mark the CI job as failed even though npm/JSR publish steps succeed. If CI blocks on this, either (a) drop `attw` from the workflow, or (b) add a `require` condition in `exports` with a CJS build. Out of scope for this plan.

## Auth / Human-Verify Gate

- **Human-verify checkpoint at Task 3** — honored. The executor prepared every release artifact, ran the full dry-run gauntlet green, committed the version bump, and STOPPED. The actual tag push is the user's action because it triggers an irreversible public publish.

## Self-Check: PASSED

All file artifacts exist at their declared paths (SUMMARY.md, two dry-run logs,
undocumented-symbols.txt, all 13 modified source/manifest files). All three
commits (`b6c2713`, `b67d194`, `70d8b6b`) are present in the worktree's git
history on branch `worktree-agent-a4bb23fc`.
