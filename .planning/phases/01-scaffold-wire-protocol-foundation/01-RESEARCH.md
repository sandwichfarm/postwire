# Phase 1: Scaffold + Wire Protocol Foundation - Research

**Researched:** 2026-04-21
**Domain:** TypeScript library scaffold — tsdown bundler, Vitest 4, Playwright 1.59, Biome 2, Changesets, dual npm+JSR OIDC publish, wire protocol discriminated union types
**Confidence:** HIGH (all versions verified against live npm registry; config shapes verified against official docs)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

All implementation choices are at Claude's discretion — this is a pure infrastructure phase and the stack choices are already locked in `.planning/research/STACK.md`. Use the ROADMAP phase goal, success criteria, REQUIREMENTS.md items, PROJECT.md constraints, and research artifacts to guide decisions. Specifically:

- Package manager: pnpm
- Bundler: tsdown (per STACK.md, replaces tsup)
- TypeScript: 6.x stable
- Lint/format: Biome
- Test: Vitest 4 (Node environment is sufficient for Phase 1 units)
- E2E: Playwright 1.59 with chromium + firefox + webkit
- Versioning: Changesets + `sync-jsr-version.mjs`
- CI: GitHub Actions; OIDC trusted publishing for npm + JSR
- Baseline bundle MUST NOT require `unsafe-eval` or `wasm-unsafe-eval` (COMP-01)
- Zero runtime dependencies (COMP-02)
- ESM-first with `.d.ts` shipped (COMP-04)
- `exports` map has `"."` (baseline) and `"./wasm"` (reserved, empty for now)
- Origin validation in `createWindowEndpoint` rejects wildcards AND non-matching origins

### Claude's Discretion

All implementation choices are at Claude's discretion within the locked stack.

### Deferred Ideas (OUT OF SCOPE)

- Writing the actual session state machine — Phase 2
- Writing the API adapters (low-level / EventEmitter / WHATWG Streams) — Phase 3
- Actually publishing to npm and JSR — Phase 10
- Picking the final package name — Phase 10 (use `iframebuffer` as placeholder)
- Activating WASM — deferred until Phase 5 benchmarks
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| COMP-01 | Baseline path requires no `unsafe-eval` or `wasm-unsafe-eval` | Two-entry-point exports structure keeps baseline and wasm bundles separate; tsdown/Rolldown generates no eval wrappers |
| COMP-02 | Zero runtime dependencies | pnpm strict hoisting; `dependencies: {}` in package.json; all tools are devDependencies |
| COMP-03 | Runs in Chrome, Firefox, Safari latest-2 | Playwright 3-browser matrix set up in Phase 1 CI even though full tests land in Phase 9 |
| COMP-04 | ESM-first with TypeScript declarations shipped | tsdown `format: ['esm']` + `dts: true`; `type: "module"` in package.json |
| ENDP-01 | Library accepts any caller-provided PostMessageEndpoint | `PostMessageEndpoint` interface: `postMessage(msg, transfer?)` + `onmessage` setter |
| ENDP-02 | Ships four adapters: Worker, MessagePort, Window, ServiceWorker | Stub adapters in `src/transport/adapters/` — types defined, no postMessage wiring yet |
| ENDP-03 | Window adapter validates `MessageEvent.origin`; rejects non-matching and wildcard | `createWindowEndpoint(win, expectedOrigin)` throws on `"*"`, drops messages with wrong origin |
| ENDP-04 | ServiceWorker endpoint flagged SAB-incapable | `createServiceWorkerEndpoint()` returns endpoint with `sabCapable: false` metadata |
| PROTO-01 | Exactly 7 frame types as TS discriminated union | 8-variant union (OPEN, OPEN_ACK, DATA, CREDIT, CLOSE, CANCEL, RESET, CAPABILITY) — note: CONTEXT.md lists 8 types despite saying "seven" |
| PROTO-02 | Every frame carries channelId, streamId, seqNum; wraparound-safe seq comparison | `BaseFrame` interface + `seqLT/seqGT` helpers with 32-bit modular arithmetic |
| PROTO-03 | DATA frames include `chunkType` tag | `DataFrameChunkType` enum: BINARY_TRANSFER, STRUCTURED_CLONE, STREAM_REF, SAB_SIGNAL |
| PROTO-04 | CAPABILITY handshake; both sides compute min(local, remote) | `CapabilityFrame` shape defined with version + capability flags; negotiation logic deferred to Phase 2 |
| PROTO-05 | Protocol version in CAPABILITY; mismatches surface PROTOCOL_MISMATCH | `protocolVersion: number` field in CapabilityFrame |
| FAST-05 | Feature detection once at channel open, not per chunk | `CapabilityFrame` is the negotiation point; per-chunk switching explicitly excluded |
</phase_requirements>

---

## Summary

Phase 1 is a pure scaffold phase: every deliverable is configuration, type definitions, or trivial pure functions. No postMessage wiring executes in this phase — adapters define types and the Window adapter validates origins, but no actual message dispatch happens.

The stack is fully locked from prior research. The primary research task is nailing down exact concrete config shapes for tsdown 0.21.9, Vitest 4 projects API, Playwright 1.59 3-browser matrix, Biome 2.4.12, and Changesets — and specifying the exact TypeScript shape of the wire protocol discriminated union and seq arithmetic. All these have been verified against live npm versions and official documentation.

The key non-obvious design question for Phase 1 is the Window adapter: should outbound messages use `win.postMessage(msg, targetOrigin)` directly, or extract a `MessageChannel` port? The answer is: **use `win.postMessage(msg, targetOrigin)` directly for outbound** (since we are sending TO the window), with the `expectedOrigin` stored as the `targetOrigin` for sends. Inbound message filtering uses `event.origin === expectedOrigin`. No MessageChannel extraction needed for the adapter itself — that is a caller concern.

The Playwright smoke test for Phase 1 is intentionally trivial: `page.setContent('<title>iframebuffer smoke</title>')` + `expect(page).toHaveTitle('iframebuffer smoke')`. This verifies the Playwright harness works across all three browsers without needing a webServer at all.

**Primary recommendation:** Scaffold everything in one pass. The config files are heavily interdependent (tsdown feeds exports map; exports map drives publint; tsconfig feeds tsdown dts; Vitest config references tsconfig). Set up all configs before writing any source.

