---
phase: 01-scaffold-wire-protocol-foundation
plan: "03"
subsystem: transport
tags: [typescript, postmessage, origin-validation, adapters, tdd, security]

# Dependency graph
requires:
  - 01-01  # toolchain scaffold
provides:
  - PostMessageEndpoint interface (src/transport/endpoint.ts)
  - createWindowEndpoint with origin validation (src/transport/adapters/window.ts)
  - createWorkerEndpoint (src/transport/adapters/worker.ts)
  - createMessagePortEndpoint (src/transport/adapters/message-port.ts)
  - createServiceWorkerEndpoint with sabCapable:false (src/transport/adapters/service-worker.ts)
  - src/index.ts wired with all Phase 1 public exports
affects:
  - 01-04  # consolidation plan
  - all subsequent phases that import from src/index.ts

# Tech tracking
tech-stack:
  added: []
  patterns:
    - TDD (RED→GREEN) for security-critical origin validation
    - Thin cast adapters satisfying interface without reimplementing native methods
    - sabCapable: false as discriminant literal type for agent-cluster-aware capability negotiation
    - win.addEventListener for inbound (not onmessage= assignment) to avoid clobbering caller's handler
    - Node MessageChannel (node:worker_threads) for MessagePort round-trip test in Node env

key-files:
  created:
    - src/transport/endpoint.ts
    - src/transport/adapters/window.ts
    - src/transport/adapters/worker.ts
    - src/transport/adapters/message-port.ts
    - src/transport/adapters/service-worker.ts
    - tests/unit/transport/window-adapter.test.ts
    - tests/unit/transport/adapters.test.ts
  modified:
    - src/index.ts

key-decisions:
  - "Window adapter uses win.addEventListener for inbound (not win.onmessage=) to avoid clobbering caller's handler (Pitfall 7)"
  - "createWindowEndpoint throws synchronously on both wildcard and empty string expectedOrigin"
  - "ServiceWorkerEndpointMeta.sabCapable typed as literal false (not boolean) for exhaustive type narrowing in capability negotiation"
  - "Worker and MessagePort adapters are thin casts — native shapes already satisfy PostMessageEndpoint interface"
  - "Framing exports included in src/index.ts because Plan 01-02 completed in parallel and encode-decode.ts existed"
  - "Biome organizeImports alphabetizes export statements; comments reordered relative to exports by biome --write"

# Metrics
duration: 7min
completed: 2026-04-21T10:10:43Z
---

# Phase 01 Plan 03: PostMessageEndpoint Interface + Four Adapters Summary

**PostMessageEndpoint interface defined with origin-validating Window adapter, three thin-cast adapters, and sabCapable:false ServiceWorker metadata; all Phase 1 public exports wired in src/index.ts**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-04-21T10:03:00Z
- **Completed:** 2026-04-21T10:10:43Z
- **Tasks:** 2
- **Files created:** 7
- **Files modified:** 1

## Accomplishments

