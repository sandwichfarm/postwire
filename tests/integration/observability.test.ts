// tests/integration/observability.test.ts
// OBS-01 — stats() snapshot; OBS-02 — typed error events routing.
// Uses real Node MessageChannel for full structured-clone semantics.
//
// Wave 1 executor: implement the it.todo stubs using channel.stats() once wired in Plan 01.
// The stats() method does not exist yet — it is the Plan 01 deliverable.
import { describe, it } from "vitest";

describe("Channel — stats() (OBS-01)", () => {
  it.todo("stats() returns correct frameCountsByType after a complete stream");
  it.todo("stats() returns non-zero bytesSent and bytesReceived after data transfer");
  it.todo("stats() returns reorderBufferDepth = 0 after clean delivery");
  it.todo("stats() returns creditWindowAvailable as a number");
});

describe("Channel — error event routing (OBS-02)", () => {
  it.todo("CREDIT_DEADLOCK surfaces as typed error event on channel");
  it.todo("REORDER_OVERFLOW caught in Session surfaces as typed error event on channel");
  it.todo("ORIGIN_REJECTED surfaces as typed error event on channel via window adapter hook");
});