---

## Project Constraints (from CLAUDE.md)

The project CLAUDE.md (`./CLAUDE.md`) is a GSD-managed file. Directives extracted:

- Follow GSD workflow — use `/gsd:execute-phase` entry point; do not make direct repo edits outside a GSD workflow
- No system package changes (from global AGENTS.md)
- No `--break-system-packages`
- Use environments (not global pip)
- All temp files go in `/tmp/`, not home directory

No project-specific linting or testing overrides in CLAUDE.md beyond what is already documented in STACK.md.

---

## Standard Stack

### Core (verified against npm registry 2026-04-21)

| Library | Verified Version | Purpose | Why Standard |
|---------|-----------------|---------|--------------|
| typescript | 6.0.3 | Source language + type declarations | Latest stable JS-based release; TS 7 Go-native is preview-only |
| tsdown | 0.21.9 | Library bundler | Rolldown-powered successor to tsup; DTS bundling, tree-shakeable ESM, ~10x faster than tsup |
| vitest | 4.1.4 | Unit test runner | Native TS, browser mode stable in v4, built-in bench via tinybench |
| @vitest/browser | 4.1.4 | Vitest browser mode provider wiring | Must match vitest version exactly |
| @vitest/coverage-v8 | 4.1.4 | Coverage via V8 (not Istanbul) | Istanbul has known issues with Vitest browser mode |
| @playwright/test | 1.59.1 | E2E cross-browser tests | Only realistic option for real iframe/worker/SW topology tests |
| @biomejs/biome | 2.4.12 | Lint + format (replaces ESLint + Prettier) | Rust-based; type-aware rules without TS compiler in v2 |
| @changesets/cli | 2.31.0 | Version management + changelog | Human-reviewed changelogs; JSR version sync scriptable |
| pnpm | 10.33.0 (system) | Package manager | Strict hoisting prevents phantom deps — critical for zero-runtime-dep library |

### Supporting (dev-only)

| Library | Verified Version | Purpose | When to Use |
|---------|-----------------|---------|-------------|
| publint | 0.3.18 | Package exports map validation | Run in CI + locally; catches mismatched exports, missing types |
| @arethetypeswrong/cli | 0.18.2 | TypeScript types correctness validation | Catches issues publint misses (resolution mode); run with `--pack .` |
| tinybench | 6.0.0 | Benchmark engine (Vitest bench uses it internally) | Referenced internally by Vitest; also importable standalone |
| tsx | 4.21.0 | TypeScript executor for scripts | Runs `sync-jsr-version.mjs` and other scripts without compile step |
| @types/node | 25.6.0 | Node type declarations | Needed for scripts/ and vitest config that use Node APIs |

### Installation

```bash
pnpm init
pnpm add -D typescript@6.0.3 tsdown@0.21.9
pnpm add -D vitest@4.1.4 @vitest/browser@4.1.4 @vitest/coverage-v8@4.1.4
pnpm add -D @playwright/test@1.59.1
pnpm add -D @biomejs/biome@2.4.12
pnpm add -D @changesets/cli@2.31.0
pnpm add -D publint@0.3.18 @arethetypeswrong/cli@0.18.2
pnpm add -D tsx@4.21.0 @types/node@25.6.0
```

Install Playwright browsers (one-time, system-level — Playwright is already installed system-wide via pacman at `/usr/lib/node_modules/playwright`, so `npx playwright install` may not be needed; verify before running):

```bash
# Only if not already available at ~/.cache/ms-playwright/
pnpm exec playwright install chromium firefox webkit
```

---

## Architecture Patterns

### Recommended Project Structure

```
iframebuffer/
├── src/
│   ├── framing/
│   │   ├── types.ts           # Discriminated union — 8 frame types
│   │   └── encode-decode.ts   # encode(frame), decode(msg) pure functions
│   ├── transport/
│   │   ├── endpoint.ts        # PostMessageEndpoint interface
│   │   ├── seq.ts             # seqLT, seqGT — 32-bit wraparound-safe
│   │   └── adapters/
│   │       ├── window.ts      # createWindowEndpoint(win, expectedOrigin)
│   │       ├── worker.ts      # createWorkerEndpoint(worker)
│   │       ├── message-port.ts# createMessagePortEndpoint(port)
│   │       └── service-worker.ts # createServiceWorkerEndpoint(sw)
│   ├── session/               # Empty placeholder — Phase 2
│   ├── channel/               # Empty placeholder — Phase 2
│   └── index.ts               # Public API re-exports
├── tests/
│   ├── unit/
│   │   ├── framing/
│   │   │   └── encode-decode.test.ts
│   │   └── transport/
│   │       ├── seq.test.ts
│   │       └── window-adapter.test.ts
│   └── e2e/
│       └── smoke.spec.ts      # Playwright smoke test
├── scripts/
│   └── sync-jsr-version.mjs
├── .changeset/
│   └── config.json
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── publish.yml
├── biome.json
├── jsr.json
├── package.json
├── playwright.config.ts
├── tsconfig.json
├── tsdown.config.ts
└── vitest.config.ts
```

### Pattern 1: package.json Shape

**What:** The package manifest that drives `publint` correctness, ESM-first distribution, and zero-runtime-dep guarantee.

```json
{
  "name": "iframebuffer",
  "version": "0.0.0",
  "type": "module",
  "description": "High-throughput, reliable, ordered stream abstraction over any postMessage boundary",
  "license": "MIT",
  "sideEffects": false,
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./wasm": {
      "import": "./dist/wasm.js",
      "types": "./dist/wasm.d.ts"
    }
  },
  "files": [
    "dist",
    "CHANGELOG.md"
  ],
  "scripts": {
    "build": "tsdown",
    "lint": "biome check . && publint",
    "format": "biome format --write .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "bench": "vitest bench",
    "ci": "pnpm build && pnpm lint && pnpm test && pnpm test:e2e",
    "version": "changeset version && node scripts/sync-jsr-version.mjs",
    "release": "pnpm build && changeset publish"
  },
  "devDependencies": {
    "@arethetypeswrong/cli": "^0.18.2",
    "@biomejs/biome": "^2.4.12",
    "@changesets/cli": "^2.31.0",
    "@playwright/test": "^1.59.1",
    "@types/node": "^25.6.0",
    "@vitest/browser": "^4.1.4",
    "@vitest/coverage-v8": "^4.1.4",
    "publint": "^0.3.18",
    "tinybench": "^6.0.0",
    "tsdown": "^0.21.9",
    "tsx": "^4.21.0",
    "typescript": "^6.0.3",
    "vitest": "^4.1.4"
  }
}
```

