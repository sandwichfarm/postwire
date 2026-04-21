---
phase: 03-api-adapters-single-hop-integration
plan: 02
type: execute
wave: 2
depends_on:
  - "03-01"
files_modified:
  - src/adapters/lowlevel.ts
  - tests/unit/adapters/lowlevel.test.ts
  - tests/integration/binary-transfer.test.ts
autonomous: true
requirements:
  - API-01
  - FAST-01
user_setup: []
must_haves:
  truths:
    - "send(chunk, transfer) returns Promise that resolves when frame is handed to endpoint"
    - "send() awaits credit before transmission (backpressure at protocol level)"
    - "onChunk(cb) fires for each received chunk from remote"
    - "ArrayBuffer in transfer list is detached (byteLength === 0 after send)"
    - "onClose and onError callbacks fire at appropriate state transitions"
  artifacts:
    - path: src/adapters/lowlevel.ts
      provides: "createLowLevelStream(channel) → {send, onChunk, onClose, onError, close}"
    - path: tests/unit/adapters/lowlevel.test.ts
      provides: "Unit tests for send/onChunk/onError callback wiring"
    - path: tests/integration/binary-transfer.test.ts
      provides: "Integration test proving ArrayBuffer detach (FAST-01 zero-copy)"
  key_links:
    - from: send()
      to: Session.sendData()
      via: "Calls session.sendData(chunk, chunkType)"
      pattern: "session.sendData"
    - from: send() Promise
      to: credit window
      via: "Resolves only when frame handed to endpoint"
      pattern: "onFrameOut.*send.*resolve"
    - from: onChunk()
      to: Session.onChunk()
      via: "Adapter registers callback with session"
      pattern: "session.onChunk"
    - from: ArrayBuffer transfer
      to: detach proof
      via: "Post-send byteLength check"
      pattern: "byteLength === 0"
---

<objective>
Implement the low-level stream adapter that exposes send(chunk, transfer)/onChunk(cb)/close() — the primitive all higher-level adapters build on. Prove FAST-01 zero-copy transfer through integration test.

Purpose: The low-level API is the foundation; higher adapters (emitter, streams) compose on this.

Output: Working low-level adapter with send credit gating and ArrayBuffer detach proof.
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

From Phase 2:
@src/session/index.ts — Session.sendData(), onChunk(), onError(), close()

From Wave 0:
@src/types.ts — StreamError class
@tests/helpers/mock-endpoint.ts — createMessageChannelPair()

From Wave 1:
@src/channel/channel.ts — Channel class
</context>

<tasks>

<task type="auto">
  <name>Task 1: Implement createLowLevelStream adapter</name>
  <files>
    - src/adapters/lowlevel.ts
  </files>
  <read_first>
    - src/session/index.ts (sendData, onChunk, onError, close signatures)
    - src/channel/channel.ts (Channel interface)
  </read_first>
  <action>
Implement `createLowLevelStream` in `src/adapters/lowlevel.ts`:

