import { describe, expect, it } from "vitest";
import { CreditWindow } from "../../../src/session/credit-window.js";

describe("CreditWindow", () => {
  it("scaffold: exists and is a constructor", () => {
    expect(typeof CreditWindow).toBe("function");
  });
});