**Critical `publint` requirements:**
- `"type": "module"` is required (ESM-first)
- `"sideEffects": false` enables tree-shaking
- Both exports entries need `"import"` and `"types"` conditions
- `"files"` must include `"dist"` — `publint` validates this
- The `"./wasm"` entry must point to files that actually exist at publish time (Phase 1: create stub `src/wasm.ts` that exports nothing, so tsdown produces the dist files)

### Pattern 2: tsdown.config.ts

```typescript
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    wasm: 'src/wasm.ts',
  },
  format: ['esm'],
  dts: true,
  platform: 'browser',
  outDir: 'dist',
  clean: true,
  sourcemap: false,
  treeshake: true,
})
```

**Notes:**
- `platform: 'browser'` ensures no Node-specific polyfills are injected
- `format: ['esm']` only — no CJS; ESM-first per COMP-04; CJS omitted because tsdown uses `fixedExtension: false` by default for non-node platforms meaning output is `.js`, which is correct for ESM `"type": "module"` packages
- `dts: true` uses rolldown-plugin-dts; with `isolatedDeclarations: true` in tsconfig it uses oxc-transform (extremely fast)
- `entry` as object map produces named output files matching the exports map keys: `dist/index.js`, `dist/wasm.js`
- `clean: true` is default but explicit for clarity
- No `external` needed — zero runtime deps means nothing to externalize

### Pattern 3: tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "isolatedDeclarations": true,
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": false,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests", "scripts"]
}
```

**Key settings:**
- `moduleResolution: "bundler"` — correct 2026 setting for tsdown; allows importing `.ts` files without `.js` extensions in source
- `verbatimModuleSyntax: true` — enforces `import type` for type-only imports; required for `isolatedModules`
- `isolatedModules: true` — each file can be compiled in isolation; required for tsdown
- `isolatedDeclarations: true` — NEW in TS 5.5+; enables oxc-transform fast DTS path in tsdown; requires all exported symbols to have explicit type annotations
- `lib: ["ES2022", "DOM", "DOM.Iterable"]` — includes browser types (MessageEvent, Worker, MessagePort, ServiceWorker, etc.) needed for adapter code
- `target: "ES2022"` — supports modern JS; `structuredClone`, optional chaining, nullish coalescing all native

### Pattern 4: Biome Configuration (biome.json)

```json
{
  "$schema": "https://biomejs.dev/schemas/2.4.12/schema.json",
  "files": {
    "includes": [
      "src/**",
      "tests/**",
      "scripts/**",
      "*.ts",
      "*.js",
      "*.json"
    ],
    "ignore": [
      "dist/**",
      "node_modules/**",
      ".changeset/**"
    ]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100,
    "lineEnding": "lf"
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "correctness": {
        "noUnusedVariables": "error",
        "noUnusedImports": "error"
      },
      "suspicious": {
        "noExplicitAny": "warn"
      },
      "style": {
        "useConst": "error"
      }
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "semicolons": "always",
      "trailingCommas": "all"
    }
  },
  "organizeImports": {
    "enabled": true
  }
}
```

**Notes:**
- Biome 2.x uses `files.includes` not `files.include` (changed from v1)
- `$schema` URL must match installed version — use 2.4.12
- `recommended: true` enables the curated rule set; individual rules override on top
- Biome 2's type-aware rules ("Biotype") work without the TypeScript language service — no separate plugin needed

### Pattern 5: Vitest Configuration (vitest.config.ts)

Phase 1 uses Node environment only. Browser mode is configured but used in Phase 3+. The `projects` API supports dual environments in a single config file.

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.{test,spec}.ts'],
          environment: 'node',
          globals: false,
        },
      },
      // Browser mode project — configured now, populated in Phase 3
      // {
      //   test: {
      //     name: 'browser',
      //     include: ['tests/browser/**/*.{test,spec}.ts'],
      //     browser: {
      //       enabled: true,
      //       provider: 'playwright',
      //       instances: [
      //         { browser: 'chromium' },
      //         { browser: 'firefox' },
      //         { browser: 'webkit' },
      //       ],
      //     },
      //   },
      // },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/wasm.ts'],
    },
  },
})
```

**Notes:**
- `environment: 'node'` for Phase 1 — framing, seq arithmetic, and origin validation tests all run in Node without a browser
- The browser project is commented out so it can be uncommented in Phase 3 without a config rewrite
- `globals: false` is preferred — use explicit `import { describe, it, expect } from 'vitest'`
- The `projects` API is stable in Vitest 4; do NOT use the deprecated `workspace` file approach

### Pattern 6: Playwright Configuration (playwright.config.ts)

```typescript
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],

  // No webServer needed for Phase 1 — smoke test uses page.setContent()
})
```

**Notes:**
- No `webServer` config in Phase 1 — the smoke test uses `page.setContent()` to inject HTML directly; no static file server needed
- `testDir: 'tests/e2e'` isolates Playwright tests from Vitest unit tests in `tests/unit/`
- `fullyParallel: true` is correct for isolated smoke tests
- `reporter: 'github'` in CI outputs annotations in GitHub Actions format

### Pattern 7: Changesets Configuration

Initialize with `pnpm exec changeset init`. The resulting `.changeset/config.json`:

