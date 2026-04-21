---
phase: 03-api-adapters-single-hop-integration
plan: 05
type: execute
wave: 3
depends_on:
  - "03-02"
  - "03-03"
  - "03-04"
files_modified:
  - tests/integration/heap-flat.test.ts
autonomous: true
requirements:
  - TEST-02
  - FAST-02
user_setup: []
must_haves:
  truths:
    - "MockEndpoint provides real structured-clone semantics via Node MessageChannel"
    - "Transferable semantics respected (ArrayBuffer detach, etc.)"
    - "Heap stays flat under fast-send/slow-consume (credit window prevents unbounded buffering)"
    - "Transferable ReadableStream feature-detect probe logic present but returns false in Phase 3"
    - "All integration tests use MockEndpoint without real browser or worker"
  artifacts:
    - path: tests/integration/heap-flat.test.ts
      provides: "Heap-flat slow-consumer test proving credit window bounds memory"
  key_links:
    - from: MockEndpoint
      to: structured-clone semantics
      via: "Node MessageChannel provides real clone behavior"
      pattern: "MessageChannel.*onmessage"
    - from: credit window
      to: heap flatness
      via: "Session only buffers up to HWM chunks"
      pattern: "credit.*hwm.*buffer"
    - from: heap measurement
      to: delta assertion
      via: "heapUsed delta < 10 MB threshold"
      pattern: "heapUsed.*10.*MB"
---

<objective>
Create the heap-flat slow-consumer test proving that the credit window gates actual memory growth. This test validates that when a fast sender meets a slow consumer, the library's internal buffering stays bounded — not linear. Also confirm transferable ReadableStream probe logic is present but disabled in Phase 3.

Purpose: Prove that backpressure is wired correctly at the protocol level (SESS-03), not just at the API surface. Provide evidence that Phase 3's infrastructure is sound before moving to advanced features.

Output: Heap-flat integration test and transferable-streams probe verification.
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

From Wave 0:
@tests/helpers/mock-endpoint.ts — createMessageChannelPair()

From Wave 2:
@src/adapters/lowlevel.ts — Low-level adapter for simple test setup
@src/adapters/streams.ts — WHATWG Streams adapter for pipeTo test variant
</context>

<tasks>

<task type="auto">
  <name>Task 1: Implement heap-flat slow-consumer integration test</name>
  <files>
    - tests/integration/heap-flat.test.ts
  </files>
  <read_first>
    - 03-RESEARCH.md (Heap-Flat Test Pattern section)
    - tests/helpers/mock-endpoint.ts
  </read_first>
  <action>
Create `tests/integration/heap-flat.test.ts` based on RESEARCH.md pattern:

