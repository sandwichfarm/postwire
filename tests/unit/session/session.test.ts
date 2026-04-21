// tests/unit/session/session.test.ts
// Integration tests for Session — full frame lifecycle and cross-module wraparound fuzz.
// Requirements: SESS-06 (end-to-end wraparound), TEST-01 (headless Node), TEST-06 (property test).

import * as fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataFrame, Frame } from "../../../src/framing/types.js";
import { FRAME_MARKER } from "../../../src/framing/types.js";
import { Session } from "../../../src/session/index.js";

// ---------------------------------------------------------------------------
// Test helper — minimal frame constructors
// ---------------------------------------------------------------------------

function makeOpen(channelId: string, streamId: number, seqNum = 0, initCredit = 16): Frame {
  return { [FRAME_MARKER]: 1, channelId, streamId, seqNum, type: "OPEN", initCredit };
}

function makeOpenAck(channelId: string, streamId: number, seqNum = 0, initCredit = 16): Frame {
  return { [FRAME_MARKER]: 1, channelId, streamId, seqNum, type: "OPEN_ACK", initCredit };
}

function makeData(
  channelId: string,
  streamId: number,
  seqNum: number,
  payload: unknown,
  isFinal = true,
): DataFrame {
  return {
    [FRAME_MARKER]: 1,
    channelId,
    streamId,
    seqNum,
    type: "DATA",
    chunkType: "STRUCTURED_CLONE",
    payload,
    isFinal,
  };
}

function makeCredit(channelId: string, streamId: number, seqNum: number, credit: number): Frame {
  return { [FRAME_MARKER]: 1, channelId, streamId, seqNum, type: "CREDIT", credit };
}

function makeClose(channelId: string, streamId: number, seqNum: number, finalSeq: number): Frame {
  return { [FRAME_MARKER]: 1, channelId, streamId, seqNum, type: "CLOSE", finalSeq };
}

function makeReset(channelId: string, streamId: number, seqNum: number, reason: string): Frame {
  return { [FRAME_MARKER]: 1, channelId, streamId, seqNum, type: "RESET", reason };
}

function makeCancel(channelId: string, streamId: number, seqNum: number, reason: string): Frame {
  return { [FRAME_MARKER]: 1, channelId, streamId, seqNum, type: "CANCEL", reason };
}

// ---------------------------------------------------------------------------
// TEST-01: All session tests run in Node env — no browser APIs needed
// ---------------------------------------------------------------------------

describe("Session — TEST-01: headless Node environment", () => {
  it("no DOM APIs used — typeof window is undefined", () => {
    expect(typeof window).toBe("undefined");
  });
});

// ---------------------------------------------------------------------------
// Responder side
// ---------------------------------------------------------------------------

