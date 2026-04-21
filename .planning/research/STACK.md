# Stack Research

**Domain:** High-throughput postMessage streaming library (TypeScript, ESM-first, browser-only, zero runtime deps)
**Researched:** 2026-04-21
**Confidence:** HIGH (majority of picks verified via official docs + multiple sources; WASM section MEDIUM due to deferred-decision nature)

---

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

---

## Installation

```bash
# Package manager
npm install -g pnpm

# Initialize with pnpm
pnpm init

# Core build
pnpm add -D tsdown typescript

# Test runner + browser mode + coverage
pnpm add -D vitest @vitest/browser @vitest/coverage-v8 playwright @playwright/test

# Lint + format
pnpm add -D @biomejs/biome

# Package validation (run at publish time, not installed as deps)
# npx publint
# npx attw --pack .

# Release management
pnpm add -D @changesets/cli

# TS executor for scripts
pnpm add -D tsx
```

---

## WASM Toolchain Decision Matrix

Deferred until benchmarks show JS hits a measurable ceiling. Decision must be made now so the build pipeline slot is reserved.

### Options

| Toolchain | Output Quality | CSP Safety | DX for TS Author | Binary Size | Maturity | Verdict |
|-----------|---------------|------------|------------------|-------------|----------|---------|
| **Rust + wasm-bindgen + wasm-pack** | Excellent (SIMD, fine-grained Transferable) | MEDIUM risk: `js_sys::global` uses `Function` constructor by default — violates strict CSP unless the crate avoids `js_sys::global` entirely. Workaround: write bindings manually without `js_sys::global`. | Moderate (learn Rust) | Small (manual no_std possible) | HIGH (most mature, wasm-pack 0.13+, wasm-bindgen 0.2.118) | **WINNER — with CSP caveat** |
| AssemblyScript | Good | SAFE: compiles to a plain `.wasm` binary; JS glue is hand-written, so no `eval`. | HIGH (TypeScript-like syntax, instant onramp) | Very small | MEDIUM (0.28.x, active) | Strong alternative if Rust is not available |
| Zig | Good | SAFE: no generated JS glue | LOW (unfamiliar syntax, no TypeScript alignment) | Smallest possible | LOW (experimental Wasm target) | Reject for this project |
| Emscripten (C/C++) | Excellent for compute-heavy | LOW risk but large JS glue often uses `eval` | LOW (C++ DX for a TS author) | Large (Emscripten runtime) | HIGH (mature) | Reject: wrong DX profile |
| Raw Wasm (hand-written WAT) | Maximum control | SAFE | Very LOW | Minimal | — | Reject: maintenance cost |

### Recommendation: Rust + wasm-pack, with explicit CSP-safe glue constraint

The WASM module's purpose in this library is likely ring-buffer logic for the SAB fast path or optional compression (zstd/lz4 via pure Wasm). Neither requires `js_sys::global`. The constraint is: **the Rust crate must not import `js_sys` at the crate root** — only use `web_sys` bindings that are passed in as arguments. This is achievable and keeps `wasm-unsafe-eval` unnecessary.

The compiled `.wasm` file is loaded via `WebAssembly.instantiateStreaming()` / `WebAssembly.compile()` from the JS wrapper — no `eval` involved. The JS glue from wasm-bindgen uses `TextDecoder`, `Uint8Array`, etc., which are all CSP-safe.

**AssemblyScript is the fallback** if the Rust-side CSP constraint proves too invasive or if Rust expertise is not available. It produces equivalent output for buffer manipulation and has zero CSP concerns.

**CSP interaction summary:**
- Baseline (postMessage fallback path): No WASM at all → zero CSP requirements.
- WASM opt-in path: Requires `script-src 'wasm-unsafe-eval'` in the caller's CSP — this is explicitly the caller's opt-in, documented in the library. The library must never require `wasm-unsafe-eval` to fall back to the JS path.

---

## Dual-Publish Flow (npm + JSR)

### Configuration

Two config files live at the repo root:

**`package.json`** — describes the compiled npm artifact:
```json
{
  "name": "<package-name>",
  "version": "0.0.0",
  "type": "module",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "sideEffects": false
}
```

**`jsr.json`** — describes the TypeScript source artifact for JSR:
```json
{
  "name": "@scope/<package-name>",
  "version": "0.0.0",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

JSR publishes TypeScript source directly (no compile step required). npm publishes compiled `dist/`. Both are triggered by the same changesets release PR merge.

### GitHub Actions Workflow (`.github/workflows/publish.yml`)

```yaml
name: Publish

on:
  push:
    branches: [main]

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: write      # for changesets to push version commits
      id-token: write      # required for OIDC (npm trusted publishing + JSR OIDC)
      pull-requests: write # for changesets PR creation

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: https://registry.npmjs.org

      - run: pnpm install --frozen-lockfile

      - name: Build
        run: pnpm build   # tsdown --dts

      - name: Validate package
        run: |
          npx publint
          npx attw --pack .

      - name: Publish to npm (trusted, OIDC)
        run: pnpm publish --access public --no-git-checks
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}  # or use trusted publishing

      - name: Publish to JSR (OIDC, no token needed)
        run: npx jsr publish