```json
{
  "$schema": "https://unpkg.com/@changesets/config/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

**Key field:** `"access": "public"` — required for scoped packages (`@scope/name`) to publish publicly. For an unscoped name like `iframebuffer`, defaults work but explicit `"public"` is safer.

### Pattern 8: sync-jsr-version.mjs Script

```javascript
// scripts/sync-jsr-version.mjs
import { readFileSync, writeFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const jsr = JSON.parse(readFileSync('jsr.json', 'utf8'))

jsr.version = pkg.version

writeFileSync('jsr.json', JSON.stringify(jsr, null, 2) + '\n')

console.log(`Synced jsr.json version to ${pkg.version}`)
```

**Usage:** The `"version"` script in `package.json` runs `changeset version && node scripts/sync-jsr-version.mjs`. This keeps `package.json` and `jsr.json` in sync on every changeset publish.

### Pattern 9: jsr.json

JSR publishes TypeScript source directly — no compile step required. The exports map points to `.ts` source files, not compiled `.js`.

```json
{
  "name": "@iframebuffer/core",
  "version": "0.0.0",
  "exports": {
    ".": "./src/index.ts",
    "./wasm": "./src/wasm.ts"
  },
  "publish": {
    "include": [
      "src/**/*.ts",
      "LICENSE",
      "README.md"
    ],
    "exclude": [
      "src/**/*.test.ts",
      "src/**/*.spec.ts"
    ]
  }
}
```

**Note on scope:** The final package name is deferred to Phase 10 (PUB-01). Use `@iframebuffer/core` as placeholder JSR name (JSR requires a scoped name). The npm name `iframebuffer` is unscoped for now.

### Pattern 10: GitHub Actions — ci.yml

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  ci:
    runs-on: ubuntu-latest
    permissions:
      contents: read

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Install Playwright browsers
        run: pnpm exec playwright install --with-deps chromium firefox webkit

      - name: Build
        run: pnpm build

      - name: Lint
        run: pnpm exec biome check .

      - name: Validate package exports
        run: |
          pnpm exec publint
          pnpm exec attw --pack .

      - name: Unit tests
        run: pnpm test

      - name: Playwright smoke tests
        run: pnpm test:e2e
```

### Pattern 11: GitHub Actions — publish.yml

This workflow is wired now but triggers only on tag push — actual publishing happens in Phase 10.

```yaml
name: Publish

on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      id-token: write       # OIDC — required for npm provenance + JSR tokenless publish
      pull-requests: write  # changesets PR creation

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: https://registry.npmjs.org
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build
        run: pnpm build

      - name: Validate package exports
        run: |
          pnpm exec publint
          pnpm exec attw --pack .

      - name: Publish to npm (OIDC provenance)
        run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      - name: Publish to JSR (OIDC, no token needed)
        run: pnpm exec jsr publish
```

**OIDC notes:**
- npm trusted publishing requires `id-token: write` permission and `--provenance` flag; still needs `NPM_TOKEN` in secrets for authentication
- JSR publishing with `id-token: write` is fully tokenless — `npx jsr publish` (or `pnpm exec jsr publish`) uses GitHub OIDC automatically when the permission is set
- `contents: write` + `pull-requests: write` are for changesets action if used — include for future-proofing

---

## Wire Protocol TypeScript Shapes

### Frame Discriminated Union (PROTO-01)

The CONTEXT.md says "seven frame types" but lists eight: OPEN, OPEN_ACK, DATA, CREDIT, CLOSE, CANCEL, RESET, CAPABILITY. The REQUIREMENTS.md (PROTO-01) also says "exactly seven" but the description lists eight distinct types. **Use all eight** — the CAPABILITY frame is clearly required by PROTO-04/PROTO-05.

**Note on frame namespace marker:** From PITFALLS.md item "Looks Done But Isn't" — `decode()` must return `null` for messages without `__ibf_v1__: 1`. This marker prevents host-app message misrouting.

```typescript
// src/framing/types.ts

export const FRAME_MARKER = '__ibf_v1__' as const
export const PROTOCOL_VERSION = 1

/** Identifies the data type in a DATA frame */
export type ChunkType =
  | 'BINARY_TRANSFER'
  | 'STRUCTURED_CLONE'
  | 'STREAM_REF'
  | 'SAB_SIGNAL'

/** Common header on every frame */
export interface BaseFrame {
  [FRAME_MARKER]: 1
  channelId: string
  streamId: number
  seqNum: number
}

export interface OpenFrame extends BaseFrame {
  type: 'OPEN'
  initCredit: number
}

export interface OpenAckFrame extends BaseFrame {
  type: 'OPEN_ACK'
  initCredit: number
}

export interface DataFrame extends BaseFrame {
  type: 'DATA'
  chunkType: ChunkType
  payload: unknown
  isFinal: boolean
}

export interface CreditFrame extends BaseFrame {
  type: 'CREDIT'
  credit: number
}

export interface CloseFrame extends BaseFrame {
  type: 'CLOSE'
  finalSeq: number
}

export interface CancelFrame extends BaseFrame {
  type: 'CANCEL'
  reason: string
}

export interface ResetFrame extends BaseFrame {
  type: 'RESET'
  reason: string
}

export interface CapabilityFrame extends BaseFrame {
  type: 'CAPABILITY'
  protocolVersion: number
  sab: boolean
  transferableStreams: boolean
}

export type Frame =
  | OpenFrame
  | OpenAckFrame
  | DataFrame
  | CreditFrame
  | CloseFrame
  | CancelFrame
  | ResetFrame
  | CapabilityFrame
```

### encode / decode Functions (PROTO-01, PROTO-02)

```typescript
// src/framing/encode-decode.ts

import { FRAME_MARKER, type Frame } from './types.js'

/**
 * Encode a Frame into a structured-clone-friendly object.
 * The returned value is safe to pass to postMessage.
 * No ArrayBuffer packing — JS-idiomatic format; byte-level wire format deferred.
 */
export function encode(frame: Frame): Record<string, unknown> {
  return frame as unknown as Record<string, unknown>
}

/**
 * Decode an unknown message into a Frame, or return null.
 * Returns null for: non-objects, missing marker, missing type discriminant,
 * unknown type values, or any message without the __ibf_v1__ marker.
 * Never throws.
 */
export function decode(msg: unknown): Frame | null {
  if (msg === null || typeof msg !== 'object') return null
  const m = msg as Record<string, unknown>
  if (m[FRAME_MARKER] !== 1) return null
  if (typeof m['type'] !== 'string') return null
  // Validate required BaseFrame fields
  if (typeof m['channelId'] !== 'string') return null
  if (typeof m['streamId'] !== 'number') return null
  if (typeof m['seqNum'] !== 'number') return null
  // Type-specific validation
  switch (m['type']) {
    case 'OPEN':
    case 'OPEN_ACK':
      if (typeof m['initCredit'] !== 'number') return null
      return msg as Frame
    case 'DATA':
      if (typeof m['payload'] === 'undefined') return null
      if (typeof m['isFinal'] !== 'boolean') return null
      return msg as Frame
    case 'CREDIT':
      if (typeof m['credit'] !== 'number') return null
      return msg as Frame
    case 'CLOSE':
      if (typeof m['finalSeq'] !== 'number') return null
      return msg as Frame
    case 'CANCEL':
    case 'RESET':
      if (typeof m['reason'] !== 'string') return null
      return msg as Frame
    case 'CAPABILITY':
      if (typeof m['protocolVersion'] !== 'number') return null
      if (typeof m['sab'] !== 'boolean') return null
      if (typeof m['transferableStreams'] !== 'boolean') return null
      return msg as Frame
    default:
      return null
  }
}
```

**encode behavior:** In Phase 1, `encode` is the identity function — frames are already structured-clone-friendly plain objects (CONTEXT.md: "Frame encoding uses structured-clone-friendly objects (not ArrayBuffer packing)"). The function exists as a seam for future binary encoding if benchmarks justify it.

**decode behavior:** Validates the namespace marker, required base fields, and type-specific required fields. Returns `null` without throwing for any invalid input.

### PostMessageEndpoint Interface (ENDP-01)

```typescript
// src/transport/endpoint.ts

/**
 * Minimal contract for any postMessage-capable endpoint.
 * Four concrete endpoint shapes satisfy this: Worker, MessagePort, Window, ServiceWorker/Client.
 * The library does not validate event.origin — that is the Window adapter's concern.
 */
export interface PostMessageEndpoint {
  postMessage(message: unknown, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent) => void) | null
}
```

**Design rationale (from PITFALLS.md P16):** Use `onmessage =` assignment internally (not `addEventListener`) because `onmessage` assignment implicitly calls `.start()` on `MessagePort`. The library contract is: the endpoint passed to the library is owned exclusively by the library — the caller must not also add `addEventListener('message', ...)` to the same object. Document this.

### Window Adapter (ENDP-03)

**Design decision:** The `createWindowEndpoint` adapter wraps a `Window` target. For **outbound** (sending TO the window), use `win.postMessage(msg, targetOrigin)` where `targetOrigin = expectedOrigin`. For **inbound** (receiving from the window), filter by `event.origin === expectedOrigin` before passing to `onmessage`. Wildcard `expectedOrigin = '*'` is rejected at construction time — this is the security guarantee (PITFALLS.md P5).

No `MessageChannel` extraction is needed here — that is a caller-side concern when the caller wants to create a dedicated channel. The adapter wraps direct `window.postMessage` semantics.

```typescript
// src/transport/adapters/window.ts

import type { PostMessageEndpoint } from '../endpoint.js'

/**
 * Wrap a cross-origin Window as a PostMessageEndpoint.
 * Rejects wildcard expectedOrigin at construction time (supply-chain attack vector).
 * Silently drops messages from non-matching origins.
 */
export function createWindowEndpoint(
  win: Window,
  expectedOrigin: string,
): PostMessageEndpoint {
  if (expectedOrigin === '*') {
    throw new Error(
      '[iframebuffer] createWindowEndpoint: wildcard expectedOrigin "*" is not allowed. ' +
        'Provide the exact expected origin (e.g., "https://example.com").',
    )
  }

  const endpoint: PostMessageEndpoint = {
    postMessage(message: unknown, transfer?: Transferable[]): void {
      win.postMessage(message, expectedOrigin, transfer ?? [])
    },
    onmessage: null,
  }

  // Wire the window message listener
  const listener = (event: MessageEvent): void => {
    if (event.origin !== expectedOrigin) {
      // Silent drop — wrong origin
      // TODO Phase 4: surface via observability hook (OBS-02 ORIGIN_REJECTED)
      return
    }
    endpoint.onmessage?.(event)
  }
  win.addEventListener('message', listener)

  return endpoint
}
```

**Note:** Phase 1 does NOT implement teardown (`removeEventListener`). Teardown is LIFE-05 (Phase 4). The stub is sufficient for the interface contract and origin validation tests.

### Worker / MessagePort / ServiceWorker Adapters (ENDP-02, ENDP-04)

These are thin wrappers that satisfy the `PostMessageEndpoint` contract. Worker and MessagePort naturally fit the interface. ServiceWorker requires special handling for SAB capability (ENDP-04).

```typescript
// src/transport/adapters/worker.ts
import type { PostMessageEndpoint } from '../endpoint.js'

export function createWorkerEndpoint(worker: Worker): PostMessageEndpoint {
  return worker as unknown as PostMessageEndpoint
}

// src/transport/adapters/message-port.ts
import type { PostMessageEndpoint } from '../endpoint.js'

export function createMessagePortEndpoint(port: MessagePort): PostMessageEndpoint {
  // port.start() is called implicitly when onmessage is assigned
  return port as unknown as PostMessageEndpoint
}

// src/transport/adapters/service-worker.ts
import type { PostMessageEndpoint } from '../endpoint.js'

/** Metadata attached to ServiceWorker endpoints for capability negotiation */
export interface ServiceWorkerEndpointMeta {
  endpoint: PostMessageEndpoint
  /** Always false — ServiceWorker is in a different agent cluster; SAB cannot be shared */
  sabCapable: false
}

export function createServiceWorkerEndpoint(
  sw: ServiceWorker,
): ServiceWorkerEndpointMeta {
  return {
    endpoint: sw as unknown as PostMessageEndpoint,
    sabCapable: false,
  }
}
```

### Sequence Number Arithmetic (PROTO-02, SESS-06)

**Design:** 32-bit unsigned wraparound-safe comparison, TCP-style. A 32-bit counter wraps at 4,294,967,296 frames. At 64KB chunks this is ~281 TB — not reachable in practice. However 16-bit would wrap at 4GB at high SAB throughput, so 32-bit is the correct choice.

**Algorithm:** `seqA < seqB` in modular sense iff `((seqA - seqB) >>> 0) > HALF_WINDOW`. Equivalently, `seqA > seqB` iff `((seqB - seqA) >>> 0) > HALF_WINDOW`.

```typescript
// src/transport/seq.ts

const SEQ_BITS = 32
const SEQ_MASK = 0xffff_ffff
const HALF_WINDOW = 0x8000_0000 // 2^31

/** Mask a sequence number to 32 bits */
export function seqMask(n: number): number {
  return n >>> 0
}

/**
 * Wraparound-safe: returns true if seqA < seqB in the modular sequence space.
 * TCP-style: ((a - b) & MASK) > HALF_WINDOW
 */
export function seqLT(a: number, b: number): boolean {
  return ((seqMask(a) - seqMask(b)) >>> 0) > HALF_WINDOW
}

/**
 * Wraparound-safe: returns true if seqA > seqB in the modular sequence space.
 */
export function seqGT(a: number, b: number): boolean {
  return seqLT(b, a)
}

/**
 * Wraparound-safe: returns true if seqA <= seqB in the modular sequence space.
 */
export function seqLTE(a: number, b: number): boolean {
  return !seqGT(a, b)
}

/**
 * Increment a sequence number with 32-bit wraparound.
 */
export function seqNext(n: number): number {
  return (n + 1) >>> 0
}

export { SEQ_BITS, SEQ_MASK, HALF_WINDOW }
```

**Fuzz test requirement (SESS-06, PITFALLS P9):** The seq test must include a fuzz pass from `0xFFFFFFF0` through `0x0000000F` asserting all 32 values are ordered correctly through the wrap point. This is cheap and prevents PITFALLS item 8 silently.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Package exports validation | Custom script to check dist/ | `publint` | Catches 15+ edge cases: missing types conditions, wrong extensions, subpath mismatches |
| TypeScript types resolution validation | Manual consumer testing | `@arethetypeswrong/cli --pack .` | Tests CJS, ESM, bundler resolution modes simultaneously |
| Version/changelog management | Custom git tags + CHANGELOG | `@changesets/cli` | Human-reviewed changelogs; handles monorepo; PRs are auditable |
| JSR version sync | Nothing (let it drift) | `sync-jsr-version.mjs` script | `changesets` does not natively update `jsr.json`; 10-line script prevents permanent drift |
| 32-bit seq wraparound | Raw `>` comparison | `seqLT/seqGT` with `>>> 0` arithmetic | Raw `>` silently breaks at seq 0xFFFFFFFF; modular arithmetic is 2 lines and correct forever |
| Origin validation on Window | Inline `if (e.origin !== x)` per handler | `createWindowEndpoint(win, expectedOrigin)` | Centralizes the check; enforces non-wildcard; tests it in isolation |

---

## Common Pitfalls

### Pitfall 1: `./wasm` export slot breaks publint if dist files don't exist

**What goes wrong:** `publint` validates that every path in the `exports` map points to a real file in `dist/`. If `dist/wasm.js` doesn't exist (because there's no `src/wasm.ts` yet), `publint` fails in CI.

