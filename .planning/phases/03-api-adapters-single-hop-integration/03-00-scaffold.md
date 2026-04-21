---
phase: 03-api-adapters-single-hop-integration
plan: 00
type: execute
wave: 0
depends_on: []
files_modified:
  - src/channel/channel.ts
  - src/adapters/lowlevel.ts
  - src/adapters/emitter.ts
  - src/adapters/streams.ts
  - src/types.ts
  - src/index.ts
  - tests/integration/binary-transfer.test.ts
  - tests/integration/data-clone-error.test.ts
  - tests/integration/emitter-drain.test.ts
  - tests/integration/streams-backpressure.test.ts
  - tests/integration/heap-flat.test.ts
  - tests/helpers/mock-endpoint.ts
  - vitest.config.ts
  - src/session/index.ts
autonomous: true
requirements:
  - TEST-02
user_setup: []
must_haves:
  truths:
    - "Integration test directory created with MockEndpoint helper available"
    - "Vitest config updated to discover integration tests"
    - "Session.close() accepts optional finalSeq parameter"
    - "StreamError class defined with ErrorCode discriminant"
    - "Empty adapter module stubs created in src/channel/ and src/adapters/"
  artifacts:
    - path: tests/integration/
      provides: Integration test directory with MockEndpoint
    - path: tests/helpers/mock-endpoint.ts
      provides: createMessageChannelPair() test helper using Node MessageChannel
    - path: src/channel/channel.ts
      provides: Channel class scaffold (interface only)
    - path: src/adapters/lowlevel.ts
      provides: createLowLevelStream adapter scaffold
    - path: src/adapters/emitter.ts
      provides: createEmitterStream adapter scaffold
    - path: src/adapters/streams.ts
      provides: createStream adapter scaffold
    - path: src/types.ts
      provides: StreamError class and ErrorCode type
    - path: src/session/index.ts
      provides: Session.close(finalSeq?: number) signature
  key_links:
    - from: vitest.config.ts
      to: tests/integration/
      via: include glob pattern
      pattern: tests/integration/\*\*
    - from: src/session/index.ts
      to: Channel constructor
      via: Session finalSeq parameter
      pattern: close\(finalSeq\?
---

<objective>
Set up Phase 3's directory structure, test infrastructure, and infrastructure patches (Session.close finalSeq stub fix). Create empty scaffolds for all three adapters and the Channel layer. Define the StreamError class that all adapters will use for error reporting.

Purpose: Establish the baseline so Wave 1+ can implement logic without infrastructure gaps.

Output: Directory structure, test infrastructure, preliminary type definitions, and one known Phase 2 stub patch.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/phases/03-api-adapters-single-hop-integration/03-RESEARCH.md
@.planning/phases/03-api-adapters-single-hop-integration/03-CONTEXT.md

Import from Phase 2:
@src/session/index.ts — Session class (reading close() method to patch)
@src/framing/types.ts — Frame types, CapabilityFrame shape, FRAME_MARKER, PROTOCOL_VERSION
@src/transport/endpoint.ts — PostMessageEndpoint interface
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create integration test directory and extend vitest config</name>
  <files>
    - tests/integration/.gitkeep
    - vitest.config.ts
  </files>
  <read_first>
    - vitest.config.ts (current project config)
  </read_first>
  <action>
1. Create `tests/integration/` directory (add `.gitkeep` to ensure git tracks it).
2. Read `vitest.config.ts` and update the `unit` project's `include` glob to also cover `tests/integration/**/*.{test,spec}.ts`. Keep all integration tests in the Node environment (no browser-mode project needed for Phase 3 — MockEndpoint runs in Node). Example new pattern: `include: ['tests/unit/**/*.{test,spec}.ts', 'tests/integration/**/*.{test,spec}.ts']`.
3. Commit message: `test: create integration test directory and extend vitest config for Phase 3`.
  </action>
  <verify>
    <automated>
      pnpm exec vitest list 2>&1 | grep -q "tests/integration" && echo "Integration glob present"
    </automated>
  </verify>
  <acceptance_criteria>
    - `tests/integration/` directory exists and is tracked by git
    - `vitest.config.ts` `unit` project's `include` array covers `tests/integration/**`
    - `pnpm exec vitest list` shows integration tests can be discovered (even though they don't exist yet)
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 2: Create MockEndpoint test helper using Node MessageChannel</name>
  <files>
    - tests/helpers/mock-endpoint.ts
  </files>
  <read_first>
    - src/transport/endpoint.ts (PostMessageEndpoint interface)
  </read_first>
  <action>
Create `tests/helpers/mock-endpoint.ts` exporting a single function `createMessageChannelPair()`:

```typescript
import { MessageChannel } from 'node:worker_threads';
import type { PostMessageEndpoint } from '../../src/transport/endpoint.js';

/**
 * Creates a bidirectional pair of PostMessageEndpoint objects backed by a real Node MessageChannel.
 * Both endpoints satisfy PostMessageEndpoint interface:
 * - Have postMessage(msg, transfer?) method
 * - Have onmessage getter/setter
 * Node's MessagePort auto-detaches ArrayBuffer on transfer and throws DataCloneError synchronously.
 * Message delivery is asynchronous (next event loop task).
 */
export function createMessageChannelPair(): {
  a: PostMessageEndpoint;
  b: PostMessageEndpoint;
} {
  const { port1, port2 } = new MessageChannel();
  // Direct cast is safe: Node MessagePort satisfies PostMessageEndpoint exactly
  // - port.postMessage(msg, transfer) matches signature
  // - port.onmessage getter/setter wraps received data in MessageEvent-like shape with .data property
  // - ArrayBuffer in transfer list is detached (byteLength === 0 post-transfer)
  // - Non-cloneable values throw DataCloneError synchronously
  // - No explicit .start() needed when using onmessage= assignment
  return {
    a: port1 as unknown as PostMessageEndpoint,
    b: port2 as unknown as PostMessageEndpoint,
  };
}
```

Commit message: `test: add MockEndpoint helper using Node MessageChannel (TEST-02)`.
  </action>
  <verify>
    <automated>
      pnpm exec tsc --noEmit src/transport/endpoint.ts tests/helpers/mock-endpoint.ts && echo "Types check"
    </automated>
  </verify>
  <acceptance_criteria>
    - `tests/helpers/mock-endpoint.ts` exports `createMessageChannelPair()` function
    - Function signature returns `{ a: PostMessageEndpoint; b: PostMessageEndpoint }`
    - File passes TypeScript strict type-check
    - No runtime dependencies (only Node built-in)
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 3: Define StreamError class and ErrorCode type</name>
  <files>
    - src/types.ts
  </files>
  <read_first>
    None (new file)
  </read_first>
  <action>
Create `src/types.ts` with the complete StreamError definition:

```typescript
/**
 * Error codes for all stream-related failures in Phase 3 and beyond.
 * Phase 3 uses: DataCloneError, PROTOCOL_MISMATCH, CONSUMER_STALL.
 * Phase 4 adds: CHANNEL_FROZEN, CHANNEL_DEAD, CHANNEL_CLOSED (type shape declared now for forward compatibility).
 * Phase 3 does not emit ORIGIN_REJECTED (that occurs before framing).
 */
export type ErrorCode =
  | 'DataCloneError'
  | 'ORIGIN_REJECTED'
  | 'PROTOCOL_MISMATCH'
  | 'CONSUMER_STALL'
  | 'CHANNEL_FROZEN'
  | 'CHANNEL_DEAD'
  | 'CHANNEL_CLOSED';

/**
 * Typed error for stream failures. All stream errors are StreamError instances with a .code discriminant.
 * The .cause field holds the underlying error (e.g., a native DataCloneError or session state).
 */
export class StreamError extends Error {
  readonly code: ErrorCode;
  override readonly cause: unknown;

  constructor(code: ErrorCode, cause: unknown) {
    super(`iframebuffer: ${code}`);
    this.name = 'StreamError';
    this.code = code;
    this.cause = cause;
  }
}
```

Commit message: `feat: add StreamError class and ErrorCode type (all adapters)`.
  </action>
  <verify>
    <automated>
      pnpm exec tsc --noEmit src/types.ts && echo "Types check"
    </automated>
  </verify>
  <acceptance_criteria>
    - `src/types.ts` exports `StreamError` class and `ErrorCode` type
    - `StreamError` extends `Error` with explicit `.code` and `.cause` fields
    - All 7 error codes are present in `ErrorCode` union
    - File passes TypeScript strict type-check
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 4: Patch Session.close() to accept optional finalSeq parameter</name>
  <files>
    - src/session/index.ts
  </files>
  <read_first>
    - src/session/index.ts (find close() method)
  </read_first>
  <action>
Locate the `close()` method in `Session` class and modify its signature to accept an optional `finalSeq?: number` parameter. Current implementation hardcodes `finalSeq: 0` when emitting the CLOSE frame. Change to:

```typescript
close(finalSeq?: number): void {
  // Existing FSM transition logic
  // ...
  // When emitting CLOSE frame:
  const closeFrame: CloseFrame = {
    [FRAME_MARKER]: 1,
    channelId: this.#channelId,
    streamId: this.#streamId,
    seqNum: this.#outSeq++,
    type: 'CLOSE',
    finalSeq: finalSeq ?? 0,  // Use provided finalSeq or default to 0
  };
  this.#onFrameOutCb?.(closeFrame);
}
```

The Channel layer (Phase 3's Channel class) will track the last outbound DATA seqNum and pass it to `session.close(lastDataSeqOut)`.

Commit message: `fix: patch Session.close() to accept finalSeq parameter (Phase 3 infrastructure)`.
  </action>
  <verify>
    <automated>
      pnpm exec tsc --noEmit src/session/index.ts && echo "Types check"
    </automated>
  </verify>
  <acceptance_criteria>
    - `Session.close()` method signature includes `finalSeq?: number` parameter
    - When CLOSE frame is emitted, `finalSeq` is set to the parameter value (or 0 if not provided)
    - Existing tests still pass: `pnpm test tests/unit/session/`
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 5: Create Channel directory and empty adapter scaffolds</name>
  <files>
    - src/channel/channel.ts
    - src/adapters/lowlevel.ts
    - src/adapters/emitter.ts
    - src/adapters/streams.ts
  </files>
  <read_first>
    None (creating new module files)
  </read_first>
  <action>
Create four new module files with minimal scaffolds:

**src/channel/channel.ts:**
```typescript
import type { PostMessageEndpoint } from '../transport/endpoint.js';
import type { Session } from '../session/index.js';

/**
 * Channel owns one PostMessageEndpoint and one Session.
 * Handles capability negotiation, frame encoding/decoding, and routing to the session.
 */
export interface ChannelOptions {
  // TBD — Phase 3 will define options (e.g., hooks?: SessionHooks for Phase 4)
}

export class Channel {
  #endpoint: PostMessageEndpoint;
  #session: Session;

  constructor(endpoint: PostMessageEndpoint, session: Session, options?: ChannelOptions) {
    this.#endpoint = endpoint;
    this.#session = session;
    // TODO: capability negotiation
  }

  get session(): Session {
    return this.#session;
  }

  openStream() {
    // TODO: implement
  }

  onStream(callback: (stream: unknown) => void): void {
    // TODO: implement
  }

  close(): void {
    // TODO: implement
  }
}

export function createChannel(
  endpoint: PostMessageEndpoint,
  options?: ChannelOptions,
): Channel {
  // TODO: implement factory
  throw new Error('Not implemented');
}
```

**src/adapters/lowlevel.ts:**
```typescript
import type { Channel } from '../channel/channel.js';

export interface LowLevelOptions {
  // TBD
}

export interface LowLevelStream {
  send(chunk: unknown, transfer?: Transferable[]): Promise<void>;
  onChunk(callback: (chunk: unknown) => void): void;
  onClose(callback: () => void): void;
  onError(callback: (err: unknown) => void): void;
  close(): void;
}

export function createLowLevelStream(
  channel: Channel,
  options?: LowLevelOptions,
): LowLevelStream {
  // TODO: implement
  throw new Error('Not implemented');
}
```

**src/adapters/emitter.ts:**
```typescript
import type { Channel } from '../channel/channel.js';

export interface EmitterOptions {
  // TBD
}

export interface EmitterStream {
  on(event: 'data' | 'end' | 'error' | 'close' | 'drain', handler: (...args: unknown[]) => void): this;
  off(event: 'data' | 'end' | 'error' | 'close' | 'drain', handler: (...args: unknown[]) => void): this;
  once(event: 'data' | 'end' | 'error' | 'close' | 'drain', handler: (...args: unknown[]) => void): this;
  write(chunk: unknown): boolean;
  end(): void;
  removeAllListeners(): void;
}

export function createEmitterStream(
  channel: Channel,
  options?: EmitterOptions,
): EmitterStream {
  // TODO: implement
  throw new Error('Not implemented');
}
```

**src/adapters/streams.ts:**
```typescript
import type { Channel } from '../channel/channel.js';

export interface StreamsOptions {
  // TBD
}

export interface StreamsPair {
  readable: ReadableStream;
  writable: WritableStream;
}

export function createStream(
  channel: Channel,
  options?: StreamsOptions,
): StreamsPair {
  // TODO: implement
  throw new Error('Not implemented');
}
```

Commit message: `scaffold: create Channel and adapter module scaffolds (Wave 1 entry points)`.
  </action>
  <verify>
    <automated>
      pnpm exec tsc --noEmit src/channel/channel.ts src/adapters/*.ts && echo "Types check"
    </automated>
  </verify>
  <acceptance_criteria>
    - All four files exist with proper TypeScript signatures
    - All exports are present (Channel class, createChannel, etc.)
    - Files pass TypeScript strict type-check
    - No implementation logic yet (scaffolds only)
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 6: Update src/index.ts to export Phase 3 types and factories</name>
  <files>
    - src/index.ts
  </files>
  <read_first>
    - src/index.ts (current exports)
  </read_first>
  <action>
Update `src/index.ts` to re-export Phase 3 public API:

```typescript
// Phase 1 + 2 existing exports
export * from './framing/types.js';
export { encode, decode } from './framing/encode-decode.js';
export * from './transport/endpoint.js';
export * from './transport/adapters/window.js';
export * from './transport/adapters/worker.js';
export * from './transport/adapters/message-port.js';
export * from './transport/adapters/service-worker.js';

// Phase 3 new exports
export { StreamError } from './types.js';
export type { ErrorCode } from './types.js';
export { createChannel, Channel } from './channel/channel.js';
export type { ChannelOptions } from './channel/channel.js';
export { createLowLevelStream } from './adapters/lowlevel.js';
export type { LowLevelStream, LowLevelOptions } from './adapters/lowlevel.js';
export { createEmitterStream } from './adapters/emitter.js';
export type { EmitterStream, EmitterOptions } from './adapters/emitter.js';
export { createStream } from './adapters/streams.js';
export type { StreamsPair, StreamsOptions } from './adapters/streams.js';
```

Commit message: `export: expose Phase 3 API surface from main entry point`.
  </action>
  <verify>
    <automated>
      pnpm exec tsc --noEmit src/index.ts && echo "Types check"
    </automated>
  </verify>
  <acceptance_criteria>
    - All Phase 3 factories are exported from `src/index.ts`
    - All type definitions are exported
    - File passes TypeScript strict type-check
    - `sideEffects: false` in package.json (already set from Phase 1) ensures tree-shakeability
  </acceptance_criteria>
</task>

</tasks>

<verification>
After all Wave 0 tasks:
- `tests/integration/` directory exists and is tracked
- `vitest.config.ts` includes integration tests in discovery
- `tests/helpers/mock-endpoint.ts` provides real MessageChannel pair for testing
- `src/types.ts` defines StreamError and all error codes
- `Session.close(finalSeq?: number)` signature is patched
- All four adapter module scaffolds exist with correct signatures
- `src/index.ts` exports all Phase 3 public API

Type checking: `pnpm exec tsc --noEmit`
Linting: `pnpm exec biome check .`
</verification>

<success_criteria>
- All 6 tasks complete
- No TypeScript errors: `pnpm exec tsc --noEmit`
- No lint errors: `pnpm exec biome check .`
- Integration directory discoverable by Vitest: `pnpm exec vitest list`
- Existing tests still pass: `pnpm test`
- All commits follow project convention (type prefix, description, no overwriting)
</success_criteria>

<output>
After completion, create `.planning/phases/03-api-adapters-single-hop-integration/03-00-SUMMARY.md`
</output>
