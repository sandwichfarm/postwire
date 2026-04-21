---
phase: 09-cross-browser-e2e
plan: "01"
subsystem: testing
tags: [playwright, e2e, cross-browser, chromium, firefox, webkit, csp, iframe, worker, relay]

# Dependency graph
requires:
  - phase: 07-relay-bridge
    provides: createRelayBridge for three-hop topology test
  - phase: 03-channel
    provides: createChannel, createLowLevelStream, createMessagePortEndpoint APIs
provides:
  - Playwright E2E suite covering two-party iframe/worker, three-hop relay, and strict-CSP scenarios
  - e2e/fixtures/server.ts: minimal Node http fixture server with per-path CSP headers
  - e2e/fixtures/pages/: 7 HTML/JS fixture pages for all test scenarios
  - e2e/two-party.spec.ts, three-hop.spec.ts, strict-csp.spec.ts: 4 spec files (+ smoke)
  - pnpm test:e2e:local script targeting chromium + firefox (webkit CI-only)
affects: [ci, publishing, future-phases]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fixture server pattern: per-spec beforeAll/afterAll server lifecycle with per-path CSP headers"
    - "External module scripts for strict-CSP compat: sandbox-inner.html uses <script src=...> not inline"
    - "DONE console.log sentinel: test completion signaled via console.log('DONE') caught by page.waitForEvent"
    - "MessageChannel-based inter-context communication in all fixture pages (no createWindowEndpoint)"

key-files:
  created:
    - e2e/fixtures/server.ts
    - e2e/fixtures/pages/two-party-iframe.html
    - e2e/fixtures/pages/two-party-worker.html
    - e2e/fixtures/pages/three-hop.html
    - e2e/fixtures/pages/strict-csp.html
    - e2e/fixtures/pages/sandbox-inner.html
    - e2e/fixtures/pages/sandbox-inner-module.js
    - e2e/fixtures/pages/iframe-inner.html
    - e2e/two-party.spec.ts
    - e2e/three-hop.spec.ts
    - e2e/strict-csp.spec.ts
    - e2e/smoke.spec.ts
  modified:
    - playwright.config.ts
    - package.json
    - .github/workflows/ci.yml
    - biome.json

key-decisions:
  - "Applied strict CSP header to sandbox-inner.html (the inner iframe page), not the outer page — outer page has inline scripts that require 'unsafe-inline'"
  - "Extracted sandbox-inner inline script to sandbox-inner-module.js so CSP 'script-src self' allows it"
  - "Used sandbox='allow-scripts allow-same-origin' for strict-csp iframe so 'self' resolves to server origin"
  - "Fixture server applies per-path CSP via opts.cspByPath lookup table; each spec controls its own headers"
  - "test:e2e:local uses --project=chromium --project=firefox; webkit remains CI-only (Arch ICU mismatch)"
  - "testDir changed from tests/e2e to e2e; existing smoke.spec.ts copied to new location"
  - "Three-hop page uses SETUP/UPSTREAM_PORT/GO three-message handshake to sequence relay creation before data flow"

patterns-established:
  - "E2E pattern: each spec creates its own fixture server in beforeAll with scenario-specific opts"
  - "Console sentinel: pages signal completion with console.log('DONE') rather than DOM mutations"
  - "Worker code: inline blob URL workers with type:module for dependency isolation in tests"

requirements-completed: [TEST-03, TEST-04, TEST-05, COMP-03]

# Metrics
duration: 10min
completed: 2026-04-21
---

# Phase 9 Plan 01: Cross-Browser E2E Test Suite Summary

**Playwright E2E suite covering iframe/worker two-party, three-hop relay, and strict-CSP scenarios across Chromium and Firefox (10 tests, all passing)**

## Performance

- **Duration:** 10 min
- **Started:** 2026-04-21T18:21:15Z
- **Completed:** 2026-04-21T18:31:30Z
- **Tasks:** 2
- **Files modified:** 14

## Accomplishments

- Fixture HTTP server (`e2e/fixtures/server.ts`) with per-path CSP header support, random port, and correct MIME types for `.js` module files
- Three scenario spec files pass in Chromium and Firefox: two-party iframe + worker (1 MB each), three-hop relay topology, strict-CSP with `default-src 'self'; script-src 'self'`
- `pnpm test:e2e:local` added for local runs; CI job updated to use the full `pnpm test:e2e` (all 3 browsers)

## Task Commits

1. **Task 1: Fixture server + test pages** - `a9871ef` (feat)
2. **Task 2: Playwright specs + config update** - `d112d2d` (feat)

## Files Created/Modified