**Why it happens:** The `./wasm` export is reserved for Phase 5 but must exist in Phase 1 to avoid a future breaking package change.

**How to avoid:** Create `src/wasm.ts` as a stub: `// WASM exports — reserved. See Phase 5.` and `export {}`. tsdown will produce `dist/wasm.js` and `dist/wasm.d.ts` from it. `publint` passes.

**Warning signs:** CI fails at `publint` step with "Could not find 'dist/wasm.js'".

### Pitfall 2: Vitest `projects` API requires Vite 6

**What goes wrong:** Vitest 4.x requires `vite >= 6.0.0` as a peer dependency. The `projects` API specifically uses Vite 6's workspace features internally.

**Why it happens:** Vite 5 ships as a peer dep of older Vitest; the lockfile may resolve Vite 5 if not explicitly added.

**How to avoid:** Add `"vite": "^6.0.0"` to devDependencies explicitly, or verify pnpm resolves a Vite 6.x peer during `pnpm install`. Run `pnpm why vite` after install to confirm.

**Warning signs:** `Error: vitest requires vite@^6.0.0`.

### Pitfall 3: tsdown `platform: 'browser'` with `@types/node` in tsconfig lib

**What goes wrong:** If `tsconfig.json` includes `"lib": ["DOM"]` and tsdown's `platform: 'browser'`, the generated bundle is correct. But if scripts in `scripts/` also need Node types and use `tsconfig.json` directly, they break.

