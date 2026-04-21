# Phase 9: Cross-Browser E2E Test Suite - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning
**Mode:** Auto-generated (YOLO)

<domain>
## Phase Boundary

The full library stack runs and is verified in real Chromium, Firefox, and WebKit browsers across:
1. A basic two-party flow per browser (iframe ↔ parent, worker ↔ main)
2. The three-hop topology (worker → main-thread relay → strict-CSP sandboxed iframe)
3. A strict-CSP test confirming the baseline path works under `sandbox="allow-scripts"` with no `unsafe-eval` / `wasm-unsafe-eval`

This phase covers:
- A **fixture HTTP server** (minimal Node `http.createServer`) that serves the built `dist/index.js` + test pages with per-test CSP / COOP / COEP headers. Starts on a random port; Playwright targets it via `config.use.baseURL`.
- Static test pages under `e2e/fixtures/` — one page per scenario, loading the library via `<script type="module" src="/dist/index.js">`. The library must be built (`pnpm build`) before E2E runs.
- Playwright specs under `e2e/` — one per scenario, three browser projects (chromium, firefox, webkit) already configured in Phase 1's `playwright.config.ts`.
- **Zero flakes on five consecutive runs** — success criterion 1 requires determinism; use fixed-size payloads, no timers without upper bounds, disable animation, etc.
- CI integration: update `.github/workflows/ci.yml` to run the new E2E tests on `ubuntu-latest --with-deps` (chromium + firefox + webkit all install via `pnpm exec playwright install --with-deps`).

This phase explicitly does NOT include:
- Real browser SAB + COOP/COEP test under Playwright (would require `--disable-web-security` or a special COI origin — adds configuration complexity; the Phase 6 Node tests prove functional correctness. Defer to a follow-up if browser-specific SAB data is needed.)
- Mobile browser testing (Playwright has Mobile Chrome emulation but doesn't change the engine; real iOS Safari requires device)
- Performance benchmarks in browser (Phase 5 deferred browser benchmarks; this phase is correctness-only)

Requirements covered: TEST-03, TEST-04, TEST-05, COMP-03.

</domain>

<decisions>
## Implementation Decisions

### Fixture server

- `e2e/fixtures/server.ts` — minimal Node `http.Server` that:
  - Serves `dist/*` as JS modules
  - Serves `e2e/fixtures/pages/*.html` with configurable CSP headers (lookup table per URL path)
  - Listens on a random port (port 0); returns the port via an exported `startFixtureServer(opts)` that returns `{ url, close }`
- Playwright's `globalSetup` / `globalTeardown` in `playwright.config.ts` spins up this server for the duration of the test run
- Or simpler: each spec starts its own via a `beforeAll` + teardown hook — avoids global state

### Test pages

Each test gets a dedicated HTML file under `e2e/fixtures/pages/`:
- `two-party-iframe.html` — parent + iframe, demo stream
- `two-party-worker.html` — main + worker stream
- `three-hop.html` — worker + main relay + sandboxed strict-CSP iframe
- `strict-csp-iframe.html` — outer page with a sandboxed iframe whose `csp` attribute enforces strict CSP (no eval)

All pages import the library from `/dist/index.js` served by the fixture server.

### WebKit limitations locally

- Pre-existing: WebKit can't run locally on this Arch host (ICU 74/78 ABI mismatch)
- Same pattern as earlier phases: `pnpm test:e2e` locally runs chromium + firefox; CI runs all three via `ubuntu-latest --with-deps`
- Test writer: confirm chromium + firefox locally, trust CI for webkit

### Flake prevention

- Pre-build `dist/` before test start (`pnpm build` in CI job before `pnpm test:e2e`)
- No arbitrary sleeps — use `page.waitForFunction`, `locator.toHaveText`, or explicit message-delivery promises
- Close streams / channels on test teardown to prevent hanging listeners
- Random ports to avoid collision across concurrent test runs

### Three-hop topology

- Worker creates a Channel to the main thread
- Main thread creates a second Channel to the sandboxed iframe
- Main thread runs a `createRelayBridge(workerChannel, iframeChannel)`
- Worker produces a stream of N chunks
- Iframe consumer receives and reports back via `console.log` (page.on('console')) or a `window.postMessage` ack pattern that Playwright observes
- Assert: all N chunks arrived in order, backpressure worked (stream doesn't OOM when slowed)

### Strict-CSP

- Sandboxed iframe with `sandbox="allow-scripts"` — no `allow-same-origin`, no CSP relaxations
- The iframe's HTML has `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'">` — no `unsafe-eval`, no `wasm-unsafe-eval`
- Library loads and completes a 1 MB stream transfer
- Assert no console errors about CSP violations

</decisions>

<code_context>
## Existing Code Insights

- `playwright.config.ts` configures 3 browser projects already
- Phase 1 E2E smoke test exists at `e2e/smoke.spec.ts`
- `dist/index.js` is built by `pnpm build` (tsdown)
- `dist/index.js` is ESM; pages import it as a module
- The library's `createChannel`, `createStream`, `createLowLevelStream`, `createRelayBridge`, etc. are all exported

## Webkit caveat (local)

- Arch Linux ICU 74 vs 78 ABI mismatch prevents local WebKit. Document clearly. CI ubuntu-latest covers it.

</code_context>

<specifics>
## Specific Ideas

- Fixture server: make it a helper module `e2e/fixtures/server.ts` that the specs import + start inline. No global state. Predictable.
- CSP per path: simple lookup `{ '/three-hop.html': 'default-src ...', '/strict-csp.html': '...' }`. Pass into server constructor.
- Use `page.waitForEvent('console', { predicate: msg => msg.text().includes('DONE') })` as a simple "test complete" signal from inside the page.
- For three-hop: have each hop emit a console.log at completion with a sentinel string that Playwright can assert on.

</specifics>

<deferred>
## Deferred Ideas

- Browser SAB benchmark under COOP/COEP headers — complex setup, defer unless numbers are needed
- Mobile emulation — not in scope
- Visual regression / screenshot tests — not relevant for this library

</deferred>
