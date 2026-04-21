// tests/unit/session/session-close-finalseq.test.ts
// TDD RED → GREEN: Session.close(finalSeq?) optional parameter
// Requirements: Phase 3 scaffold — patch known finalSeq stub from Phase 2.

import { describe, expect, it } from "vitest";
import type { CloseFrame, Frame } from "../../../src/framing/types.js";
import { FRAME_MARKER } from "../../../src/framing/types.js";
import { Session } from "../../../src/session/index.js";

// Helper to open a session pair and return the responder in OPEN state
function makeOpenSession(): Session {
  const responder = new Session({
    channelId: "ch1",
    streamId: 1,
    role: "responder",
    stallTimeoutMs: 0,
  });
  // Feed an OPEN frame to advance responder to OPEN state
  const outFrames: Frame[] = [];
  responder.onFrameOut((frame) => {
    outFrames.push(frame);
  });
  responder.receiveFrame({
    [FRAME_MARKER]: 1,
    channelId: "ch1",
    streamId: 1,
    seqNum: 0,
    type: "OPEN",
    initCredit: 16,
  });
  return responder;
}

describe("Session.close() finalSeq parameter", () => {
  it("close() with no argument sends CLOSE frame with finalSeq: 0 (backward compat)", () => {
    const session = makeOpenSession();
    const outFrames: Frame[] = [];
    session.onFrameOut((frame) => {
      outFrames.push(frame);
    });

    session.close();

    const closeFrame = outFrames.find((f) => f.type === "CLOSE") as CloseFrame | undefined;
    expect(closeFrame).toBeDefined();
    expect(closeFrame?.finalSeq).toBe(0);
  });

  it("close(42) sends CLOSE frame with finalSeq: 42", () => {
    const session = makeOpenSession();
    const outFrames: Frame[] = [];
    session.onFrameOut((frame) => {
      outFrames.push(frame);
    });

    session.close(42);

    const closeFrame = outFrames.find((f) => f.type === "CLOSE") as CloseFrame | undefined;
    expect(closeFrame).toBeDefined();
    expect(closeFrame?.finalSeq).toBe(42);
  });

  it("close(0xFFFFFFFF) sends CLOSE frame with finalSeq: 0xFFFFFFFF (large value OK)", () => {
    const session = makeOpenSession();
    const outFrames: Frame[] = [];
    session.onFrameOut((frame) => {
      outFrames.push(frame);
    });

    session.close(0xffffffff);

    const closeFrame = outFrames.find((f) => f.type === "CLOSE") as CloseFrame | undefined;
    expect(closeFrame).toBeDefined();
    expect(closeFrame?.finalSeq).toBe(0xffffffff);
  });

  it("close(0) explicitly is same as close() — finalSeq: 0", () => {
    const session = makeOpenSession();
    const outFrames: Frame[] = [];
    session.onFrameOut((frame) => {
      outFrames.push(frame);
    });

    session.close(0);

    const closeFrame = outFrames.find((f) => f.type === "CLOSE") as CloseFrame | undefined;
    expect(closeFrame).toBeDefined();
    expect(closeFrame?.finalSeq).toBe(0);
  });
});
