<!-- GSD:project-start source:PROJECT.md -->
## Project

**iframebuffer *(working name)***

A JavaScript library (with WASM if benchmarks justify it) that streams arbitrary data at high bitrate over any postMessage boundary — iframe, web worker, service worker, MessageChannel. Consumers import it on both sides of a boundary and wire it into their existing postMessage handlers rather than replacing the channel. The library handles framing, chunking, ordering, and feature-detected fast paths (SharedArrayBuffer when available) so the caller gets stream semantics out of what's normally a one-shot message API.

The audience is developers who already have postMessage wiring — sandboxed iframes, worker pools, service-worker caches, cross-origin embeds — and want to push real data volume across it without reinventing framing each time.

**Core Value:** **A high-throughput, reliable, ordered stream abstraction that slots into any existing postMessage boundary with minimal caller-side code.**

If everything else gets cut, these three properties must hold: (1) it works wherever postMessage works, (2) the caller wires it into their own channel, (3) it measurably beats naive postMessage chunking.

### Constraints

- **Tech stack**: TypeScript source, ESM-first distribution — types shipped, CJS only if cheap. Rationale: modern ecosystem, JSR-native, fewer packaging footguns.
- **Runtime**: Browser-only for v1 (Chrome, Firefox, Safari — latest-2 evergreen). Rationale: focus; cross-runtime is a separate milestone.
- **Dependencies**: Keep runtime deps near-zero. Benchmarks and tests can have dev deps. Rationale: library is meant to slot into security-sensitive contexts (sandboxed iframes, CSP-restricted pages) where each transitive dep is audit surface.
- **Testing**: Cross-context tests must use real browsers via Playwright (browser-harness is already available on this system); mocked postMessage is not sufficient because structured-clone behavior and Transferable semantics vary by real engine.
- **Compatibility**: Must work under strict CSP (`unsafe-eval` and `wasm-unsafe-eval` forbidden) in the postMessage-only fallback path. WASM / SAB paths may relax this with explicit caller opt-in.
- **Performance**: Must materially beat naive postMessage chunking on at least binary payloads — if the benchmark doesn't show a clear win, the library has no reason to exist.
- **Publishing**: Final package name must be available on both npm and jsr. Picking the name is a pre-v1 deliverable.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Core Technologies
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| TypeScript | 6.0.x | Source language | Latest stable JS-based release (shipped March 2026). TS 7 (Go-native) is in preview-only; use 6.0 for stability. `isolatedModules`, `verbatimModuleSyntax`, `moduleResolution: bundler` are the correct 2026 settings for an ESM-first library. |
| tsdown | 0.20.x | Library bundler | Direct spiritual successor to tsup; powered by Rolldown instead of esbuild. Produces ESM + optional CJS, tree-shakeable, DTS bundling, ~10× faster than tsup on large builds. Actively maintained by the Rolldown/VoidZero org. The only reason to fall back to tsup is if you hit a tsdown 0.x stability issue (it is pre-1.0). |
| Vitest | 4.1.x | Unit test runner | Browser Mode is stable as of v4.0 (December 2025). Benchmarking via tinybench is built-in and works in browser mode. Native TypeScript, zero-config with Vite/tsdown ecosystem. Same config as the build tool — no separate Jest transform setup. |
| Playwright | 1.59.x | E2E / cross-context browser tests | The only realistic option for testing real iframe + worker + service-worker topologies against Chrome, Firefox, and WebKit. Service worker routing is Chromium-only in Playwright (Firefox/WebKit don't expose it), which matches the library's needs. Used as Vitest Browser Mode provider AND as the standalone E2E harness for multi-context topology tests. |
| Biome | 2.4.x | Linter + formatter | Rust-based, formats in 0.3 s and lints in 0.8 s across 10k files. Single tool replaces ESLint + Prettier. Type-aware lint rules available natively in v2 (codename Biotype) without needing the TS language service via a separate plugin. Greenfield projects in 2026 have no reason to start with ESLint + Prettier. |
### Supporting Libraries (dev-only, zero runtime deps guaranteed)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| tinybench | latest | Benchmark engine (Vitest bench uses it internally) | Powering `bench()` blocks; also usable standalone when building custom CI throughput reporters outside Vitest. |
| publint | latest | Package validation (exports map, CJS/ESM hygiene) | Run `npx publint` before every npm publish. Catches mismatched `exports` entries, missing type declarations, and subpath issues. |
| @arethetypeswrong/cli | latest | TypeScript types correctness validation | Run `npx attw --pack .` before every npm publish. Catches issues publint misses (e.g., wrong resolution mode for CJS consumers). Use both. |
| @changesets/cli | latest | Version and changelog management | Manages semver bumps and CHANGELOG generation, triggers both npm and JSR publish steps from a single changeset PR merge. |
| @vitest/coverage-v8 | 4.1.x | Coverage via V8 (not Istanbul) | V8 coverage is the correct provider for browser mode. Istanbul provider has known issues with Vitest browser mode. |
| wasm-bindgen-cli | 0.2.118 | Rust → WASM glue (DEFERRED, but install now) | When the WASM milestone is triggered, this is the CLI that generates JS bindings. Pin it to match the `wasm-bindgen` crate version in Cargo.toml. |
| wasm-pack | latest stable | Rust → WASM → npm package pipeline (DEFERRED) | Wraps wasm-bindgen-cli + cargo build + package.json generation into one command. Required for the WASM milestone. |
### Documentation and Examples Sites
| Tool | Version | Purpose | Why |
|------|---------|---------|-----|
| VitePress | 1.6.x (stable) | Documentation site | The 1.x stable line is the right call — v2.0 is in alpha (v2.0.0-alpha.17 as of March 2026) and not production-ready yet. VitePress 1.6 is fast, Vue-based, Markdown-first, integrates natively with Vite. Used for the API reference + benchmark results write-up site. |
| VitePress (examples sub-site) | same | Runnable examples site | Use VitePress's `<script setup>` Vue components in Markdown pages to embed live iframe demos. The three-hop topology example (worker → relay → sandboxed iframe) can be served as a live page. Keep it in the same VitePress instance under `/examples/` to avoid maintaining two separate static site configs. |
### Development Tools
| Tool | Purpose | Notes |
|------|---------|-------|
| pnpm | Package manager | Strict dependency hoisting prevents phantom deps — critical for a zero-runtime-dep library where accidental transitive imports are a real risk. `pnpm audit` catches security issues. Use `pnpm --filter` for workspace commands if the project grows to a monorepo. |
| tsx | TypeScript executor (no compile step) | Used for running scripts (benchmark reporters, fixture generators) directly. Faster than `ts-node`. |
| `@vitest/browser` + Playwright provider | Vitest browser mode wiring | `vitest --browser` uses Playwright under the hood; each test file gets an isolated `BrowserContext`. This is the unit test harness for postMessage/worker/iframe unit tests. |
| GitHub Actions | CI/CD | OIDC-based trusted publishing for both npm and JSR. No long-lived tokens stored in secrets. |
## Installation
# Package manager
# Initialize with pnpm
# Core build
# Test runner + browser mode + coverage
# Lint + format
# Package validation (run at publish time, not installed as deps)
# npx publint
# npx attw --pack .
# Release management
# TS executor for scripts
## WASM Toolchain Decision Matrix
### Options
| Toolchain | Output Quality | CSP Safety | DX for TS Author | Binary Size | Maturity | Verdict |
|-----------|---------------|------------|------------------|-------------|----------|---------|
| **Rust + wasm-bindgen + wasm-pack** | Excellent (SIMD, fine-grained Transferable) | MEDIUM risk: `js_sys::global` uses `Function` constructor by default — violates strict CSP unless the crate avoids `js_sys::global` entirely. Workaround: write bindings manually without `js_sys::global`. | Moderate (learn Rust) | Small (manual no_std possible) | HIGH (most mature, wasm-pack 0.13+, wasm-bindgen 0.2.118) | **WINNER — with CSP caveat** |
| AssemblyScript | Good | SAFE: compiles to a plain `.wasm` binary; JS glue is hand-written, so no `eval`. | HIGH (TypeScript-like syntax, instant onramp) | Very small | MEDIUM (0.28.x, active) | Strong alternative if Rust is not available |
| Zig | Good | SAFE: no generated JS glue | LOW (unfamiliar syntax, no TypeScript alignment) | Smallest possible | LOW (experimental Wasm target) | Reject for this project |
| Emscripten (C/C++) | Excellent for compute-heavy | LOW risk but large JS glue often uses `eval` | LOW (C++ DX for a TS author) | Large (Emscripten runtime) | HIGH (mature) | Reject: wrong DX profile |
| Raw Wasm (hand-written WAT) | Maximum control | SAFE | Very LOW | Minimal | — | Reject: maintenance cost |
### Recommendation: Rust + wasm-pack, with explicit CSP-safe glue constraint
- Baseline (postMessage fallback path): No WASM at all → zero CSP requirements.
- WASM opt-in path: Requires `script-src 'wasm-unsafe-eval'` in the caller's CSP — this is explicitly the caller's opt-in, documented in the library. The library must never require `wasm-unsafe-eval` to fall back to the JS path.
## Dual-Publish Flow (npm + JSR)
### Configuration
### GitHub Actions Workflow (`.github/workflows/publish.yml`)
### Version Sync
## Real-Browser Test Strategy
### Split: Unit tests (Vitest browser mode) vs E2E topology tests (Playwright standalone)
- Same-context unit tests of framing/chunking/ordering logic
- Single-hop postMessage tests (iframe ↔ parent, worker ↔ main)
- Benchmarks (`bench()` blocks run in real browser via browser mode)
- Multi-hop topology tests (worker → main relay → sandboxed iframe)
- Cross-browser matrix (Chromium, Firefox, WebKit)
- Strict-CSP tests (use `page.setExtraHTTPHeaders` or a fixture server with the appropriate `Content-Security-Policy` response header)
- Service worker tests (Chromium only — verified limitation)
### Topology test pattern (Playwright)
- The iframe is loaded via `srcdoc` attribute or a `data:` URL with `sandbox="allow-scripts"`.
- The iframe has no `allow-same-origin` — no shared memory, SAB unavailable.
- Test verifies that the library's postMessage fallback path delivers all chunks with correct ordering.
### Worker tests
### Service worker tests
## Benchmark Harness Design
### In-browser benchmarks (primary)
- GC pressure from structured clone shows up correctly
- ArrayBuffer transfer semantics are real, not simulated
- SAB availability is real (Chromium with COOP/COEP headers; not available in Firefox/WebKit without isolation)
### CI benchmark regression
### Real-browser benchmark runner (in docs site)
## Alternatives Considered
| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Bundler | tsdown | tsup | tsup is functionally abandoned (author's own statement, April 2026); tsdown is its direct replacement with better DTS and faster builds |
| Bundler | tsdown | Rollup directly | More configuration, no native DTS, tsdown adds the library-specific ergonomics you'd build yourself |
| Bundler | tsdown | unbuild | unbuild is solid but less active than tsdown now that Rolldown org maintains tsdown |
| Linter/formatter | Biome | ESLint + Prettier | No reason to choose two tools over one faster tool on a greenfield project; the only missing pieces (framework-specific plugins) are irrelevant to a framework-free library |
| Doc site | VitePress 1.6 | VitePress 2.0-alpha | Alpha is not stable yet; migrate when 2.0 hits stable |
| Doc site | VitePress 1.6 | Starlight (Astro) | Both are valid; VitePress has larger mindshare for TS library docs and Vue's native component model makes embedding live demos easier |
| Doc site | VitePress 1.6 | Docusaurus | React dependency + heavier bundle; overkill for this use case |
| WASM | Rust + wasm-pack | AssemblyScript | AS is a solid fallback; Rust wins on performance ceiling and SIMD |
| WASM | Rust + wasm-pack | Emscripten | DX mismatch; C++ is wrong for this codebase |
| Test runner | Vitest | Jest | Jest has no native browser mode; requires jsdom which cannot replicate structured-clone or Transferable semantics |
| Version mgmt | Changesets | semantic-release | semantic-release has opaque automation; changesets gives human-reviewed changelogs with explicit semver intent per PR |
## What NOT to Use
| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Jest | No real browser mode; structured-clone and Transferable semantics are mocked in jsdom — fundamentally unsuitable for this library's test requirements | Vitest (browser mode) |
| tsup | Functionally abandoned as of early 2026 per the author; no active maintenance | tsdown |
| esbuild (direct) | Good for apps, but weak DTS generation and limited plugin ecosystem for library packaging | tsdown (wraps Rolldown, which handles DTS correctly) |
| Rollup (direct) | Valid but requires manual configuration that tsdown provides out of the box | tsdown |
| Cypress | Component testing only for single-page apps; cannot drive multi-context worker + iframe topologies the way Playwright can | Playwright |
| WebdriverIO | Valid but heavier setup; Playwright is faster to configure and better supported as Vitest browser mode provider | Playwright |
| Docusaurus | React + heavy plugin ecosystem; adds unnecessary complexity for a standalone library docs site | VitePress |
| Emscripten | Generates large JS runtime with frequent `eval` / `Function` usage; wrong DX profile for a TypeScript author | Rust + wasm-pack |
| `unsafe-eval` in base CSP | Never require this in the zero-WASM baseline path; it invalidates the library's CSP-safe promise | Structure WASM as an explicit opt-in that callers add `wasm-unsafe-eval` for |
| jsdom / happy-dom in Vitest | Simulation — structured clone is incomplete, Transferable objects are not zero-copy, SharedArrayBuffer is unavailable. Worthless for this domain. | Vitest browser mode (real browser) |
| Long-lived npm tokens | Security antipattern; if leaked the token has permanent publish access | GitHub OIDC trusted publishing (id-token: write permission) |
## Version Compatibility Notes
| Package | Compatible With | Notes |
|---------|-----------------|-------|
| tsdown 0.20.x | TypeScript 6.0.x, Rolldown (bundled) | tsdown bundles its own Rolldown; no separate rolldown install needed |
| vitest 4.1.x | Vite 6.x (requires Vite >=6.0), Node >=20 | tsdown and vitest can share a single `vite.config.ts` root or keep separate configs |
| @vitest/browser | vitest 4.1.x | Must match vitest version exactly; install together |
| playwright 1.59.x | Node >=18 | Service worker routing: Chromium only |
| wasm-bindgen-cli 0.2.118 | wasm-bindgen crate 0.2.118 | CLI and crate versions MUST match exactly or the generated glue is broken |
| TypeScript 6.0.x | wasm-bindgen output | wasm-bindgen generates `.d.ts` compatible with TS 5.x and 6.x |
| VitePress 1.6.x | Vue 3.x, Vite 5.x | Does not require Vite 6; separate from the library's build toolchain |
| Biome 2.4.x | TypeScript 6.0.x | No dependency on the TS compiler for type-aware rules (uses its own type inference) |
## tsconfig.json Recommended Settings
## Strict CSP Compatibility Checklist
| Concern | Status | Detail |
|---------|--------|--------|
| Library runtime | SAFE | Zero runtime deps; no `eval`, no `Function` constructor, no dynamic `import()` of external URLs |
| tsdown build output | SAFE | Rolldown-compiled ESM; no generated `eval` wrappers |
| Vitest browser mode | SAFE (tests only) | Vitest uses iframes internally; not shipped to end users |
| VitePress docs site | SAFE | Static site; no eval needed |
| WASM baseline path | N/A (deferred) | No WASM in baseline |
| WASM opt-in path | Requires `wasm-unsafe-eval` | Caller explicitly opts in; documented requirement |
| wasm-bindgen generated glue | MEDIUM risk | Avoid `js_sys::global` in Rust crate — this is the only wasm-bindgen CSP landmine |
## Sources
- tsdown official docs (tsdown.dev) — bundler choice, Rolldown relationship
- Vitest v4.0 release announcement (voidzero.dev/posts/announcing-vitest-4) — browser mode stable status, benchmark support
- Playwright official docs (playwright.dev/docs/service-workers) — service worker Chromium-only limitation verified
- Biome v2 release blog (biomejs.dev/blog/biome-v2/) — type-aware linting without TS compiler, v2.4 current
- JSR publishing docs (jsr.io/docs/publishing-packages) — OIDC tokenless publish, jsr.json format
- npm trusted publishing docs (docs.npmjs.com/trusted-publishers/) — OIDC, id-token:write, provenance auto-generation
- wasm-bindgen CSP issue tracker (#1641, #1647, #3098) — js_sys::global CSP risk documented
- WebAssembly CSP proposal (github.com/WebAssembly/content-security-policy) — wasm-unsafe-eval semantics
- WebSearch: tsdown 0.20.3 current version, vitest 4.1.4 current version, playwright 1.59.1 current version, biome 2.4.12 current version, TypeScript 6.0.3 current version, assemblyscript 0.28.13 current version, wasm-bindgen-cli 0.2.118 current version, VitePress 1.6.4 stable / 2.0.0-alpha.17
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