**Why it happens:** `scripts/sync-jsr-version.mjs` uses `node:fs` which needs `@types/node`. The main `tsconfig.json` excludes `scripts/`.

**How to avoid:** `"exclude": ["node_modules", "dist", "tests", "scripts"]` in main tsconfig. Scripts run via `tsx` which does its own type resolution — they don't need to be in the tsconfig include.

### Pitfall 4: `isolatedDeclarations: true` requires explicit return types on all exported functions

**What goes wrong:** `isolatedDeclarations: true` (for the oxc-transform fast DTS path) requires that all exported function signatures have explicit return type annotations. TypeScript will error on `export function encode(frame: Frame)` without a `: Record<string, unknown>` return type.

**Why it happens:** `isolatedDeclarations` prevents TypeScript from inferring return types across module boundaries.

**How to avoid:** Add explicit return types to every exported function. This is good practice anyway and is enforced by the tsconfig.

**Warning signs:** TypeScript error: "Return type of exported function has or is using private name 'X'." or "Declarations must be explicitly typed."

### Pitfall 5: Playwright browsers not found in CI

**What goes wrong:** `pnpm exec playwright install` without `--with-deps` may fail on Ubuntu runners because system library dependencies (libglib, libnss, etc.) are missing.

**Why it happens:** GitHub Actions `ubuntu-latest` does not have all Playwright browser system dependencies pre-installed.

**How to avoid:** Always use `pnpm exec playwright install --with-deps chromium firefox webkit` in CI. The `--with-deps` flag installs OS-level system deps via apt.

**Warning signs:** `Error: browserType.launch: Executable doesn't exist at /path/to/playwright/webkit/webkit`.

### Pitfall 6: JSR requires scoped package name

