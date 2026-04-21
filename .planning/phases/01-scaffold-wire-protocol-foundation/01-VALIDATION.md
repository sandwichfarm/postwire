---
phase: 1
slug: scaffold-wire-protocol-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-21
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (Node env for Phase 1) + @playwright/test 1.59.x |
| **Config file** | `vitest.config.ts`, `playwright.config.ts` (installed in Wave 0) |
| **Quick run command** | `pnpm vitest run --no-coverage` |
| **Full suite command** | `pnpm lint && pnpm typecheck && pnpm test && pnpm publint && pnpm e2e:smoke` |
| **Estimated runtime** | Quick ~5s · Full ~45s (incl. Playwright smoke across chromium/firefox/webkit) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run --no-coverage` (or scoped `pnpm vitest run <file>`)
- **After every plan wave:** Run `pnpm lint && pnpm typecheck && pnpm test && pnpm publint`
- **Before `/gsd:verify-work`:** Full suite must be green including Playwright smoke
- **Max feedback latency:** 10 seconds for quick, 60 seconds for full

---

## Per-Task Verification Map

*Note: Task IDs populated during planning by gsd-planner. Fill in here as plans are authored.*

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 0 | — (infra) | wave-0 | `pnpm install && pnpm typecheck` | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 0 | COMP-02, COMP-04 | unit | `pnpm publint` | ❌ W0 | ⬜ pending |
| 1-02-01 | 02 | 1 | PROTO-01, PROTO-03, PROTO-04, PROTO-05 | unit | `pnpm vitest run src/framing` | ❌ W0 | ⬜ pending |
| 1-02-02 | 02 | 1 | PROTO-02 | unit/fuzz | `pnpm vitest run src/transport/seq` | ❌ W0 | ⬜ pending |
| 1-03-01 | 03 | 1 | ENDP-01, ENDP-02, ENDP-04, FAST-05 | unit | `pnpm vitest run src/transport/adapters` | ❌ W0 | ⬜ pending |
| 1-03-02 | 03 | 1 | ENDP-03 | unit | `pnpm vitest run src/transport/adapters/window` | ❌ W0 | ⬜ pending |
| 1-04-01 | 04 | 2 | COMP-01, COMP-03 | e2e | `pnpm e2e:smoke` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `package.json` — pnpm workspace root, ESM `"type": "module"`, `exports` map with `"."` and `"./wasm"`, scripts: `build | lint | format | typecheck | test | e2e:smoke | bench | publint | changeset | changeset:version | changeset:publish`, `sideEffects: false`
- [ ] `pnpm-lock.yaml` — committed lockfile with pinned exact versions (no `^` / `~`)
- [ ] `tsconfig.json` — TypeScript 6 `strict`, `isolatedDeclarations: true`, `verbatimModuleSyntax: true`, `moduleResolution: "bundler"`, `target: "ES2023"`, `lib: ["ES2023", "DOM", "DOM.Iterable", "WebWorker"]`
- [ ] `tsdown.config.ts` — two entries (`src/index.ts` → `.`, `src/wasm.ts` → `./wasm`), ESM-only, dts enabled, tree-shakeable
- [ ] `biome.json` — formatter + linter (project-wide), `organizeImports: "on"`
- [ ] `vitest.config.ts` — Node env for Phase 1 units (browser env scaffolding prepped but unused until Phase 3)
- [ ] `playwright.config.ts` — three projects (chromium, firefox, webkit), `testDir: "e2e"`, no webServer (uses `page.setContent`)
- [ ] `.changeset/config.json` — Changesets config
- [ ] `scripts/sync-jsr-version.mjs` — sync `jsr.json.version` with `package.json.version` on version bump
- [ ] `jsr.json` — matching package name and version
- [ ] `.github/workflows/ci.yml` — lint + typecheck + test + publint + Playwright smoke (3 browsers) on push/PR
- [ ] `.github/workflows/publish.yml` — dual-publish to npm + JSR via OIDC; trigger on tag only
- [ ] `e2e/smoke.spec.ts` — trivial "open blank page, assert title" across all 3 browsers
- [ ] `src/framing/types.ts` — discriminated-union Frame types (OPEN, OPEN_ACK, DATA, CREDIT, CLOSE, CANCEL, RESET, CAPABILITY)
- [ ] `src/framing/encode-decode.ts` — `encode(frame): unknown` / `decode(msg): Frame | null`
- [ ] `src/framing/encode-decode.test.ts` — round-trip all 8 frame types + unknown-returns-null
- [ ] `src/transport/seq.ts` — `seqLT`, `seqGT`, `seqDelta` over 32-bit modular arithmetic
- [ ] `src/transport/seq.test.ts` — fuzz test across the wrap point
- [ ] `src/transport/endpoint.ts` — `PostMessageEndpoint` interface
- [ ] `src/transport/adapters/window.ts` — `createWindowEndpoint(win, expectedOrigin)`; throws on wildcard/empty origin
- [ ] `src/transport/adapters/worker.ts` — `createWorkerEndpoint(worker)` and self-side helper
- [ ] `src/transport/adapters/message-port.ts` — `createMessagePortEndpoint(port)` (auto-starts port)
- [ ] `src/transport/adapters/service-worker.ts` — `createServiceWorkerEndpoint(swOrClient)`; sets `sabCapable: false` capability
- [ ] `src/transport/adapters/*.test.ts` — unit tests; Window uses a MessageChannel+Window double as the test double
- [ ] `src/index.ts` — exports framing types, endpoint types, adapters
- [ ] `src/wasm.ts` — `export {}` placeholder (reserved slot)
- [ ] `.gitignore`, `.npmignore`, `LICENSE` (MIT), minimal `README.md`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| CI workflow actually runs on a real GitHub push | COMP-03 (partial) | GitHub Actions run is an external system — we assert the YAML is valid and the commands inside it are identical to local, but the first real run must be observed | Push a branch and confirm all jobs pass green on PR |
| OIDC publishing credentials are provisioned in GitHub/npm/JSR | PUB-02 (Phase 10) | Trust policies must be set up by the repo owner outside of the code | Doc this in PUB-related Phase 10 task, not here |
| Final package name availability on npm + JSR | PUB-01 (Phase 10) | Phase 1 uses the working name `iframebuffer`; real registration is Phase 10 | N/A for Phase 1 |

Every other Phase 1 behavior has automated verification via vitest or Playwright.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags (CI uses `vitest run` / `playwright test`, not watch)
- [ ] Feedback latency < 10s quick / 60s full
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
