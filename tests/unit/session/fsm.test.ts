import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
  IllegalTransitionError,
  isTerminalState,
  transition,
  type StreamEvent,
  type StreamState,
} from "../../../src/session/fsm.js";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

const VALID_STATES: StreamState[] = [
  "IDLE",
  "OPENING",
  "OPEN",
  "LOCAL_HALF_CLOSED",
  "REMOTE_HALF_CLOSED",
  "CLOSING",
  "CLOSED",
  "ERRORED",
  "CANCELLED",
];

const eventArb: fc.Arbitrary<StreamEvent> = fc.oneof(
  fc.constant({ type: "OPEN_SENT" } as const),
  fc.constant({ type: "OPEN_RECEIVED" } as const),
  fc.record({
    type: fc.constant("OPEN_ACK_SENT" as const),
    initCredit: fc.nat({ max: 64 }),
  }),
  fc.record({
    type: fc.constant("OPEN_ACK_RECEIVED" as const),
    initCredit: fc.nat({ max: 64 }),
  }),
  fc.constant({ type: "DATA_SENT" } as const),
  fc.constant({ type: "DATA_RECEIVED" } as const),
  fc.constant({ type: "CLOSE_SENT" } as const),
  fc.constant({ type: "CLOSE_RECEIVED" } as const),
  fc.record({
    type: fc.constant("CANCEL_SENT" as const),
    reason: fc.string(),
  }),
  fc.record({
    type: fc.constant("CANCEL_RECEIVED" as const),
    reason: fc.string(),
  }),
  fc.record({
    type: fc.constant("RESET_SENT" as const),
    reason: fc.string(),
  }),
  fc.record({
    type: fc.constant("RESET_RECEIVED" as const),
    reason: fc.string(),
  }),
  fc.constant({ type: "FINAL_SEQ_DELIVERED" } as const),
  fc.constant({ type: "STALL_TIMEOUT" } as const),
);

// ──────────────────────────────────────────────────────────────────────────────
// Valid transitions — 28 rows from the transition table
// ──────────────────────────────────────────────────────────────────────────────