**What goes wrong:** `npx jsr publish` fails if `jsr.json` `"name"` is not scoped (`@scope/package`).

**Why it happens:** JSR enforces scoped names for all packages.

**How to avoid:** Use `@iframebuffer/core` as placeholder in `jsr.json` even though the final name is TBD. The npm package can remain unscoped (`iframebuffer`) since npm allows unscoped packages.

### Pitfall 7: `onmessage` setter on Window adapter silently overwrites caller's handler

**What goes wrong:** If the returned `PostMessageEndpoint` uses `win.onmessage =` for inbound, it overwrites any existing `onmessage` on the window. This is catastrophically bad for `Window` targets.

**Why it happens:** The Window adapter wraps a global `Window` object that the caller may already be using.

**How to avoid:** The Window adapter uses `win.addEventListener('message', listener)` internally for inbound (NOT `win.onmessage =`), but exposes an `onmessage` setter on the returned endpoint object that controls the internal routing. The adapter stores the inbound `addEventListener` reference for future cleanup (Phase 4).

---

## Code Examples

### Frame Round-Trip Test

```typescript
// tests/unit/framing/encode-decode.test.ts
import { describe, it, expect } from 'vitest'
import { encode, decode } from '../../../src/framing/encode-decode.js'
import { FRAME_MARKER } from '../../../src/framing/types.js'
import type { DataFrame, CapabilityFrame } from '../../../src/framing/types.js'

describe('encode/decode round-trip', () => {
  it('DATA frame round-trips correctly', () => {
    const frame: DataFrame = {
      [FRAME_MARKER]: 1,
      type: 'DATA',
      channelId: 'ch-1',
      streamId: 42,
      seqNum: 7,
      chunkType: 'BINARY_TRANSFER',
      payload: new Uint8Array([1, 2, 3]),
      isFinal: false,
    }
    expect(decode(encode(frame))).toEqual(frame)
  })

  it('returns null for messages without marker', () => {
    expect(decode({ type: 'DATA', channelId: 'x', streamId: 1, seqNum: 0 })).toBeNull()
  })

  it('returns null for unknown type', () => {
    expect(decode({ [FRAME_MARKER]: 1, type: 'UNKNOWN', channelId: 'x', streamId: 1, seqNum: 0 })).toBeNull()
  })

  it('returns null for non-object input', () => {
    expect(decode(null)).toBeNull()
    expect(decode('hello')).toBeNull()
    expect(decode(42)).toBeNull()
  })

  it('round-trips all 8 frame types', () => {
    const frames = [/* ... one of each type ... */]
    for (const f of frames) {
      expect(decode(encode(f))).toEqual(f)
    }
  })
})
```

### Seq Fuzz Test

```typescript
// tests/unit/transport/seq.test.ts
import { describe, it, expect } from 'vitest'
import { seqLT, seqGT, seqNext, SEQ_MASK } from '../../../src/transport/seq.js'

describe('seqLT wraparound fuzz', () => {
  it('correctly orders 32 values through the wrap point', () => {
    const start = 0xfffffff0
    const values: number[] = []
    let s = start
    for (let i = 0; i < 32; i++) {
      values.push(s)
      s = seqNext(s)
    }
    for (let i = 0; i < values.length - 1; i++) {
      expect(seqLT(values[i], values[i + 1])).toBe(true)
      expect(seqGT(values[i + 1], values[i])).toBe(true)
    }
  })
})
```

### Window Adapter Origin Rejection Test

```typescript
// tests/unit/transport/window-adapter.test.ts
import { describe, it, expect } from 'vitest'
import { createWindowEndpoint } from '../../../src/transport/adapters/window.js'

describe('createWindowEndpoint', () => {
  it('throws for wildcard expectedOrigin', () => {
    const fakeWindow = {} as Window
    expect(() => createWindowEndpoint(fakeWindow, '*')).toThrow(
      'wildcard expectedOrigin "*" is not allowed',
    )
  })
})
```

Note: The actual origin-filtering behavior (messages from wrong origins are silently dropped) requires a real browser to test properly (real `MessageEvent` with `origin` property). This test verifies the construction-time rejection only — the runtime filtering test belongs in Phase 9's E2E suite.

### Playwright Smoke Test

```typescript
// tests/e2e/smoke.spec.ts
import { test, expect } from '@playwright/test'

test('Playwright harness runs across all three browsers', async ({ page }) => {
  await page.setContent('<html><head><title>iframebuffer smoke</title></head><body></body></html>')
  await expect(page).toHaveTitle('iframebuffer smoke')
})
```

This test requires no webServer, no build output, no network. It purely verifies that Playwright launches Chromium, Firefox, and WebKit correctly in CI and the harness is wired up. The `playwright.config.ts` `projects` array drives this test against all three browsers automatically.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| tsup (esbuild-backed) | tsdown (Rolldown-backed) | Early 2026 — tsup author declared functional abandonment | tsdown is the drop-in successor; faster builds, better DTS |
| ESLint + Prettier | Biome 2 with Biotype | Biome v2.0 December 2025 | Single tool; type-aware rules without TS language service |
| Vitest workspace file | Vitest 4 `projects` API in vitest.config | Vitest 4.0, December 2025 | Workspace file deprecated; projects array in main config |
| Jest + jsdom | Vitest + real browser (Playwright provider) | Vitest browser mode stable v4 | Real structured-clone and Transferable semantics |
| Long-lived npm publish tokens | OIDC trusted publishing `--provenance` | npm CLI v9+, standard 2024+ | No stored secrets; provenance attestation auto-generated |

---

## Open Questions

1. **`src/wasm.ts` stub content**
   - What we know: must produce `dist/wasm.js` and `dist/wasm.d.ts` to pass `publint`
   - What's unclear: should it export a typed placeholder (e.g., `export const _wasmReserved: undefined`) or just `export {}`?
   - Recommendation: `export {}` is cleaner; no API surface to accidentally depend on

2. **`@vitest/browser` + `playwright` provider setup for Phase 1**
   - What we know: `@vitest/browser` needs `playwright` as peer; in Vitest 4 the browser project is configured via `instances`
   - What's unclear: does installing `@vitest/browser` + `@playwright/test` in Phase 1 but commenting out the browser project cause any install warnings?
   - Recommendation: Install both now, comment out browser project block; `pnpm install` with both present will not complain

