import { describe, expect, it } from "vitest";
import { IllegalTransitionError, transition } from "../../../src/session/fsm.js";

describe("FSM", () => {
  it("scaffold: transition exists", () => {
    expect(typeof transition).toBe("function");
  });
  it("scaffold: IllegalTransitionError exists", () => {
    expect(typeof IllegalTransitionError).toBe("function");
  });
});