```typescript
import { describe, it, expect } from 'vitest';
import { createMessageChannelPair } from '../helpers/mock-endpoint.js';
import { createChannel } from '../../src/channel/channel.js';
import { createStream } from '../../src/adapters/streams.js';

/**
 * Heap-flat slow-consumer test.
 * Validates that credit window bounds buffering — heap should NOT grow linearly.
 * Fast sender → slow consumer (1 chunk/sec) with 64 KB chunks.
 * Expected: heap delta < 10 MB over 3 seconds.
 */
describe('heap-flat slow-consumer (SESS-03)', { concurrent: false }, () => {
  it('heap stays flat under fast-send/slow-consume', async () => {
    const { a, b } = createMessageChannelPair();
    const chanA = createChannel(a);
    const chanB = createChannel(b);

    const { readable: readerB, writable: writerA } = createStream(chanA);
    const { readable: readerA } = createStream(chanB);

    const writer = writerA.getWriter();
    const reader = readerB.getReader();

    // Warm-up phase: prime the JIT, initialize heaps
    // Send a few chunks and consume them
    for (let i = 0; i < 3; i++) {
      const warmChunk = new ArrayBuffer(64 * 1024);
      await writer.write(warmChunk);
      const { done } = await reader.read();
      if (done) break;
    }

    // Brief pause to let GC settle
    await new Promise(r => setTimeout(r, 500));

    // Measurement phase
    const DURATION_MS = 3000; // 3 seconds
    const CHUNK_SIZE = 64 * 1024; // 64 KB chunks
    const chunk = new ArrayBuffer(CHUNK_SIZE);

    const heapBefore = process.memoryUsage().heapUsed;

    // Sender: write as fast as possible for DURATION_MS
    const sendLoop = (async () => {
      const end = Date.now() + DURATION_MS;
      while (Date.now() < end) {
        try {
          await writer.write(chunk.slice(0)); // slice() to avoid re-transfer
        } catch (_) {
          // Stream may error if reader closes
          break;
        }
      }
      try {
        await writer.close();
      } catch (_) {
        // May already be closed
      }
    })();

    // Consumer: read 1 chunk per second
    const readLoop = (async () => {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
        // Wait 1 second before reading next
        await new Promise(r => setTimeout(r, 1000));
      }
    })();

    // Run both concurrently
    await Promise.race([
      Promise.all([sendLoop, readLoop]),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), DURATION_MS + 2000),
      ),
    ]);

    const heapAfter = process.memoryUsage().heapUsed;
    const heapDelta = heapAfter - heapBefore;
    const heapDeltaMB = heapDelta / 1024 / 1024;

    console.log(`Heap before: ${(heapBefore / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Heap after: ${(heapAfter / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Heap delta: ${heapDeltaMB.toFixed(2)} MB`);

    // Assert: heap delta should be less than 10 MB
    // (generous threshold to account for Vitest overhead, GC variance)
    expect(heapDeltaMB).toBeLessThan(10);
  }, 15_000); // 15-second timeout (3s test + 2s buffer + Vitest overhead)

  it('heap-flat test completes without hanging or OOM', async () => {
    // Simple variant that just verifies the test can run without errors
    const { a, b } = createMessageChannelPair();
    const chanA = createChannel(a);
    const chanB = createChannel(b);

    const { writable } = createStream(chanA);
    const { readable } = createStream(chanB);

    const writer = writable.getWriter();
    const reader = readable.getReader();

    // Short run: send 5 chunks, receive 5
    for (let i = 0; i < 5; i++) {
      const chunk = new ArrayBuffer(1024);
      await writer.write(chunk);
      const { done } = await reader.read();
      expect(done).toBe(false);
    }

    await writer.close();
    const { done } = await reader.read();
    expect(done).toBe(true);
  }, 5_000);
});
```

Commit message: `test: add heap-flat slow-consumer integration test (TEST-02, SESS-03 proof)`.
  </action>
  <verify>
    <automated>
      pnpm exec vitest run --project=unit tests/integration/heap-flat.test.ts --reporter=verbose
    </automated>
  </verify>
  <acceptance_criteria>
    - Test sends 64 KB chunks at high speed for 3 seconds
    - Consumer reads 1 chunk per second
    - Heap delta is measured and asserted < 10 MB
    - Test completes within 15-second timeout
    - Heap delta passes assertion (credit window bounds buffering)
    - No OOM errors
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 2: Verify transferable ReadableStream probe logic (FAST-02)</name>
  <files>
    - src/channel/channel.ts (or capability module if extracted)
  </files>
  <read_first>
    - src/channel/channel.ts (current implementation)
    - 03-RESEARCH.md (Transferable ReadableStream Probe section)
  </read_first>
  <action>
Verify that `src/channel/channel.ts` includes the transferable ReadableStream feature-detect probe (disabled in Phase 3). The probe logic should exist but return `false` by default:

```typescript
// Inside Channel capability detection or in a separate capability module:

/**
 * Detect if ReadableStream is transferable in this environment.
 * Phase 3: Always returns false (safely disabled for initial launch).
 * Phase 5/9: Flip to true and enable the actual probe.
 * Pattern from RESEARCH.md.
 */
function checkReadableStreamTransferable(): boolean {
  // Phase 3: safely disabled
  return false;

  // Phase 5/9: uncomment to enable actual detection
  /*
  try {
    const { port1, port2 } = new MessageChannel();
    const rs = new ReadableStream();
    port1.postMessage(rs, [rs as unknown as Transferable]);
    port1.close();
    port2.close();
    return true;
  } catch {
    return false;
  }
  */
}
```

This function should be called during CAPABILITY frame generation so `transferableStreams` field is correct.

Commit message: `feat: add transferable ReadableStream probe (FAST-02, disabled in Phase 3)`.
  </action>
  <verify>
    <automated>
      pnpm exec tsc --noEmit src/channel/channel.ts && echo "Types check"
    </automated>
  </verify>
  <acceptance_criteria>
    - Probe function exists in Channel or capability module
    - Returns false in Phase 3 (safe default)
    - Probe logic is syntactically correct (even if disabled)
    - Used in CAPABILITY frame generation
    - TypeScript checks pass
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 3: Document MockEndpoint testing strategy and limitations</name>
  <files>
    None (documentation in test comments)
  </files>
  <read_first>
    - tests/helpers/mock-endpoint.ts
    - 03-RESEARCH.md (Pattern 5 section)
  </read_first>
  <action>
Verify that `tests/helpers/mock-endpoint.ts` includes clear documentation of MockEndpoint behavior:

```typescript
/**
 * Creates a bidirectional pair of PostMessageEndpoint objects backed by a real Node MessageChannel.
 *
 * GUARANTEES (verified against Node 22.22.1):
 * 1. Structured-clone semantics: Non-cloneable values throw DataCloneError synchronously
 * 2. Transferable semantics: ArrayBuffer in transfer list is detached (byteLength === 0 after)
 * 3. Async delivery: Messages arrive asynchronously (next event loop task), not sync
 * 4. onmessage auto-start: Setting onmessage= automatically enables message reception (no .start() needed)
 *
 * LIMITATIONS (Phase 9 cross-browser tests will verify browser-specific behavior):
 * 1. No cross-origin isolation or COOP/COEP headers (SAB tests require Phase 6+)
 * 2. Not a real Worker or iframe (lifecycle differences handled in Phase 4)
 * 3. No browser-specific quirks (e.g., browser MessagePort .start() requirement with addEventListener)
 *
 * USE FOR: All Phase 3 unit + integration tests of frame-level logic
 * DO NOT USE FOR: Lifecycle, BFCache, ServiceWorker scenarios (Phase 4+), real-browser contexts (Phase 9)
 */
```

Commit message: `docs: add MockEndpoint documentation and testing strategy notes`.
  </action>
  <verify>
    <automated>
      grep -q "GUARANTEES" tests/helpers/mock-endpoint.ts && echo "Documentation present"
    </automated>
  </verify>
  <acceptance_criteria>
    - MockEndpoint helper includes clear documentation of guarantees and limitations
    - Guarantees match Node 22 behavior (verified in RESEARCH.md)
    - Limitations are documented for Phase 4/9 planning
    - No code changes needed (documentation only)
  </acceptance_criteria>
</task>

</tasks>

<verification>
After Wave 3.5 task completion:
- Heap-flat slow-consumer test implemented
- Test proves credit window bounds buffering (heap delta < 10 MB)
- Transferable ReadableStream probe logic present but disabled in Phase 3
- MockEndpoint documentation updated
- All integration tests using MockEndpoint cover TEST-02 requirement
- Type-check: `pnpm exec tsc --noEmit`
- Full test suite: `pnpm test`
</verification>

<success_criteria>
- Heap-flat test passes (heap delta < 10 MB)
- Test completes within timeout (3s actual + 2s buffer)
- Transferable ReadableStream probe function exists and returns false
- MockEndpoint documented with guarantees and limitations
- All Phase 3 adapters tested via MockEndpoint
- No test hangs or OOM errors
- All existing tests still pass
</success_criteria>

<output>
After completion, create `.planning/phases/03-api-adapters-single-hop-integration/03-05-SUMMARY.md`
</output>