```

Provenance attestations are auto-generated when publishing from GitHub Actions via OIDC. npm CLI v11.5.1+ required for trusted publishing.

### Version Sync

Changesets manages version bumps. One caveat: changesets does not natively sync `jsr.json`. Add a `version` script in `package.json`:

```json
"scripts": {
  "version": "changeset version && node scripts/sync-jsr-version.mjs"
}
```

The sync script reads `package.json` version and writes it to `jsr.json`. This is a 10-line script.

---

## Real-Browser Test Strategy

### Split: Unit tests (Vitest browser mode) vs E2E topology tests (Playwright standalone)

**Vitest + Playwright provider** handles:
- Same-context unit tests of framing/chunking/ordering logic
- Single-hop postMessage tests (iframe ↔ parent, worker ↔ main)
- Benchmarks (`bench()` blocks run in real browser via browser mode)

**Playwright standalone** (`@playwright/test`) handles:
- Multi-hop topology tests (worker → main relay → sandboxed iframe)
- Cross-browser matrix (Chromium, Firefox, WebKit)
- Strict-CSP tests (use `page.setExtraHTTPHeaders` or a fixture server with the appropriate `Content-Security-Policy` response header)
- Service worker tests (Chromium only — verified limitation)

### Topology test pattern (Playwright)

Tests serve a local fixture page via Playwright's built-in server or a simple `http.createServer`. The fixture HTML sets up the multi-hop topology, and the test orchestrates it via `page.evaluate()` and `page.exposeFunction()`. No external HTTP server required — Playwright's `page.route()` can serve synthetic responses.

For the strict-CSP sandboxed iframe test:
- The iframe is loaded via `srcdoc` attribute or a `data:` URL with `sandbox="allow-scripts"`.
- The iframe has no `allow-same-origin` — no shared memory, SAB unavailable.
- Test verifies that the library's postMessage fallback path delivers all chunks with correct ordering.

### Worker tests

```typescript
// Example Playwright web worker test pattern
const workerResponse = await page.evaluate(() => {
  return new Promise((resolve) => {
    const worker = new Worker('/fixtures/sender.worker.js', { type: 'module' });
    worker.postMessage({ cmd: 'stream', bytes: 1024 * 1024 });
    worker.onmessage = (e) => resolve(e.data);
  });
});
```

### Service worker tests

Service worker routing via `page.context().route()` works on Chromium only. For cross-browser correctness of the fallback path, mock the service-worker-side sender as a regular worker (since the library's postMessage interface is context-agnostic, this is a valid substitution).

---

## Benchmark Harness Design

### In-browser benchmarks (primary)

Vitest's `bench()` API (tinybench under the hood) runs inside a real browser via the Playwright provider. This is the correct environment because:
- GC pressure from structured clone shows up correctly
- ArrayBuffer transfer semantics are real, not simulated
- SAB availability is real (Chromium with COOP/COEP headers; not available in Firefox/WebKit without isolation)

```typescript
import { bench, describe } from 'vitest';

describe('transfer 1 MB ArrayBuffer', () => {
  bench('naive postMessage', async () => { /* ... */ });
  bench('iframebuffer stream', async () => { /* ... */ });
});
```

Metric axes: bytes/transfer size × data type (ArrayBuffer, structured clone, ReadableStream) × topology (1-hop, 2-hop, 3-hop).

Custom throughput metrics (MB/s) can be computed in a `afterAll` reporter hook since tinybench exposes ops/s and payload size is known.

### CI benchmark regression

Use Vitest's benchmark snapshot reporter or a custom reporter that writes a JSON results file, then compare against a baseline artifact stored in CI. Flag regressions > 10% as failures. CodSpeed (third-party SaaS) integrates with Vitest bench if automated regression tracking is wanted without building a custom reporter.

### Real-browser benchmark runner (in docs site)

VitePress pages can import and run the benchmark suite client-side for human-readable results shown on the docs site. This requires the benchmark code to be importable as an ESM module — structure accordingly.

---

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

---

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

---

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

---

## tsconfig.json Recommended Settings

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests", "benchmarks"]
}
```

`moduleResolution: bundler` is the correct 2026 setting for tsdown-bundled libraries. It resolves `.ts` imports without requiring `.js` extensions in source while still producing correct `.d.ts` output.

---

## Strict CSP Compatibility Checklist

Every decision above was evaluated against the constraint that the library's baseline postMessage-only path requires no `unsafe-eval`, no `wasm-unsafe-eval`.

| Concern | Status | Detail |
|---------|--------|--------|
| Library runtime | SAFE | Zero runtime deps; no `eval`, no `Function` constructor, no dynamic `import()` of external URLs |
| tsdown build output | SAFE | Rolldown-compiled ESM; no generated `eval` wrappers |
| Vitest browser mode | SAFE (tests only) | Vitest uses iframes internally; not shipped to end users |
| VitePress docs site | SAFE | Static site; no eval needed |
| WASM baseline path | N/A (deferred) | No WASM in baseline |
| WASM opt-in path | Requires `wasm-unsafe-eval` | Caller explicitly opts in; documented requirement |
| wasm-bindgen generated glue | MEDIUM risk | Avoid `js_sys::global` in Rust crate — this is the only wasm-bindgen CSP landmine |

---

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

---
*Stack research for: iframebuffer — postMessage streaming library*
*Researched: 2026-04-21*
