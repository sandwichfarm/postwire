# Phase 1: Scaffold + Wire Protocol Foundation - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — no grey-area questioning)

<domain>
## Phase Boundary

The project has a working build, lint, test, and CI pipeline with zero library logic, and the wire protocol type layer is fully defined and smoke-tested.

This phase covers:
- Package manifest (`package.json`) with the two-entry-point `exports` map (`"."` + `"./wasm"`), `publint`-clean
- Toolchain: tsdown (bundler), TypeScript 6 (compiler), Biome (lint + format), Vitest 4 (test + bench), Playwright 1.59 (cross-context E2E), Changesets (versioning + changelog), `publint` check
- CI pipeline (GitHub Actions): runs lint + test + bench + publint + a trivial Playwright smoke test across Chromium/Firefox/WebKit; dual-publish wiring to npm and JSR via OIDC (workflow file only, not publishing yet)
- Sub-repo layout: `src/framing/` (types + encode/decode), `src/transport/endpoint.ts` (PostMessageEndpoint interface + adapters for Worker / MessagePort / Window / ServiceWorker), placeholder `src/session/`, `src/channel/`, `src/adapters/` directories kept empty but tracked
- Frame protocol types: exactly the seven frame types (`OPEN`, `OPEN_ACK`, `DATA`, `CREDIT`, `CLOSE`, `CANCEL`, `RESET`, `CAPABILITY`) as TypeScript discriminated union types
- `encode(frame)` and `decode(msg)` pure functions round-trip every frame type; unknown messages return `null` without throwing
- `createWindowEndpoint(win, expectedOrigin)` is a named export with origin validation (rejects non-matching origin in unit test)
- Sequence-number arithmetic helpers (wraparound-safe comparison) with unit tests

This phase explicitly does NOT include:
- Any session-layer logic (reorder buffer, credit window, chunker, FSM — Phase 2)
- Any API adapters (low-level / EventEmitter / WHATWG Streams — Phase 3)
- Any real postMessage wiring beyond the endpoint type and origin-validating Window adapter
- Any WASM code (deferred — only the `./wasm` export slot is reserved)

Requirements covered: COMP-01, COMP-02, COMP-03, COMP-04, ENDP-01, ENDP-02, ENDP-03, ENDP-04, PROTO-01, PROTO-02, PROTO-03, PROTO-04, PROTO-05, FAST-05 (14 total).

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion

All implementation choices are at Claude's discretion — this is a pure infrastructure phase and the stack choices are already locked in `.planning/research/STACK.md`. Use the ROADMAP phase goal, success criteria, REQUIREMENTS.md items, PROJECT.md constraints, and research artifacts to guide decisions. Specifically:

- Package manager: pnpm (per STACK.md)
- Bundler: tsdown (per STACK.md, replaces tsup)
- TypeScript: 6.x stable (per STACK.md)
- Lint/format: Biome (per STACK.md)
- Test: Vitest 4 (with browser mode for later phases; Node environment is sufficient for Phase 1 units)
- E2E: Playwright 1.59 with chromium + firefox + webkit (per STACK.md)
- Versioning: Changesets + `sync-jsr-version.mjs` (per STACK.md and PITFALLS.md)
- CI: GitHub Actions; OIDC trusted publishing for npm + JSR (per STACK.md)
- Baseline bundle MUST NOT require `unsafe-eval` or `wasm-unsafe-eval` (COMP-01)
- Zero runtime dependencies (COMP-02)
- ESM-first with `.d.ts` shipped (COMP-04)
- `exports` map has `"."` (baseline) and `"./wasm"` (reserved, empty for now)
- Origin validation in `createWindowEndpoint` rejects wildcards AND non-matching origins

</decisions>

<code_context>
## Existing Code Insights

Greenfield project — no existing code. The only pre-existing artifact is `.planning/` with PROJECT.md, REQUIREMENTS.md, ROADMAP.md, STATE.md, and the five research files. First commit of source code will land in this phase.

</code_context>

<specifics>
## Specific Ideas

- The `./wasm` export slot is kept reserved in v1 even though no WASM code is shipped — this avoids a breaking package change later if Phase 5 benchmarks justify activating WASM.
- `publint` check runs in CI and locally via `pnpm lint`, not a separate command.
- The Playwright smoke test in this phase should literally be "open a blank page and assert title" — the point is proving the harness works, not testing library logic.
- Seq arithmetic helpers (`seqLT(a, b)`, `seqGT(a, b)`) must pass a fuzz test across the wrap point from day one — this is cheap to add now and prevents PITFALLS item 8 silently.
- Frame encoding uses structured-clone-friendly objects (not ArrayBuffer packing) — keeps the protocol layer JS-idiomatic; byte-level wire format can come later if benchmarks show it matters.

</specifics>

<deferred>
## Deferred Ideas

- Writing the actual session state machine — Phase 2.
- Writing the API adapters (low-level / EventEmitter / WHATWG Streams) — Phase 3.
- Actually publishing to npm and JSR — Phase 10 (CI workflow wiring here, triggering only on tag).
- Picking the final package name — Phase 10 (PUB-01). Use `iframebuffer` as the working placeholder in Phase 1 artifacts.
- Activating WASM — deferred until Phase 5 benchmarks justify (`./wasm` export slot reserved only).

</deferred>