3. **Playwright system browsers on this Arch Linux machine**
   - What we know: From AGENTS.md — Playwright is installed system-wide via pacman; browsers at `~/.cache/ms-playwright/`; `--executable-path /usr/bin/chromium` is configured in `.mcp.json`
   - What's unclear: Does the project-local `@playwright/test` use the system-wide browser cache, or does `pnpm exec playwright install` create a separate copy?
   - Recommendation: Run `pnpm exec playwright install` in the project to ensure the pinned 1.59.1 version's browsers are available; the system `chromium` may not match the version `@playwright/test@1.59.1` expects

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All JS tooling | Yes | v22.22.1 | — |
| pnpm | Package manager | Yes | 10.30.3 (system) | — |
| Chromium | Playwright E2E | Yes (system) | via pacman | Playwright install will add pinned version |
| Firefox | Playwright E2E | Unknown | — | `playwright install firefox` in CI |
| WebKit | Playwright E2E | Unknown | — | `playwright install webkit` in CI |
| git | Version control | Yes | system | — |
| GitHub Actions | CI/CD | Yes (repo exists) | — | — |

**Missing dependencies with fallback:**
- Firefox + WebKit browsers: not confirmed installed for Playwright locally. `pnpm exec playwright install firefox webkit` handles this. CI workflow uses `--with-deps` flag.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.4 (unit) + Playwright 1.59.1 (E2E) |
| Config file | `vitest.config.ts` (unit) + `playwright.config.ts` (E2E) |
| Quick run command | `pnpm test` (Vitest unit, Node env) |
| Full suite command | `pnpm test && pnpm test:e2e` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| COMP-01 | No unsafe-eval in baseline bundle | build artifact check | `pnpm build && pnpm exec publint` | Wave 0 setup |
| COMP-02 | Zero runtime deps | package.json check | `pnpm exec publint` | Wave 0 setup |
| COMP-04 | ESM-first + .d.ts shipped | publint + attw | `pnpm exec attw --pack .` | Wave 0 setup |
| ENDP-01 | PostMessageEndpoint interface exists | type-check | `pnpm exec tsc --noEmit` | Wave 0 |
| ENDP-03 | Window adapter rejects wildcard origin | unit test | `pnpm test -- tests/unit/transport/window-adapter` | Wave 0 |
| PROTO-01 | All 8 frame types in union | type-check + encode/decode | `pnpm test -- tests/unit/framing` | Wave 0 |
| PROTO-02 | seqLT/seqGT wraparound-safe | fuzz unit test | `pnpm test -- tests/unit/transport/seq` | Wave 0 |
| PROTO-01 | encode(frame) / decode(msg) round-trip | unit test (all 8 types) | `pnpm test -- tests/unit/framing` | Wave 0 |
| PROTO-01 | decode returns null for unknown messages | unit test | `pnpm test -- tests/unit/framing` | Wave 0 |
| COMP-03 | Playwright harness runs on 3 browsers | Playwright smoke | `pnpm test:e2e` | Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm test` (Vitest unit, < 5 seconds)
- **Per wave merge:** `pnpm build && pnpm test && pnpm test:e2e` (full CI locally)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/unit/framing/encode-decode.test.ts` — covers PROTO-01 round-trip for all 8 frame types
- [ ] `tests/unit/transport/seq.test.ts` — covers PROTO-02 wraparound fuzz
- [ ] `tests/unit/transport/window-adapter.test.ts` — covers ENDP-03 origin rejection
- [ ] `tests/e2e/smoke.spec.ts` — covers COMP-03 3-browser Playwright harness
- [ ] `vitest.config.ts` with node project configured
- [ ] `playwright.config.ts` with 3-browser projects

---

## Sources

### Primary (HIGH confidence)

- npm registry live queries (2026-04-21) — all package versions verified: tsdown@0.21.9, typescript@6.0.3, vitest@4.1.4, @playwright/test@1.59.1, @biomejs/biome@2.4.12, @changesets/cli@2.31.0, publint@0.3.18, @arethetypeswrong/cli@0.18.2, tinybench@6.0.0, tsx@4.21.0
- Playwright official docs (playwright.dev/docs/test-configuration) — webServer config, projects config, 3-browser matrix
- Vitest official docs (vitest.dev/guide/browser) — projects API, browser mode, dual-environment config
- Biome official docs (biomejs.dev/reference/configuration) — biome.json v2.x schema, Biotype type-aware rules
- tsdown official docs (tsdown.dev) — defineConfig, UserConfig fields, dts options, isolatedDeclarations fast path
- JSR docs (github.com/jsr-io/jsr) — jsr.json schema, OIDC tokenless publish, TypeScript source publishing
- npm docs (docs.npmjs.com) — OIDC provenance `--provenance` flag, `id-token: write` requirement
- Changesets docs (github.com/changesets/changesets) — config.json schema, version lifecycle hook, changeset action

### Secondary (MEDIUM confidence)

- mswjs/interceptors tsdown.config.mts (GitHub) — real-world two-target tsdown configuration reference
- WebSearch: tsdown 0.21 platform browser dts isolatedDeclarations — confirmed config fields; cross-referenced with official docs

### Tertiary (LOW confidence, needs validation)

- Vitest `@vitest/browser` + `playwright` peer dependency warnings — confirmed conceptually but exact warning text not verified; recommend running `pnpm install` and checking output

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified against live npm registry
- Package.json / tsdown / tsconfig shapes: HIGH — verified against official docs
- Wire protocol TypeScript shapes: HIGH — derived directly from REQUIREMENTS.md spec
- Seq arithmetic: HIGH — TCP-style modular arithmetic is well-established
- Biome config: MEDIUM — verified schema structure; specific rule names in v2.4.12 not fully enumerated
- CI/CD workflow: MEDIUM — OIDC patterns verified; exact GitHub Actions syntax from official docs
- Playwright smoke test (page.setContent approach): HIGH — page.setContent is a stable Playwright API

**Research date:** 2026-04-21
**Valid until:** 2026-05-21 (tsdown is pre-1.0; check for breaking changes before 30 days)