describe("FSM valid transitions", () => {
  // IDLE
  it("IDLE + OPEN_SENT → OPENING", () => {
    expect(transition("IDLE", { type: "OPEN_SENT" })).toBe("OPENING");
  });

  it("IDLE + OPEN_RECEIVED → OPENING", () => {
    expect(transition("IDLE", { type: "OPEN_RECEIVED" })).toBe("OPENING");
  });

  // OPENING
  it("OPENING + OPEN_ACK_SENT → OPEN", () => {
    expect(
      transition("OPENING", { type: "OPEN_ACK_SENT", initCredit: 16 }),
    ).toBe("OPEN");
  });

  it("OPENING + OPEN_ACK_RECEIVED → OPEN", () => {
    expect(
      transition("OPENING", { type: "OPEN_ACK_RECEIVED", initCredit: 16 }),
    ).toBe("OPEN");
  });

  it("OPENING + RESET_RECEIVED → ERRORED", () => {
    expect(
      transition("OPENING", { type: "RESET_RECEIVED", reason: "refused" }),
    ).toBe("ERRORED");
  });

  // OPEN
  it("OPEN + DATA_SENT → OPEN", () => {
    expect(transition("OPEN", { type: "DATA_SENT" })).toBe("OPEN");
  });

  it("OPEN + DATA_RECEIVED → OPEN", () => {
    expect(transition("OPEN", { type: "DATA_RECEIVED" })).toBe("OPEN");
  });

  it("OPEN + CLOSE_SENT → LOCAL_HALF_CLOSED", () => {
    expect(transition("OPEN", { type: "CLOSE_SENT" })).toBe("LOCAL_HALF_CLOSED");
  });

  it("OPEN + CLOSE_RECEIVED → REMOTE_HALF_CLOSED", () => {
    expect(transition("OPEN", { type: "CLOSE_RECEIVED" })).toBe(
      "REMOTE_HALF_CLOSED",
    );
  });

  it("OPEN + CANCEL_SENT → CANCELLED", () => {
    expect(
      transition("OPEN", { type: "CANCEL_SENT", reason: "user abort" }),
    ).toBe("CANCELLED");
  });

  it("OPEN + CANCEL_RECEIVED → CANCELLED", () => {
    expect(
      transition("OPEN", { type: "CANCEL_RECEIVED", reason: "remote abort" }),
    ).toBe("CANCELLED");
  });

  it("OPEN + RESET_SENT → ERRORED", () => {
    expect(transition("OPEN", { type: "RESET_SENT", reason: "io error" })).toBe(
      "ERRORED",
    );
  });

  it("OPEN + RESET_RECEIVED → ERRORED", () => {
    expect(
      transition("OPEN", { type: "RESET_RECEIVED", reason: "remote error" }),
    ).toBe("ERRORED");
  });

  it("OPEN + STALL_TIMEOUT → ERRORED", () => {
    expect(transition("OPEN", { type: "STALL_TIMEOUT" })).toBe("ERRORED");
  });

  // LOCAL_HALF_CLOSED
  it("LOCAL_HALF_CLOSED + DATA_RECEIVED → LOCAL_HALF_CLOSED", () => {
    expect(transition("LOCAL_HALF_CLOSED", { type: "DATA_RECEIVED" })).toBe(
      "LOCAL_HALF_CLOSED",
    );
  });

  it("LOCAL_HALF_CLOSED + CLOSE_RECEIVED → CLOSING", () => {
    expect(transition("LOCAL_HALF_CLOSED", { type: "CLOSE_RECEIVED" })).toBe(
      "CLOSING",
    );
  });

  it("LOCAL_HALF_CLOSED + RESET_SENT → ERRORED", () => {
    expect(
      transition("LOCAL_HALF_CLOSED", {
        type: "RESET_SENT",
        reason: "io error",
      }),
    ).toBe("ERRORED");
  });

  it("LOCAL_HALF_CLOSED + RESET_RECEIVED → ERRORED", () => {
    expect(
      transition("LOCAL_HALF_CLOSED", {
        type: "RESET_RECEIVED",
        reason: "remote error",
      }),
    ).toBe("ERRORED");
  });

  it("LOCAL_HALF_CLOSED + CANCEL_RECEIVED → CANCELLED", () => {
    expect(
      transition("LOCAL_HALF_CLOSED", {
        type: "CANCEL_RECEIVED",
        reason: "remote abort",
      }),
    ).toBe("CANCELLED");
  });

  // REMOTE_HALF_CLOSED
  it("REMOTE_HALF_CLOSED + DATA_SENT → REMOTE_HALF_CLOSED", () => {
    expect(transition("REMOTE_HALF_CLOSED", { type: "DATA_SENT" })).toBe(
      "REMOTE_HALF_CLOSED",
    );
  });

  it("REMOTE_HALF_CLOSED + CLOSE_SENT → CLOSING", () => {
    expect(transition("REMOTE_HALF_CLOSED", { type: "CLOSE_SENT" })).toBe(
      "CLOSING",
    );
  });

  it("REMOTE_HALF_CLOSED + RESET_SENT → ERRORED", () => {
    expect(
      transition("REMOTE_HALF_CLOSED", {
        type: "RESET_SENT",
        reason: "io error",
      }),
    ).toBe("ERRORED");
  });

  it("REMOTE_HALF_CLOSED + RESET_RECEIVED → ERRORED", () => {
    expect(
      transition("REMOTE_HALF_CLOSED", {
        type: "RESET_RECEIVED",
        reason: "remote error",
      }),
    ).toBe("ERRORED");
  });

  it("REMOTE_HALF_CLOSED + CANCEL_SENT → CANCELLED", () => {
    expect(
      transition("REMOTE_HALF_CLOSED", {
        type: "CANCEL_SENT",
        reason: "user abort",
      }),
    ).toBe("CANCELLED");
  });

  // CLOSING
  it("CLOSING + FINAL_SEQ_DELIVERED → CLOSED", () => {
    expect(transition("CLOSING", { type: "FINAL_SEQ_DELIVERED" })).toBe(
      "CLOSED",
    );
  });

  it("CLOSING + RESET_SENT → ERRORED", () => {
    expect(
      transition("CLOSING", { type: "RESET_SENT", reason: "drain error" }),
    ).toBe("ERRORED");
  });

  it("CLOSING + RESET_RECEIVED → ERRORED", () => {
    expect(
      transition("CLOSING", { type: "RESET_RECEIVED", reason: "remote error" }),
    ).toBe("ERRORED");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Terminal state absorption — each terminal state throws on any event
// ──────────────────────────────────────────────────────────────────────────────

describe("FSM terminal states throw on any event", () => {
  const terminalStates: StreamState[] = ["CLOSED", "ERRORED", "CANCELLED"];

  for (const state of terminalStates) {
    it(`${state} + OPEN_SENT → throws`, () => {
      expect(() => transition(state, { type: "OPEN_SENT" })).toThrow(
        IllegalTransitionError,
      );
    });

    it(`${state} + DATA_SENT → throws`, () => {
      expect(() => transition(state, { type: "DATA_SENT" })).toThrow(
        IllegalTransitionError,
      );
    });

    it(`${state} + RESET_RECEIVED → throws`, () => {
      expect(() =>
        transition(state, { type: "RESET_RECEIVED", reason: "x" }),
      ).toThrow(IllegalTransitionError);
    });

    it(`${state} + FINAL_SEQ_DELIVERED → throws`, () => {
      expect(() =>
        transition(state, { type: "FINAL_SEQ_DELIVERED" }),
      ).toThrow(IllegalTransitionError);
    });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Invalid transitions — sampled illegal (state, event) pairs
// ──────────────────────────────────────────────────────────────────────────────

describe("FSM invalid transitions", () => {
  it("IDLE + DATA_SENT → throws IllegalTransitionError", () => {
    expect(() => transition("IDLE", { type: "DATA_SENT" })).toThrow(
      IllegalTransitionError,
    );
  });

  it("IDLE + CLOSE_RECEIVED → throws IllegalTransitionError", () => {
    expect(() => transition("IDLE", { type: "CLOSE_RECEIVED" })).toThrow(
      IllegalTransitionError,
    );
  });

  it("OPENING + DATA_SENT → throws IllegalTransitionError", () => {
    expect(() => transition("OPENING", { type: "DATA_SENT" })).toThrow(
      IllegalTransitionError,
    );
  });

  it("OPENING + CLOSE_SENT → throws IllegalTransitionError", () => {
    expect(() => transition("OPENING", { type: "CLOSE_SENT" })).toThrow(
      IllegalTransitionError,
    );
  });

  it("LOCAL_HALF_CLOSED + DATA_SENT → throws IllegalTransitionError", () => {
    expect(() =>
      transition("LOCAL_HALF_CLOSED", { type: "DATA_SENT" }),
    ).toThrow(IllegalTransitionError);
  });

  it("REMOTE_HALF_CLOSED + DATA_RECEIVED → throws IllegalTransitionError", () => {
    expect(() =>
      transition("REMOTE_HALF_CLOSED", { type: "DATA_RECEIVED" }),
    ).toThrow(IllegalTransitionError);
  });

  it("CLOSING + DATA_SENT → throws IllegalTransitionError", () => {
    expect(() => transition("CLOSING", { type: "DATA_SENT" })).toThrow(
      IllegalTransitionError,
    );
  });

  it("IDLE + STALL_TIMEOUT → throws IllegalTransitionError", () => {
    expect(() => transition("IDLE", { type: "STALL_TIMEOUT" })).toThrow(
      IllegalTransitionError,
    );
  });

  it("IllegalTransitionError has correct .state and .eventType properties", () => {
    let caught: unknown;
    try {
      transition("IDLE", { type: "DATA_SENT" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(IllegalTransitionError);
    const err = caught as IllegalTransitionError;
    expect(err.state).toBe("IDLE");
    expect(err.eventType).toBe("DATA_SENT");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// CANCEL vs RESET semantics
// ──────────────────────────────────────────────────────────────────────────────

describe("CANCEL vs RESET semantics", () => {
  it("CANCEL_SENT from OPEN → CANCELLED (consumer abort, not error)", () => {
    expect(
      transition("OPEN", { type: "CANCEL_SENT", reason: "user abort" }),
    ).toBe("CANCELLED");
  });

  it("RESET_SENT from OPEN → ERRORED (producer abort = error)", () => {
    expect(
      transition("OPEN", { type: "RESET_SENT", reason: "fatal error" }),
    ).toBe("ERRORED");
  });

  it("CANCEL_RECEIVED from OPEN → CANCELLED (remote consumer aborted)", () => {
    expect(
      transition("OPEN", { type: "CANCEL_RECEIVED", reason: "remote abort" }),
    ).toBe("CANCELLED");
  });

  it("CANCEL_RECEIVED from LOCAL_HALF_CLOSED → CANCELLED", () => {
    expect(
      transition("LOCAL_HALF_CLOSED", {
        type: "CANCEL_RECEIVED",
        reason: "remote abort",
      }),
    ).toBe("CANCELLED");
  });

  it("CANCEL_SENT from REMOTE_HALF_CLOSED → CANCELLED", () => {
    expect(
      transition("REMOTE_HALF_CLOSED", {
        type: "CANCEL_SENT",
        reason: "user abort",
      }),
    ).toBe("CANCELLED");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// isTerminalState
// ──────────────────────────────────────────────────────────────────────────────

describe("isTerminalState", () => {
  it("isTerminalState('CLOSED') → true", () => {
    expect(isTerminalState("CLOSED")).toBe(true);
  });

  it("isTerminalState('ERRORED') → true", () => {
    expect(isTerminalState("ERRORED")).toBe(true);
  });

  it("isTerminalState('CANCELLED') → true", () => {
    expect(isTerminalState("CANCELLED")).toBe(true);
  });

  it("isTerminalState('OPEN') → false", () => {
    expect(isTerminalState("OPEN")).toBe(false);
  });

  it("isTerminalState('IDLE') → false", () => {
    expect(isTerminalState("IDLE")).toBe(false);
  });

  it("isTerminalState('OPENING') → false", () => {
    expect(isTerminalState("OPENING")).toBe(false);
  });

  it("isTerminalState('LOCAL_HALF_CLOSED') → false", () => {
    expect(isTerminalState("LOCAL_HALF_CLOSED")).toBe(false);
  });

  it("isTerminalState('REMOTE_HALF_CLOSED') → false", () => {
    expect(isTerminalState("REMOTE_HALF_CLOSED")).toBe(false);
  });

  it("isTerminalState('CLOSING') → false", () => {
    expect(isTerminalState("CLOSING")).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Property tests — TEST-06
// ──────────────────────────────────────────────────────────────────────────────

describe("property: FSM — TEST-06", () => {
  it("never produces undefined state (TEST-06)", () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 50 }), (events) => {
        let state: StreamState = "IDLE";
        for (const event of events) {
          try {
            state = transition(state, event);
          } catch (e) {
            if (e instanceof IllegalTransitionError) return; // expected for random sequences
            throw e;
          }
        }
        expect(VALID_STATES).toContain(state);
      }),
      { numRuns: 1000 },
    );
  });

  it("terminal state throws on any subsequent event (TEST-06)", () => {
    const terminalStates: StreamState[] = ["CLOSED", "ERRORED", "CANCELLED"];
    fc.assert(
      fc.property(
        fc.constantFrom(...terminalStates),
        eventArb,
        (terminalState, event) => {
          expect(() => transition(terminalState, event)).toThrow(
            IllegalTransitionError,
          );
        },
      ),
      { numRuns: 500 },
    );
  });

  it("transition result is always a known StreamState value when valid (TEST-06)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...VALID_STATES),
        eventArb,
        (state, event) => {
          try {
            const next = transition(state, event);
            expect(VALID_STATES).toContain(next);
          } catch (e) {
            if (e instanceof IllegalTransitionError) return; // expected
            throw e;
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});
