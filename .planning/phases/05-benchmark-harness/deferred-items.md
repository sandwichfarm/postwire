# Deferred Items — Phase 05

## Pre-existing Test Failure (Out of Scope)

**File:** `tests/integration/heap-flat.test.ts`
**Test:** `heap-flat slow-consumer (SESS-03) > heap stays flat under fast-send / slow-consume (credit window proof)`
**Error:** `AssertionError: expected 23.99 to be less than 20`
**Status:** Pre-existing failure present before Phase 05 work. Not caused by benchmark harness changes.
**Verified:** Confirmed by stashing Phase 05 changes — test still fails on master (6feacb2).
**Action needed:** Fix timing-sensitive assertion in a future plan. Not blocking Phase 05 plan 00.
