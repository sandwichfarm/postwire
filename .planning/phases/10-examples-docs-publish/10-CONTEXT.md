# Phase 10: Examples + Docs + Publish - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning
**Mode:** Auto-generated (YOLO)

<domain>
## Phase Boundary

Five runnable examples, a VitePress documentation site (or equivalent markdown-based docs structure), and dual-publish pipeline validated to npm + jsr under a confirmed-available name.

This phase covers:
- **Final package name selection** — PUB-01 blocker. The working name `iframebuffer` is descriptive but long. Need something short, catchy, available on npm AND jsr.
- **Five examples** under `examples/`:
  - EX-01: two-party parent↔iframe file download
  - EX-02: main↔worker ReadableStream pipe
  - EX-03: three-hop worker → main relay → sandboxed strict-CSP iframe (live stream)
  - EX-04: multiplex file download + control channel
  - EX-05: each runnable via `pnpm dev` from its own directory
- **Documentation site** — VitePress 1.6.x for the canonical docs; minimum viable: home page, API reference (3 API surfaces + endpoint adapters), topology patterns, errors & observability, security model, benchmark results section, decision log links. Markdown-first; live demos can link out to `examples/`.
- **Publish pipeline**:
  - `.github/workflows/publish.yml` (exists from Phase 1) — verify OIDC works via dry-run
  - `scripts/sync-jsr-version.mjs` (exists) — confirm it runs via `pnpm version` (Changesets)
  - CI validation: a PR that has mismatched versions between `package.json` and `jsr.json` fails
- **README.md** — comprehensive install + quickstart + link tree to docs

This phase explicitly does NOT include:
- Actual v1 publish to npm/jsr (dry-run only — we validate the pipeline, don't consume the name until the user is ready)
- Deployment of the docs site to a hosting provider (docs site builds; hosting is caller's choice)
- Marketing, social posts, community building

Requirements covered: EX-01..05, DOC-01..06, PUB-01..04.

</domain>

<decisions>
## Implementation Decisions

### Name selection

Short, catchy, available on npm + jsr. Candidates for quick check:
- `postflux` — catchy; likely taken on npm
- `slipstream` — too generic
- `ferry` — common word; likely taken
- `sluice` — evocative (flow control channel); good candidate
- `torrent` — heavily taken
- `portpipe` — descriptive; check availability
- `shiv` — short; likely taken
- `pmstream` — descriptive, less catchy
- `mdux` — message duplex; short; maybe available
- `xferry` — ferry + xfer; unusual

**Decision:** use `iframebuffer` as the published name unless user prefers otherwise — it's descriptive and likely available (less contention for `iframe`-themed names). The user can rename via PR before publishing. Update `jsr.json` from `@iframebuffer/core` → just `@iframebuffer/iframebuffer` or similar if needed; keep the `package.json` `name` field.

Actually — the current `jsr.json` already uses `@iframebuffer/core` which is a scoped name on JSR. For npm the package is `iframebuffer` (unscoped). Both should be verified available. In Phase 10 we document "verify availability before first publish" as an explicit pre-publish step.

### Examples structure

`examples/` directory with subdirectories:
- `examples/01-parent-iframe/`
- `examples/02-main-worker/`
- `examples/03-three-hop/`
- `examples/04-multiplex/`
- `examples/05-strict-csp/`

Each has its own `package.json` with a `dev` script (Vite dev server), `index.html`, `main.ts`, and a README. They depend on the parent `iframebuffer` package via `file:../../` link during development.

### Docs approach

Given time/token budget, land a pragmatic doc set:

1. Comprehensive top-level **`README.md`** with install, quickstart, links
2. Markdown pages under `docs/`:
   - `docs/api/lowlevel.md`, `emitter.md`, `streams.md`
   - `docs/topology.md` — two-party, three-hop, multiplex
   - `docs/endpoints.md` — four adapter types
   - `docs/errors.md` — all named errors with recovery patterns
   - `docs/security.md` — origin validation, CSP, COOP/COEP
   - `docs/benchmarks.md` — link to baseline.json + chart (text table is fine for v1)
   - `docs/decisions.md` — links to `.planning/decisions/*.md`
3. Optional: `docs/.vitepress/config.ts` that wraps it in a VitePress site (if time permits — if not, markdown files are directly consumable on GitHub)

This satisfies DOC-01..06 as raw markdown; VitePress wrapping is additive.

### Publish pipeline

- `publish.yml` already exists. Add a dry-run job that runs on PRs:
  - `pnpm build`
  - `pnpm exec publint`
  - `npm publish --provenance --dry-run`
  - `pnpm exec jsr publish --dry-run`
- Add a guard in CI: reject if `jsr.json.version !== package.json.version` (one-line script)
- Actual publish still triggers only on `v*` tags

### CI version-sync check

Add to `ci.yml` a new step:
```yaml
- name: Check jsr.json version matches package.json
  run: |
    PKG=$(node -p "require('./package.json').version")
    JSR=$(node -p "require('./jsr.json').version")
    [ "$PKG" = "$JSR" ] || { echo "Version mismatch: package.json=$PKG jsr.json=$JSR"; exit 1; }
```

</decisions>

<code_context>
## Existing Code Insights

- `package.json` already has `"name": "iframebuffer"`, `"version": "0.0.0"`, `sideEffects: false`, dual-entry exports
- `jsr.json` exists with `@iframebuffer/core` scope
- `scripts/sync-jsr-version.mjs` exists (Phase 1)
- `scripts/tree-shake-check.mjs` exists (Phase 3)
- `.github/workflows/publish.yml` exists (Phase 1) — uses OIDC via `id-token: write`
- `.github/workflows/ci.yml` exists — covers lint, test, publint, e2e, and now (Phase 9) full E2E with deps
- VitePress 1.6.x is in STACK.md recommendations but NOT yet installed

</code_context>

<specifics>
## Specific Ideas

- Keep examples lightweight — focus on "this is the shortest code to use the feature", not "this is a production-ready demo"
- Docs in pure markdown first; VitePress wrapping is a nice-to-have, not a gate
- Name availability can be programmatically checked via `npm view <name>` (exit 0 = taken, non-0 = available) and `curl https://jsr.io/@scope/name/meta.json`; document how

</specifics>

<deferred>
## Deferred Ideas

- Actually publishing v1 to npm/jsr — this is the human operator's call, post-milestone
- Live demo hosting (GitHub Pages, Vercel, etc.)
- Blog post / announcement

</deferred>