describe("Session — responder side", () => {
  it("receives OPEN and emits OPEN_ACK, reaches OPEN state", () => {
    const session = new Session({
      channelId: "ch1",
      streamId: 1,
      role: "responder",
      stallTimeoutMs: 0,
    });

    const outFrames: Frame[] = [];
    session.onFrameOut((f) => outFrames.push(f));

    session.receiveFrame(makeOpen("ch1", 1, 0));

    expect(session.state).toBe("OPEN");
    expect(outFrames).toHaveLength(1);
    expect(outFrames[0].type).toBe("OPEN_ACK");
    expect((outFrames[0] as { type: "OPEN_ACK"; initCredit: number }).initCredit).toBeGreaterThan(
      0,
    );
  });

  it("after OPEN, receives in-order DATA frames and calls onChunk in order", () => {
    const session = new Session({
      channelId: "ch1",
      streamId: 1,
      role: "responder",
      initialCredit: 8,
      stallTimeoutMs: 0,
    });

    const chunks: unknown[] = [];
    session.onChunk((c) => chunks.push(c));
    session.onFrameOut(() => {});

    session.receiveFrame(makeOpen("ch1", 1, 0));
    session.receiveFrame(makeData("ch1", 1, 0, "alpha"));
    session.receiveFrame(makeData("ch1", 1, 1, "beta"));
    session.receiveFrame(makeData("ch1", 1, 2, "gamma"));

    expect(chunks).toEqual(["alpha", "beta", "gamma"]);
  });

  it("receives out-of-order DATA frames and delivers them in seqNum order", () => {
    const session = new Session({
      channelId: "ch1",
      streamId: 1,
      role: "responder",
      initialCredit: 16,
      stallTimeoutMs: 0,
    });

    const chunks: unknown[] = [];
    session.onChunk((c) => chunks.push(c));
    session.onFrameOut(() => {});

    session.receiveFrame(makeOpen("ch1", 1, 0));

    // Deliver frames out of order: 2, 0, 1
    session.receiveFrame(makeData("ch1", 1, 2, "third"));
    expect(chunks).toHaveLength(0); // gap: seq 0 missing

    session.receiveFrame(makeData("ch1", 1, 0, "first"));
    expect(chunks).toHaveLength(1); // seq 0 delivered
    expect(chunks[0]).toBe("first");

    session.receiveFrame(makeData("ch1", 1, 1, "second"));
    expect(chunks).toHaveLength(3); // seq 1 + seq 2 drain
    expect(chunks[1]).toBe("second");
    expect(chunks[2]).toBe("third");
  });

  it("receives RESET and calls onError with reason, FSM reaches ERRORED", () => {
    const session = new Session({
      channelId: "ch1",
      streamId: 1,
      role: "responder",
      stallTimeoutMs: 0,
    });

    const errors: string[] = [];
    session.onError((r) => errors.push(r));
    session.onFrameOut(() => {});

    // Move to OPEN first
    session.receiveFrame(makeOpen("ch1", 1, 0));
    expect(session.state).toBe("OPEN");

    session.receiveFrame(makeReset("ch1", 1, 1, "stream-error"));

    expect(session.state).toBe("ERRORED");
    expect(errors).toEqual(["stream-error"]);
  });

  it("receives CANCEL and calls onError, FSM reaches CANCELLED", () => {
    const session = new Session({
      channelId: "ch1",
      streamId: 1,
      role: "responder",
      stallTimeoutMs: 0,
    });

    const errors: string[] = [];
    session.onError((r) => errors.push(r));
    session.onFrameOut(() => {});

    session.receiveFrame(makeOpen("ch1", 1, 0));
    session.receiveFrame(makeCancel("ch1", 1, 1, "consumer-abort"));

    expect(session.state).toBe("CANCELLED");
    expect(errors).toEqual(["consumer-abort"]);
  });

  it("drops frames silently when in terminal state — no throw", () => {
    const session = new Session({
      channelId: "ch1",
      streamId: 1,
      role: "responder",
      stallTimeoutMs: 0,
    });

    session.onFrameOut(() => {});

    session.receiveFrame(makeOpen("ch1", 1, 0));
    session.receiveFrame(makeReset("ch1", 1, 1, "err"));

    expect(session.state).toBe("ERRORED");

    // This must NOT throw — isTerminalState guard silently drops
    expect(() => {
      session.receiveFrame(makeData("ch1", 1, 2, "delayed"));
    }).not.toThrow();

    // State must remain ERRORED — no re-transition
    expect(session.state).toBe("ERRORED");
  });

  it("receives CLOSE frame and FSM reaches REMOTE_HALF_CLOSED", () => {
    const session = new Session({
      channelId: "ch1",
      streamId: 1,
      role: "responder",
      stallTimeoutMs: 0,
    });
    session.onFrameOut(() => {});

    session.receiveFrame(makeOpen("ch1", 1, 0));
    expect(session.state).toBe("OPEN");

    session.receiveFrame(makeClose("ch1", 1, 1, 0));
    expect(session.state).toBe("REMOTE_HALF_CLOSED");
  });
});

// ---------------------------------------------------------------------------
// Initiator side
// ---------------------------------------------------------------------------