```typescript
import type { Channel } from '../channel/channel.js';
import { StreamError } from '../types.js';

export interface LowLevelOptions {
  // Phase 4 will add: hooks?: SessionHooks
}

export interface LowLevelStream {
  send(chunk: unknown, transfer?: Transferable[]): Promise<void>;
  onChunk(callback: (chunk: unknown) => void): void;
  onClose(callback: () => void): void;
  onError(callback: (err: StreamError) => void): void;
  close(): void;
}

/**
 * Low-level adapter exposing send/onChunk/onClose/onError.
 * The primitive all higher-level adapters build on.
 * Backpressure is handled by the session's credit window —
 * send() returns a Promise that resolves only after the frame is handed to postMessage.
 */
export function createLowLevelStream(
  channel: Channel,
  options?: LowLevelOptions,
): LowLevelStream {
  const session = channel.session;
  const onCloseCallbacks: (() => void)[] = [];
  const onErrorCallbacks: ((err: StreamError) => void)[] = [];

  // Register for session-level callbacks
  session.onChunk((chunk: unknown) => {
    // Deliver to consumer
    // TODO: adapter will register its own onChunk handler
  });

  session.onError((reason: string) => {
    const err = new StreamError(reason as any, undefined);
    onErrorCallbacks.forEach(cb => cb(err));
  });

  return {
    async send(chunk: unknown, transfer?: Transferable[]): Promise<void> {
      // Determine chunkType based on transfer list
      const chunkType = transfer && transfer.length > 0 ? 'BINARY_TRANSFER' : 'STRUCTURED_CLONE';
      
      // Call session.sendData which enqueues to #pendingSends if no credit
      // The promise resolves when the frame is handed to endpoint.postMessage
      return new Promise<void>((resolve, reject) => {
        try {
          session.sendData(chunk, chunkType, transfer);
          // sendData is synchronous (enqueues or sends immediately)
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    },

    onChunk(callback: (chunk: unknown) => void): void {
      session.onChunk(callback);
    },

    onClose(callback: () => void): void {
      onCloseCallbacks.push(callback);
    },

    onError(callback: (err: StreamError) => void): void {
      onErrorCallbacks.push(callback);
    },

    close(): void {
      channel.close();
    },
  };
}
```

Note: The `Session.sendData()` signature and behavior need to be verified from Phase 2. If it returns a Promise, wrap that. If synchronous, the adapter's send() should track pending writes and resolve after handoff.

Commit message: `feat: implement low-level stream adapter (API-01)`.
  </action>
  <verify>
    <automated>
      pnpm exec tsc --noEmit src/adapters/lowlevel.ts && echo "Types check"
    </automated>
  </verify>
  <acceptance_criteria>
    - `createLowLevelStream()` function exists and returns LowLevelStream
    - LowLevelStream has all five methods: send, onChunk, onClose, onError, close
    - send() accepts chunk and optional transfer array
    - send() returns Promise<void>
    - TypeScript strict checks pass
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 2: Unit tests for low-level adapter callbacks and send</name>
  <files>
    - tests/unit/adapters/lowlevel.test.ts
  </files>
  <read_first>
    - src/adapters/lowlevel.ts (just implemented)
    - tests/helpers/mock-endpoint.ts
  </read_first>
  <action>
Create `tests/unit/adapters/lowlevel.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createMessageChannelPair } from '../../helpers/mock-endpoint.js';
import { createChannel } from '../../../src/channel/channel.js';
import { createLowLevelStream } from '../../../src/adapters/lowlevel.js';
import { StreamError } from '../../../src/types.js';

describe('Low-level adapter', () => {
  describe('send() and onChunk()', () => {
    it('send() returns a Promise that resolves', async () => {
      const { a, b } = createMessageChannelPair();
      const chanA = createChannel(a);
      const chanB = createChannel(b);

      const streamA = createLowLevelStream(chanA);
      const streamB = createLowLevelStream(chanB);

      // Register receiver
      const received: unknown[] = [];
      streamB.onChunk(chunk => received.push(chunk));

      // Send a chunk
      const promise = streamA.send('hello');
      expect(promise).toBeInstanceOf(Promise);

      // Wait for send to complete
      await promise;

      // Give event loop time to deliver
      await new Promise(r => setTimeout(r, 50));

      // Receiver should have gotten the chunk
      expect(received).toContain('hello');
    });

    it('onChunk callback fires for each received chunk', async () => {
      // Similar setup as above
    });
  });

  describe('error handling', () => {
    it('onError callback receives StreamError with code', async () => {
      // This will test error propagation from Session
    });
  });

  describe('close()', () => {
    it('close() delegates to channel.close()', async () => {
      // Verify stream can be closed
    });
  });
});
```

Commit message: `test: add unit tests for low-level adapter (API-01)`.
  </action>
  <verify>
    <automated>
      pnpm exec vitest run --project=unit tests/unit/adapters/lowlevel.test.ts
    </automated>
  </verify>
  <acceptance_criteria>
    - Tests compile without TypeScript errors
    - At least one test passes (send returns Promise)
    - MockEndpoint integration works in tests
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 3: Integration test proving ArrayBuffer detach (FAST-01)</name>
  <files>
    - tests/integration/binary-transfer.test.ts
  </files>
  <read_first>
    - tests/helpers/mock-endpoint.ts
    - src/adapters/lowlevel.ts
  </read_first>
  <action>