- `e2e/fixtures/server.ts` - Node http fixture server with CSP per path and MIME-type-aware responses
- `e2e/fixtures/pages/two-party-iframe.html` - Parent sends 1 MB to same-origin iframe via MessageChannel
- `e2e/fixtures/pages/two-party-worker.html` - Main sends 1 MB to blob-URL module worker via MessageChannel
- `e2e/fixtures/pages/three-hop.html` - Worker producer → main relay → sandboxed iframe consumer via createRelayBridge
- `e2e/fixtures/pages/strict-csp.html` - Outer page wires 1 MB transfer to CSP-strict inner iframe
- `e2e/fixtures/pages/sandbox-inner.html` - Shared inner page; uses external module script for CSP compat
- `e2e/fixtures/pages/sandbox-inner-module.js` - External JS module loaded under strict CSP header
- `e2e/fixtures/pages/iframe-inner.html` - Receiver for two-party-iframe test
- `e2e/two-party.spec.ts` - Two tests: iframe↔parent and worker↔main 1 MB delivery
- `e2e/three-hop.spec.ts` - One test: worker→relay→iframe 1 MB delivery (30 s timeout)
- `e2e/strict-csp.spec.ts` - One test: strict CSP on sandbox-inner, no CSP violations, DONE fires
- `playwright.config.ts` - testDir changed from `tests/e2e` to `e2e`
- `package.json` - Added `test:e2e:local` (chromium + firefox)
- `.github/workflows/ci.yml` - Renamed E2E step to reflect 3-browser coverage
- `biome.json` - Added `e2e/**` to lint includes

## Decisions Made

- **CSP target**: Applied `default-src 'self'; script-src 'self'` to `sandbox-inner.html` (the inner iframe page) not the outer page. The outer page has inline `<script type="module">` code which would be blocked by `script-src 'self'` without `'unsafe-inline'`. The inner page exclusively uses an external module script, making it fully CSP-compliant.
- **External module for CSP**: Created `sandbox-inner-module.js` and switched `sandbox-inner.html` from inline script to `<script type="module" src="/sandbox-inner-module.js">`. CSP `'self'` allows same-origin module loads.
- **sandbox attributes**: Used `sandbox="allow-scripts allow-same-origin"` so the iframe maintains the same origin as the server (`http://127.0.0.1:PORT`), allowing `'self'` in the CSP to match `/dist/index.js` and `/sandbox-inner-module.js`.
- **Fixture server per-spec**: Each spec starts its own fixture server in `beforeAll` rather than using Playwright's `globalSetup`, avoiding shared state between specs.
- **Console sentinel**: All test pages signal completion with `console.log("DONE")` captured by `page.waitForEvent("console", { predicate: msg => msg.text() === "DONE" })`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CSP blocked inline scripts on strict-csp outer page**
- **Found during:** Task 2 (Playwright specs — strict-csp test timed out)
- **Issue:** The plan applied strict CSP to `/strict-csp.html` (the outer page). This page has an inline `<script type="module">` block. CSP `default-src 'self'; script-src 'self'` blocks all inline scripts, so the library never loaded and DONE was never logged.
- **Fix:** Moved the CSP header target to `/sandbox-inner.html` (the inner iframe page). Extracted the inline script logic from `sandbox-inner.html` into `sandbox-inner-module.js` (external file). The inner page now uses `<script type="module" src="/sandbox-inner-module.js">` which is allowed by `script-src 'self'`.
- **Files modified:** `e2e/fixtures/pages/sandbox-inner.html`, `e2e/fixtures/pages/sandbox-inner-module.js` (new), `e2e/strict-csp.spec.ts`
- **Verification:** `pnpm test:e2e:local` — strict-csp test passes in chromium and firefox in ~200 ms, no CSP violations
- **Committed in:** `d112d2d` (Task 2 commit)

**2. [Rule 2 - Missing Critical] Added MIME type support for .js fixture files**
- **Found during:** Task 2 (fixture server needed to serve `.js` modules)
- **Issue:** The original `server.ts` used `Content-Type: text/html` for all pages. `sandbox-inner-module.js` needed `application/javascript` so browsers would accept it as a module.
- **Fix:** Added `mimeType()` helper to `server.ts` that returns correct content-type based on file extension.
- **Files modified:** `e2e/fixtures/server.ts`
- **Committed in:** `d112d2d` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical)
**Impact on plan:** Both fixes required for the strict-csp scenario to pass. No scope creep — the two-party and three-hop scenarios executed exactly as planned.

## Issues Encountered

- Biome a11y rules flagged missing `lang` attribute on HTML elements and missing `title` attributes on iframes — added during Task 1 to satisfy lint.
- Biome import organization rules required `import type` before value imports from same module — fixed during Task 2.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Full E2E suite passing in Chromium and Firefox locally; WebKit covered on CI (ubuntu-latest)
- The three-hop and strict-CSP scenarios validate the relay bridge and CSP-safety properties required for the library's core value proposition
- Test infrastructure (fixture server + HTML pages) is extensible for future scenarios (SAB/COOP/COEP, service worker)

---
*Phase: 09-cross-browser-e2e*
*Completed: 2026-04-21*