describe("Session — initiator side", () => {
  it("open() sends OPEN frame and transitions IDLE → OPENING", () => {
    const session = new Session({
      channelId: "ch2",
      streamId: 2,
      role: "initiator",
      stallTimeoutMs: 0,
    });

    const outFrames: Frame[] = [];
    session.onFrameOut((f) => outFrames.push(f));

    session.open();

    expect(session.state).toBe("OPENING");
    expect(outFrames).toHaveLength(1);
    expect(outFrames[0].type).toBe("OPEN");
  });

  it("sendData emits DATA frame when send credit is available (after OPEN_ACK)", () => {
    const session = new Session({
      channelId: "ch2",
      streamId: 2,
      role: "initiator",
      initialCredit: 4,
      stallTimeoutMs: 0,
    });

    const outFrames: Frame[] = [];
    session.onFrameOut((f) => outFrames.push(f));

    session.open();
    // Simulate receiving OPEN_ACK with 4 initial credits
    session.receiveFrame(makeOpenAck("ch2", 2, 0, 4));
    expect(session.state).toBe("OPEN");

    session.sendData("hello", "STRUCTURED_CLONE");

    const dataFrames = outFrames.filter((f) => f.type === "DATA");
    expect(dataFrames).toHaveLength(1);
    expect((dataFrames[0] as DataFrame).payload).toBe("hello");
  });

  it("sendData queues when credit exhausted; no DATA frame emitted until credit arrives", () => {
    const session = new Session({
      channelId: "ch2",
      streamId: 2,
      role: "initiator",
      initialCredit: 1, // only 1 credit
      stallTimeoutMs: 0,
    });

    const outFrames: Frame[] = [];
    session.onFrameOut((f) => outFrames.push(f));

    session.open();
    session.receiveFrame(makeOpenAck("ch2", 2, 0, 1));

    // First sendData consumes the 1 credit
    session.sendData("msg1", "STRUCTURED_CLONE");
    const after1 = outFrames.filter((f) => f.type === "DATA").length;
    expect(after1).toBe(1);

    // Second sendData: no credit left — should be queued, NOT emitted
    session.sendData("msg2", "STRUCTURED_CLONE");
    const after2 = outFrames.filter((f) => f.type === "DATA").length;
    expect(after2).toBe(1); // still 1 — msg2 is queued
  });

  it("CREDIT frame unblocks queued sends and drains the queue", () => {
    const session = new Session({
      channelId: "ch2",
      streamId: 2,
      role: "initiator",
      initialCredit: 1,
      stallTimeoutMs: 0,
    });

    const outFrames: Frame[] = [];
    session.onFrameOut((f) => outFrames.push(f));

    session.open();
    session.receiveFrame(makeOpenAck("ch2", 2, 0, 1));

    // Exhaust credit
    session.sendData("msg1", "STRUCTURED_CLONE");
    // Queue two more
    session.sendData("msg2", "STRUCTURED_CLONE");
    session.sendData("msg3", "STRUCTURED_CLONE");

    expect(outFrames.filter((f) => f.type === "DATA")).toHaveLength(1);

    // CREDIT frame grants 5 more credits — should drain both queued sends
    session.receiveFrame(makeCredit("ch2", 2, 1, 5));

    const dataFrames = outFrames.filter((f) => f.type === "DATA");
    expect(dataFrames).toHaveLength(3);
    expect((dataFrames[0] as DataFrame).payload).toBe("msg1");
    expect((dataFrames[1] as DataFrame).payload).toBe("msg2");
    expect((dataFrames[2] as DataFrame).payload).toBe("msg3");
  });

  it("close() sends CLOSE frame and transitions OPEN → LOCAL_HALF_CLOSED", () => {
    const session = new Session({
      channelId: "ch2",
      streamId: 2,
      role: "initiator",
      stallTimeoutMs: 0,
    });

    const outFrames: Frame[] = [];
    session.onFrameOut((f) => outFrames.push(f));

    session.open();
    session.receiveFrame(makeOpenAck("ch2", 2, 0, 16));
    expect(session.state).toBe("OPEN");

    session.close();

    expect(session.state).toBe("LOCAL_HALF_CLOSED");
    const closeFrames = outFrames.filter((f) => f.type === "CLOSE");
    expect(closeFrames).toHaveLength(1);
  });

  it("cancel(reason) sends CANCEL frame, transitions CANCELLED, calls onError", () => {
    const session = new Session({
      channelId: "ch2",
      streamId: 2,
      role: "initiator",
      stallTimeoutMs: 0,
    });

    const outFrames: Frame[] = [];
    const errors: string[] = [];
    session.onFrameOut((f) => outFrames.push(f));
    session.onError((r) => errors.push(r));

    session.open();
    session.receiveFrame(makeOpenAck("ch2", 2, 0, 16));

    session.cancel("not-needed");

    expect(session.state).toBe("CANCELLED");
    expect(errors).toEqual(["not-needed"]);
    const cancelFrames = outFrames.filter((f) => f.type === "CANCEL");
    expect(cancelFrames).toHaveLength(1);
  });

  it("full initiator lifecycle: open → OPEN_ACK → sendData ×5 → close → LOCAL_HALF_CLOSED", () => {
    const session = new Session({
      channelId: "ch2",
      streamId: 2,
      role: "initiator",
      initialCredit: 16,
      stallTimeoutMs: 0,
    });

    const outFrames: Frame[] = [];
    session.onFrameOut((f) => outFrames.push(f));

    session.open();
    session.receiveFrame(makeOpenAck("ch2", 2, 0, 16));

    for (let i = 0; i < 5; i++) {
      session.sendData(`payload-${i}`, "STRUCTURED_CLONE");
    }

    session.close();

    expect(session.state).toBe("LOCAL_HALF_CLOSED");

    const dataFrames = outFrames.filter((f) => f.type === "DATA");
    expect(dataFrames).toHaveLength(5);
    expect(outFrames.filter((f) => f.type === "CLOSE")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Consumer-stall detection (requires fake timers)
// ---------------------------------------------------------------------------

describe("Session — consumer-stall detection", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stall timer fires and transitions FSM to ERRORED, calls onError('consumer-stall')", () => {
    vi.useFakeTimers();

    const session = new Session({
      channelId: "ch3",
      streamId: 3,
      role: "responder",
      initialCredit: 0, // start with 0 send credit so stall timer arms immediately
      stallTimeoutMs: 1000,
    });

    const errors: string[] = [];
    session.onError((r) => errors.push(r));
    session.onFrameOut(() => {});

    // receiveFrame(OPEN) transitions to OPEN via OPEN_RECEIVED + OPEN_ACK_SENT
    session.receiveFrame(makeOpen("ch3", 3, 0));
    expect(session.state).toBe("OPEN");

    // Advance fake clock past stallTimeoutMs
    vi.advanceTimersByTime(1001);

    expect(session.state).toBe("ERRORED");
    expect(errors).toEqual(["consumer-stall"]);
  });
});

// ---------------------------------------------------------------------------
// SESS-06: Cross-module wraparound integration — 32 DATA frames through 0xFFFFFFF0
// ---------------------------------------------------------------------------

describe("Session — SESS-06 wraparound integration", () => {
  it("delivers 32 DATA frames in order through 0xFFFFFFF0 wrap (SESS-06)", () => {
    const START = 0xfffffff0;
    const COUNT = 32;
    const seqs: number[] = Array.from({ length: COUNT }, (_, i) => (START + i) >>> 0);

    fc.assert(
      fc.property(
        fc.shuffledSubarray(seqs, { minLength: COUNT, maxLength: COUNT }),
        (shuffled: number[]) => {
          const chunks: unknown[] = [];

          // Use a responder session initialized at START so the ReorderBuffer
          // expects seqNum=0xFFFFFFF0 first (not 0). Without reorderInitSeq: START,
          // all frames at 0xFFFFFFF0+ would be treated as stale (seqLT) and silently dropped.
          const session = new Session({
            channelId: "ch1",
            streamId: 1,
            role: "responder",
            initialCredit: COUNT + 8,
            stallTimeoutMs: 0,
            reorderInitSeq: START,
          });
          session.onChunk((c) => chunks.push(c));
          session.onFrameOut(() => {});

          // Feed all 32 DATA frames in shuffled order.
          // Note: we skip the OPEN handshake — the FSM is IDLE so receiveFrame(DATA)
          // calls transition(IDLE, DATA_RECEIVED) which is an illegal transition.
          // We must open the session first OR bypass the FSM check.
          // The Session's FSM requires OPEN state to accept DATA.
          // Let's properly open the responder session first.
          session.receiveFrame(makeOpen("ch1", 1, 0));

          for (const seqNum of shuffled) {
            // Each frame is its own complete STRUCTURED_CLONE message (isFinal=true).
            // The reorder buffer delivers them in seqNum order regardless of arrival order.
            session.receiveFrame(makeData("ch1", 1, seqNum, `payload-${seqNum}`, true));
          }

          // All 32 chunks must arrive in seqNum order
          expect(chunks).toHaveLength(COUNT);
          const expected = seqs.map((s) => `payload-${s}`);
          expect(chunks).toEqual(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("without reorderInitSeq set, frames at 0xFFFFFFF0 would be treated as stale (demonstrates the need)", () => {
    const START = 0xfffffff0;
    // Without reorderInitSeq, buffer starts expecting seqNum=0.
    // Frame at 0xFFFFFFF0 satisfies seqLT(0xFFFFFFF0, 0) in modular arithmetic
    // (because 0xFFFFFFF0 is "greater" than 0 — i.e. in the past half of the window from 0's perspective).
    // Wait: actually seqLT(0xFFFFFFF0, 0) = ((0xFFFFFFF0 - 0) >>> 0) > HALF_WINDOW
    // = 0xFFFFFFF0 > 0x80000000 = true! So frame IS stale and dropped.
    const session = new Session({
      channelId: "ch1",
      streamId: 1,
      role: "responder",
      initialCredit: 8,
      stallTimeoutMs: 0,
      // intentionally NO reorderInitSeq — defaults to 0
    });

    const chunks: unknown[] = [];
    session.onChunk((c) => chunks.push(c));
    session.onFrameOut(() => {});

    session.receiveFrame(makeOpen("ch1", 1, 0));
    session.receiveFrame(makeData("ch1", 1, START, "payload-at-wrap"));

    // Frame is stale from the default buffer's perspective — silently dropped
    expect(chunks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Full lifecycle — responder side completes CLOSED
// ---------------------------------------------------------------------------

describe("Session — full lifecycle (responder closes cleanly)", () => {
  it("responder: OPEN → 3 DATA frames → CLOSE from initiator → CLOSING → FINAL_SEQ_DELIVERED → CLOSED", () => {
    // Set up a responder that receives 3 DATA frames, then a CLOSE.
    // The responder also sends its own CLOSE to move from REMOTE_HALF_CLOSED to CLOSING.
    // After CLOSE_SENT + CLOSE_RECEIVED + FINAL_SEQ_DELIVERED → CLOSED.
    const session = new Session({
      channelId: "ch4",
      streamId: 4,
      role: "responder",
      initialCredit: 8,
      stallTimeoutMs: 0,
    });

    const chunks: unknown[] = [];
    const outFrames: Frame[] = [];
    session.onChunk((c) => chunks.push(c));
    session.onFrameOut((f) => outFrames.push(f));

    // Step 1: responder receives OPEN → emits OPEN_ACK, state = OPEN
    session.receiveFrame(makeOpen("ch4", 4, 0));
    expect(session.state).toBe("OPEN");

    // Step 2: receive 3 DATA frames (in order, seqNum 0, 1, 2)
    session.receiveFrame(makeData("ch4", 4, 0, "data-0"));
    session.receiveFrame(makeData("ch4", 4, 1, "data-1"));
    session.receiveFrame(makeData("ch4", 4, 2, "data-2"));
    expect(chunks).toHaveLength(3);

    // Step 3: responder sends its own CLOSE → LOCAL_HALF_CLOSED
    session.close();
    expect(session.state).toBe("LOCAL_HALF_CLOSED");

    // Step 4: receive CLOSE from initiator (finalSeq=2, last DATA seqNum)
    // LOCAL_HALF_CLOSED + CLOSE_RECEIVED → CLOSING
    session.receiveFrame(makeClose("ch4", 4, 3, 2));
    // CLOSING state + finalSeq=2: reorder.nextExpected=3 > finalSeq=2, so FINAL_SEQ_DELIVERED fires
    expect(session.state).toBe("CLOSED");
  });
});