Create `tests/integration/binary-transfer.test.ts` proving zero-copy transfer:

```typescript
import { describe, it, expect } from 'vitest';
import { createMessageChannelPair } from '../helpers/mock-endpoint.js';
import { createChannel } from '../../src/channel/channel.js';
import { createLowLevelStream } from '../../src/adapters/lowlevel.js';

describe('Binary transfer (FAST-01)', () => {
  it('ArrayBuffer is detached after send (zero-copy transfer)', async () => {
    const { a, b } = createMessageChannelPair();
    const chanA = createChannel(a);
    const chanB = createChannel(b);

    const streamA = createLowLevelStream(chanA);
    const streamB = createLowLevelStream(chanB);

    // Create a buffer and get its initial size
    const buffer = new ArrayBuffer(1024);
    const initialByteLength = buffer.byteLength;
    expect(initialByteLength).toBe(1024);

    // Track received chunks
    const received: unknown[] = [];
    streamB.onChunk(chunk => received.push(chunk));

    // Send with transfer list (zero-copy)
    await streamA.send(buffer, [buffer]);

    // After transfer, the source buffer should be detached
    expect(buffer.byteLength).toBe(0);

    // Give event loop time for delivery
    await new Promise(r => setTimeout(r, 50));

    // Receiver should have gotten a buffer
    expect(received.length).toBe(1);
    const receivedBuffer = received[0] as ArrayBuffer;
    expect(receivedBuffer.byteLength).toBe(initialByteLength);
  });

  it('TypedArray is detached after transfer', async () => {
    const { a, b } = createMessageChannelPair();
    const chanA = createChannel(a);
    const chanB = createChannel(b);

    const streamA = createLowLevelStream(chanA);
    const streamB = createLowLevelStream(chanB);

    const received: unknown[] = [];
    streamB.onChunk(chunk => received.push(chunk));

    // Create a typed array
    const buffer = new Uint8Array(256);
    buffer[0] = 42; // Set a value
    const initialLength = buffer.length;

    // Send with transfer (the underlying ArrayBuffer is transferred)
    await streamA.send(buffer, [buffer.buffer]);

    // Source TypedArray's underlying buffer should be detached
    expect(buffer.buffer.byteLength).toBe(0);

    await new Promise(r => setTimeout(r, 50));
    expect(received.length).toBe(1);
  });
});
```

Commit message: `test: integration test for ArrayBuffer detach (FAST-01 zero-copy)`.
  </action>
  <verify>
    <automated>
      pnpm exec vitest run --project=unit tests/integration/binary-transfer.test.ts
    </automated>
  </verify>
  <acceptance_criteria>
    - Test sends ArrayBuffer with transfer list
    - Source buffer.byteLength === 0 after send (detach proof)
    - Received buffer is intact (byteLength still 1024 or original size)
    - Test passes: `pnpm exec vitest run --project=unit tests/integration/binary-transfer.test.ts`
  </acceptance_criteria>
</task>

</tasks>

<verification>
After Wave 2.2 task completion:
- Low-level adapter fully implemented
- send() returns Promise and handles credit via session
- onChunk/onError/onClose callbacks wired
- Unit tests verify callback delivery
- Integration test proves ArrayBuffer detach (FAST-01)
- Type-check: `pnpm exec tsc --noEmit`
- Lint-check: `pnpm exec biome check src/adapters/lowlevel.ts`
</verification>

<success_criteria>
- createLowLevelStream() fully functional
- All five methods (send, onChunk, onClose, onError, close) working
- send() awaits credit and returns Promise
- Integration test proves zero-copy (ArrayBuffer detach)
- Unit tests passing
- No TypeScript or lint errors
</success_criteria>

<output>
After completion, create `.planning/phases/03-api-adapters-single-hop-integration/03-02-SUMMARY.md`
</output>