- `PostMessageEndpoint` interface defined — minimal two-member contract (`postMessage`, `onmessage`)
- `createWindowEndpoint(win, expectedOrigin)` enforces origin security:
  - Throws synchronously on wildcard `"*"` (supply-chain attack vector)
  - Throws synchronously on empty string `""` (invalid origin)
  - Uses `win.addEventListener('message', ...)` NOT `win.onmessage=` for inbound (avoids clobbering caller's handler)
  - Silently drops messages where `event.origin !== expectedOrigin`
  - TODO Phase 4 comment placed for OBS-02 ORIGIN_REJECTED hook
- `createWorkerEndpoint` and `createMessagePortEndpoint` are thin casts — Worker and MessagePort native shapes satisfy the interface
- `createServiceWorkerEndpoint` returns `ServiceWorkerEndpointMeta` with `sabCapable: false` typed as literal `false` (not `boolean`) — enables exhaustive narrowing in capability negotiation without a type guard
- `src/index.ts` wired with all transport and framing exports from Plans 02 and 03
- TDD: 16 tests (6 window-adapter, 10 adapters) written before implementation; all green after implement

## PostMessageEndpoint Interface

```typescript
export interface PostMessageEndpoint {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
}
```

Designed as the smallest possible caller contract. Every native browser postMessage shape (Worker, MessagePort, Window, ServiceWorker) satisfies this via casting.

## Window Adapter Security Invariants

1. `expectedOrigin === "*"` → throws: `'[iframebuffer] createWindowEndpoint: wildcard expectedOrigin "*" is not allowed...'`
2. `expectedOrigin === ""` → throws: `'[iframebuffer] createWindowEndpoint: empty string expectedOrigin is not allowed...'`
3. Outbound: `win.postMessage(message, expectedOrigin, transfer ?? [])`
4. Inbound: `win.addEventListener("message", listener)` — NOT `win.onmessage =`
5. Listener: `if (event.origin !== expectedOrigin) return` (silent drop)

## ServiceWorkerEndpointMeta Shape

```typescript
export interface ServiceWorkerEndpointMeta {
  endpoint: PostMessageEndpoint;
  sabCapable: false;  // typed as literal false, not boolean
}
```

`sabCapable: false` is typed as the literal `false` (not `boolean`) because:
- ServiceWorker runs in a different agent cluster — SAB transfer would always throw `DataCloneError`
- Literal `false` allows the capability negotiation layer to narrow the type exhaustively without a runtime type guard
- The capability never changes — there is no code path where this becomes `true` for a SW endpoint

## Worker + MessagePort Adapter Design Rationale

Both adapters are thin identity casts:

```typescript
export function createWorkerEndpoint(worker: Worker): PostMessageEndpoint {
  return worker as unknown as PostMessageEndpoint;
}
```

This is correct because:
- `Worker.postMessage(msg, transfer?)` already matches the interface signature
- `Worker.onmessage` is a writable `((e: MessageEvent) => void) | null` property
- The same applies to `MessagePort` (with the bonus that `onmessage=` assignment calls `port.start()` implicitly)
- No wrapper object is needed — these native types are the reference implementation of the interface

## Task Commits

1. **Task 1: PostMessageEndpoint interface + four adapters + TDD tests** — `5576e0c`
2. **Task 2: Wire src/index.ts with all Phase 1 exports** — `8a4b68e`

## Test Results

- **Total tests:** 56 passing (16 new in this plan + 40 from prior plans)
- **New tests (window-adapter.test.ts):** 6 tests
  - Wildcard rejection (throws with "wildcard" message)
  - Empty string rejection (throws)
  - Valid origin: no throw
  - postMessage delegation: targetOrigin === expectedOrigin
  - Correct origin: forwarded to onmessage
  - Wrong origin: silently dropped
- **New tests (adapters.test.ts):** 10 tests
  - Worker: interface shape, postMessage delegation, onmessage setter
  - MessagePort: interface shape, real MessageChannel round-trip
  - ServiceWorker: sabCapable: false, literal type check, endpoint shape, postMessage delegation

## Files Created/Modified

| File | Status | Description |
|------|--------|-------------|
| `src/transport/endpoint.ts` | created | PostMessageEndpoint interface |
| `src/transport/adapters/window.ts` | created | Origin-validating Window wrapper |
| `src/transport/adapters/worker.ts` | created | Worker thin-cast adapter |
| `src/transport/adapters/message-port.ts` | created | MessagePort thin-cast adapter |
| `src/transport/adapters/service-worker.ts` | created | ServiceWorker + sabCapable:false metadata |
| `tests/unit/transport/window-adapter.test.ts` | created | TDD tests for origin validation |
| `tests/unit/transport/adapters.test.ts` | created | TDD tests for Worker/MessagePort/SW adapters |
| `src/index.ts` | modified | Wired all Phase 1 public exports |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Biome formatting: function signatures collapsed to one line**
- **Found during:** Task 2 verification (pnpm lint)
- **Issue:** Biome formatter collapsed multi-line function signatures (`createWindowEndpoint(win, expectedOrigin)` and `createServiceWorkerEndpoint(sw)`) to single lines per lineWidth 100 setting
- **Fix:** Applied `pnpm exec biome format --write` to affected source files
- **Files modified:** `src/transport/adapters/window.ts`, `src/transport/adapters/service-worker.ts`
- **Commit:** 8a4b68e

**2. [Rule 1 - Bug] Fixed Biome noUnusedVariables: endpoint variable in test**
- **Found during:** Task 2 verification (pnpm lint)
- **Issue:** `const endpoint = createWindowEndpoint(...)` in null-onmessage test was unused; Biome `noUnusedVariables` rule reported error
- **Fix:** Renamed to `_endpoint` per Biome convention for intentionally-unused variables
- **Files modified:** `tests/unit/transport/window-adapter.test.ts`
- **Commit:** 8a4b68e

**3. [Rule 1 - Bug] Fixed Biome organizeImports: exports reordered in src/index.ts**
- **Found during:** Task 2 verification (pnpm lint)
- **Issue:** Biome `organizeImports` (via `assist.actions.source`) alphabetized export statements, reordering them from the planned group-by-plan structure
- **Fix:** Applied `pnpm exec biome check --write` to accept the sorted order
- **Files modified:** `src/index.ts`
- **Commit:** 8a4b68e

**4. [Parallel execution] Framing exports included in src/index.ts immediately**
- **Found during:** Task 2 (checking framing file existence)
- **Issue:** Plan says "leave framing re-exports as TODO if Plan 02 not yet complete"
- **Outcome:** Plan 01-02 completed first; `src/framing/encode-decode.ts` existed when Task 2 ran; all framing exports were wired immediately rather than left as TODO
- **Impact:** None — no deviation from plan intent, just the success case

## Known Stubs

None. All exports are wired to real implementations. The Phase 4 teardown (removeEventListener) is not a stub but a documented future enhancement per plan design.

## Self-Check: PASSED

| Check | Status |
|-------|--------|
| src/transport/endpoint.ts | FOUND |
| src/transport/adapters/window.ts | FOUND |
| src/transport/adapters/worker.ts | FOUND |
| src/transport/adapters/message-port.ts | FOUND |
| src/transport/adapters/service-worker.ts | FOUND |
| tests/unit/transport/window-adapter.test.ts | FOUND |
| tests/unit/transport/adapters.test.ts | FOUND |
| src/index.ts (wired exports) | FOUND |
| commit 5576e0c | FOUND |
| commit 8a4b68e | FOUND |
| pnpm test: 56/56 | PASSED |
| pnpm exec tsc --noEmit | PASSED |
| pnpm build | PASSED |
| pnpm lint | PASSED |

---
*Phase: 01-scaffold-wire-protocol-foundation*
*Completed: 2026-04-21*
